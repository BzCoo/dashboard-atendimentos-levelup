-- Envio do relatório só para os grupos de CRM (grupos do WhatsApp com "CRM" no nome),
-- associados automaticamente à empresa/loja pelo nome do grupo.
CREATE TABLE IF NOT EXISTS dash_atend.grupos_crm (
  jid text PRIMARY KEY CHECK (jid ~ '^[0-9]+(-[0-9]+)?@g\.us$'),
  nome text NOT NULL,
  cliente_id bigint REFERENCES public.clients(id) ON DELETE SET NULL,
  loja_id bigint REFERENCES metrics_dev.ghl_accounts(id) ON DELETE SET NULL,
  loja_manual boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  visto_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dash_atend.grupos_crm ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dash_atend.grupos_crm FROM PUBLIC, anon, authenticated;

ALTER TABLE dash_atend.envios DROP CONSTRAINT envios_destino_check, ADD CONSTRAINT envios_destino_check CHECK (destino IN ('loja', 'levelup', 'crm'));
ALTER TABLE dash_atend.envios DROP CONSTRAINT envios_grupo_jid_check, ADD CONSTRAINT envios_grupo_jid_check CHECK (grupo_jid ~ '^[0-9]+(-[0-9]+)?@g\.us$');

CREATE OR REPLACE FUNCTION dash_atend.palavras(p text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(array_agg(DISTINCT w), '{}') FROM unnest(regexp_split_to_array(trim(regexp_replace(dash_atend.norm(p), '[^A-Z0-9]+', ' ', 'g')), ' ')) w
  WHERE length(w) >= 2 AND w NOT IN ('DE', 'DA', 'DO', 'E', 'CRM', 'IA')
$$;

CREATE OR REPLACE FUNCTION dash_atend.mapear_grupo(p_nome text, OUT cliente_id bigint, OUT loja_id bigint)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH g AS (SELECT dash_atend.palavras(p_nome) AS w),
  cand AS (
    SELECT a.client_id AS cliente_id, a.id AS loja_id, dash_atend.palavras(a.name) AS w, 1 AS pri
    FROM metrics_dev.ghl_accounts a WHERE a.is_active AND a.client_id IS NOT NULL
    UNION ALL
    SELECT c.id, NULL::bigint, dash_atend.palavras(c.name), 0
    FROM public.clients c WHERE EXISTS (SELECT 1 FROM metrics_dev.ghl_accounts a WHERE a.client_id = c.id AND a.is_active)
  )
  SELECT cand.cliente_id,
    CASE WHEN (SELECT count(*) FROM metrics_dev.ghl_accounts x WHERE x.client_id = cand.cliente_id AND x.is_active) = 1
      THEN (SELECT x.id FROM metrics_dev.ghl_accounts x WHERE x.client_id = cand.cliente_id AND x.is_active) ELSE cand.loja_id END
  FROM cand, g
  WHERE cardinality(cand.w) > 0 AND cand.w <@ g.w
  ORDER BY cardinality(cand.w) DESC, cand.pri DESC, length(array_to_string(cand.w, '')) DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.atend_service_salvar_grupos(p_grupos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n int := 0; v_total int := 0;
BEGIN
  IF jsonb_typeof(p_grupos) <> 'array' THEN RAISE EXCEPTION 'p_grupos deve ser uma lista'; END IF;
  v_total := jsonb_array_length(p_grupos);
  WITH g AS (
    SELECT DISTINCT ON (trim(x->>'jid')) trim(x->>'jid') AS jid, left(trim(x->>'nome'), 200) AS nome
    FROM jsonb_array_elements(p_grupos) x
    WHERE trim(COALESCE(x->>'jid', '')) ~ '^[0-9]+(-[0-9]+)?@g\.us$' AND COALESCE(x->>'nome', '') ~* 'crm'
  ), up AS (
    INSERT INTO dash_atend.grupos_crm AS t (jid, nome, cliente_id, loja_id, visto_em, ativo)
    SELECT g.jid, g.nome, m.cliente_id, m.loja_id, now(), true FROM g LEFT JOIN LATERAL dash_atend.mapear_grupo(g.nome) m ON true
    ON CONFLICT (jid) DO UPDATE SET nome = EXCLUDED.nome, visto_em = now(), ativo = true,
      cliente_id = CASE WHEN t.loja_manual THEN t.cliente_id ELSE EXCLUDED.cliente_id END,
      loja_id = CASE WHEN t.loja_manual THEN t.loja_id ELSE EXCLUDED.loja_id END
    RETURNING 1
  ) SELECT count(*) INTO v_n FROM up;
  IF v_total > 0 THEN
    UPDATE dash_atend.grupos_crm SET ativo = false WHERE visto_em < now() - interval '1 minute';
  END IF;
  RETURN jsonb_build_object('grupos_recebidos', v_total, 'grupos_crm', v_n);
END $$;
REVOKE ALL ON FUNCTION public.atend_service_salvar_grupos(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_salvar_grupos(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.atend_admin_destinos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN jsonb_build_object(
    'atualizado_em', (SELECT max(visto_em) FROM dash_atend.grupos_crm),
    'grupos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('jid', g.jid, 'nome', g.nome, 'cliente_id', g.cliente_id, 'empresa', c.name,
        'loja_id', g.loja_id, 'loja', trim(both chr(10) from a.name),
        'lojas', (SELECT jsonb_agg(x.id) FROM metrics_dev.ghl_accounts x WHERE x.client_id = g.cliente_id AND x.is_active AND (g.loja_id IS NULL OR x.id = g.loja_id)))
        ORDER BY c.name, g.nome)
      FROM dash_atend.grupos_crm g JOIN public.clients c ON c.id = g.cliente_id
      LEFT JOIN metrics_dev.ghl_accounts a ON a.id = g.loja_id
      WHERE g.ativo), '[]'::jsonb));
END $$;

DROP FUNCTION IF EXISTS public.atend_admin_enviar(text, bigint, text);
CREATE OR REPLACE FUNCTION public.atend_admin_enviar(p_grupo text, p_texto text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin uuid := dash_atend.exigir_admin(); v_jid text; v_nome text; v_loja bigint; v_id uuid; v_texto text := trim(COALESCE(p_texto, ''));
BEGIN
  IF v_texto = '' THEN RAISE EXCEPTION 'Mensagem vazia'; END IF;
  IF length(v_texto) > 20000 THEN RAISE EXCEPTION 'Mensagem muito longa (max. 20.000 caracteres)'; END IF;
  SELECT g.jid, g.nome, g.loja_id INTO v_jid, v_nome, v_loja FROM dash_atend.grupos_crm g WHERE g.jid = p_grupo AND g.ativo AND g.cliente_id IS NOT NULL;
  IF v_jid IS NULL THEN RAISE EXCEPTION 'Grupo de CRM nao encontrado'; END IF;
  IF (SELECT count(*) FROM dash_atend.envios e WHERE e.criado_por = v_admin AND e.criado_em > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'Limite de 30 envios por hora atingido';
  END IF;
  IF EXISTS (SELECT 1 FROM dash_atend.envios e WHERE e.grupo_jid = v_jid AND e.texto = v_texto AND e.criado_em > now() - interval '10 minutes' AND e.status <> 'falhou') THEN
    RAISE EXCEPTION 'Esta mesma mensagem ja foi enviada para este grupo nos ultimos 10 minutos';
  END IF;
  INSERT INTO dash_atend.envios (criado_por, destino, loja_id, destino_nome, grupo_jid, texto)
  VALUES (v_admin, 'crm', v_loja, v_nome, v_jid, v_texto) RETURNING id INTO v_id;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (v_admin, 'enviar_whatsapp', jsonb_build_object('envio', v_id, 'grupo', v_nome));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'destino', v_nome);
END $$;
REVOKE ALL ON FUNCTION public.atend_admin_enviar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_enviar(text, text) TO authenticated;
