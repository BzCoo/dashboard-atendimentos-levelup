-- Um grupo de CRM pode atender várias lojas do mesmo cliente (ex.: "CRM e IA | WR MOTOS" = WR ITALO, WR ANDRÉ e WR CLEBER).
-- grupos_crm.lojas, quando preenchido, manda sobre loja_id na hora de sugerir o grupo da loja (relatório manual e automático).
ALTER TABLE dash_atend.grupos_crm ADD COLUMN IF NOT EXISTS lojas bigint[];

CREATE OR REPLACE FUNCTION dash_atend.grupo_atende(g dash_atend.grupos_crm, p_loja bigint, p_cliente bigint)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN g.lojas IS NOT NULL THEN p_loja = ANY (g.lojas)
              WHEN g.loja_id IS NOT NULL THEN g.loja_id = p_loja
              ELSE g.cliente_id = p_cliente END
$$;

CREATE OR REPLACE FUNCTION public.atend_admin_destinos()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN jsonb_build_object(
    'atualizado_em', (SELECT max(visto_em) FROM dash_atend.grupos_crm),
    'grupos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('jid', g.jid, 'nome', g.nome, 'cliente_id', g.cliente_id, 'empresa', c.name,
        'loja_id', g.loja_id, 'loja', trim(both chr(10) from a.name),
        'lojas', (SELECT jsonb_agg(x.id) FROM metrics_dev.ghl_accounts x WHERE x.client_id = g.cliente_id AND x.is_active AND dash_atend.grupo_atende(g, x.id, x.client_id)))
        ORDER BY c.name, g.nome)
      FROM dash_atend.grupos_crm g JOIN public.clients c ON c.id = g.cliente_id
      LEFT JOIN metrics_dev.ghl_accounts a ON a.id = g.loja_id
      WHERE g.ativo), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.atend_relatorio_agendas()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('loja_id', a.id, 'loja', trim(both chr(10) from a.name),
      'agenda', to_jsonb(r) - 'atualizado_por',
      'grupos', COALESCE((SELECT jsonb_agg(jsonb_build_object('jid', g.jid, 'nome', trim(regexp_replace(g.nome, '^[^A-Za-z0-9À-ú]+', ''))))
        FROM dash_atend.grupos_crm g WHERE g.ativo AND dash_atend.grupo_atende(g, a.id, a.client_id)), '[]'))
      ORDER BY a.name)
    FROM metrics_dev.ghl_accounts a LEFT JOIN dash_atend.relatorio_agendas r ON r.loja_id = a.id
    WHERE a.is_active), '[]');
END $function$;

-- Religar o grupo pela página Contas volta ao modo de uma loja (ou cliente inteiro)
CREATE OR REPLACE FUNCTION public.atend_dev_grupo_ligar(p_jid text, p_cliente bigint, p_loja bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_dev uuid := dash_atend.exigir_dev();
BEGIN
  IF p_loja IS NOT NULL AND NOT EXISTS (SELECT 1 FROM metrics_dev.ghl_accounts WHERE id = p_loja AND (p_cliente IS NULL OR client_id = p_cliente)) THEN
    RAISE EXCEPTION 'A loja nao pertence a esse cliente';
  END IF;
  UPDATE dash_atend.grupos_crm SET cliente_id = COALESCE(p_cliente, (SELECT client_id FROM metrics_dev.ghl_accounts WHERE id = p_loja)),
    loja_id = p_loja, lojas = NULL, loja_manual = true WHERE jid = p_jid;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (v_dev, 'grupo_ligar', jsonb_build_object('grupo', p_jid, 'cliente', p_cliente, 'loja', p_loja));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- WR: o grupo WR MOTOS recebe Italo, André e Cleber; o grupo WR Carros fica com Mauricio e Jeferson
UPDATE dash_atend.grupos_crm SET cliente_id = 25, loja_id = NULL, lojas = ARRAY[250,251,252]::bigint[], loja_manual = true WHERE jid = '120363425575474903@g.us';
UPDATE dash_atend.grupos_crm SET cliente_id = 25, loja_id = NULL, lojas = ARRAY[67,84]::bigint[], loja_manual = true WHERE jid = '120363415121178425@g.us';
