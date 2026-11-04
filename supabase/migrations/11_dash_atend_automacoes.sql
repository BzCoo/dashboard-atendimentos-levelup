-- Aba "Automações" (só admins): o painel grava o pedido, o n8n (DASH ATENDIMENTOS - Automações do painel) executa conta por conta
-- e grava o andamento de cada item. Progresso e tempo estimado saem de auto_itens; o relatório final de auto_itens.resultado.

CREATE TABLE IF NOT EXISTS dash_atend.auto_execucoes (
  id bigserial PRIMARY KEY,
  tipo text NOT NULL,
  simulacao boolean NOT NULL DEFAULT false,
  params jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','executando','concluido','falhou','cancelado')),
  cancelar boolean NOT NULL DEFAULT false,
  origem_id bigint REFERENCES dash_atend.auto_execucoes(id) ON DELETE SET NULL,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  atualizado_em timestamptz,
  concluido_em timestamptz,
  erro text,
  n8n_execucao text
);
CREATE TABLE IF NOT EXISTS dash_atend.auto_itens (
  id bigserial PRIMARY KEY,
  execucao_id bigint NOT NULL REFERENCES dash_atend.auto_execucoes(id) ON DELETE CASCADE,
  ordem int NOT NULL,
  loja_id bigint,
  rotulo text NOT NULL,
  alvo jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','executando','ok','falhou','ignorado','cancelado')),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  resultado jsonb,
  erro text
);
CREATE INDEX IF NOT EXISTS auto_itens_exec ON dash_atend.auto_itens (execucao_id, ordem);
CREATE INDEX IF NOT EXISTS auto_execucoes_status ON dash_atend.auto_execucoes (status, criado_em);
ALTER TABLE dash_atend.auto_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dash_atend.auto_itens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dash_atend.auto_execucoes, dash_atend.auto_itens FROM PUBLIC, anon, authenticated;

-- Catálogo: o que cada automação aceita (o painel monta o formulário a partir daqui)
CREATE OR REPLACE FUNCTION dash_atend.auto_catalogo() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
SELECT '[
 {"tipo":"recarregar","nome":"Recarregar dados do GHL","descricao":"Busca de novo no CRM os leads, mensagens, vendedores e etapas do período e regrava no banco. Não usa IA e não mexe no CRM.","simulacao":false,"campos":["periodo"],"max_dias":90},
 {"tipo":"pipeline","nome":"Pipeline Inteligente","descricao":"A IA lê as conversas recentes e move os leads para a etapa certa do funil, seguindo as regras de cada conta.","simulacao":true,"campos":["janela_dias","max_leads","reanalisar"]},
 {"tipo":"aguardando","nome":"Aguardando → Atendimento","descricao":"Move para Atendimento os leads que já foram respondidos mas continuam em Aguardando atendimento.","simulacao":true,"campos":["janela_horas"]},
 {"tipo":"etapas","nome":"Sincronizar nomes das etapas","descricao":"Atualiza no painel os nomes e a ordem das etapas do pipeline de cada conta.","simulacao":false,"campos":[]},
 {"tipo":"anuncios_meta","nome":"Atualizar anúncios e investimento do Meta","descricao":"Busca no Meta os anúncios ativos e o investimento por dia da empresa da conta e regrava no banco.","simulacao":false,"campos":["periodo"],"max_dias":90},
 {"tipo":"anuncio_origem","nome":"Gravar anúncio de origem no GHL","descricao":"Grava no contato e na oportunidade do CRM o anúncio, o veículo e o preço que trouxeram o lead.","simulacao":true,"campos":["max_leads"]},
 {"tipo":"relatorio_ia","nome":"Relatório de atendimentos com IA","descricao":"Gera o relatório semanal com análise da IA para a conta. Pode só gerar (aparece aqui) ou também enviar no WhatsApp de sempre.","simulacao":false,"campos":["semana","enviar"]}
]'::jsonb $$;

CREATE OR REPLACE FUNCTION public.atend_admin_auto_catalogo() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  -- média de segundos por conta nas últimas execuções de cada tipo (para o tempo estimado antes de começar)
  RETURN (SELECT jsonb_agg(c || jsonb_build_object('media_seg', (
      SELECT round(avg(extract(epoch FROM i.concluido_em - i.iniciado_em)))
      FROM (SELECT i2.* FROM dash_atend.auto_itens i2 JOIN dash_atend.auto_execucoes e2 ON e2.id = i2.execucao_id
            WHERE e2.tipo = c->>'tipo' AND i2.status = 'ok' AND i2.iniciado_em IS NOT NULL ORDER BY i2.concluido_em DESC LIMIT 30) i)))
    FROM jsonb_array_elements(dash_atend.auto_catalogo()) c);
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_auto_criar(p_tipo text, p_lojas bigint[], p_params jsonb DEFAULT '{}', p_simulacao boolean DEFAULT false, p_origem bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_admin uuid := dash_atend.exigir_admin();
  v_cat jsonb := (SELECT c FROM jsonb_array_elements(dash_atend.auto_catalogo()) c WHERE c->>'tipo' = p_tipo);
  v_p jsonb := '{}'; v_id bigint; v_ini date; v_fim date; v_n int; v_lojas bigint[];
BEGIN
  IF v_cat IS NULL THEN RAISE EXCEPTION 'Automação desconhecida'; END IF;
  IF p_simulacao AND NOT (v_cat->>'simulacao')::boolean THEN RAISE EXCEPTION 'Esta automação não tem modo de simulação'; END IF;
  SELECT array_agg(a.id ORDER BY a.name) INTO v_lojas FROM metrics_dev.ghl_accounts a WHERE a.id = ANY(p_lojas) AND a.is_active;
  IF coalesce(cardinality(v_lojas), 0) = 0 THEN RAISE EXCEPTION 'Escolha pelo menos uma conta ativa'; END IF;
  IF (SELECT count(*) FROM dash_atend.auto_execucoes WHERE status = 'pendente') >= 10 THEN RAISE EXCEPTION 'Já há 10 automações na fila. Espere algumas terminarem.'; END IF;

  -- Parâmetros: só os que a automação aceita, dentro dos limites
  IF v_cat->'campos' ? 'periodo' THEN
    v_ini := (p_params->>'inicio')::date; v_fim := (p_params->>'fim')::date;
    IF v_ini IS NULL OR v_fim IS NULL OR v_ini > v_fim THEN RAISE EXCEPTION 'Informe um período válido'; END IF;
    IF v_fim > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'O período não pode terminar no futuro'; END IF;
    IF v_fim - v_ini + 1 > (v_cat->>'max_dias')::int THEN RAISE EXCEPTION 'Período máximo: % dias', v_cat->>'max_dias'; END IF;
    v_p := v_p || jsonb_build_object('inicio', v_ini, 'fim', v_fim);
  END IF;
  IF v_cat->'campos' ? 'semana' THEN
    v_ini := (p_params->>'inicio')::date;
    IF v_ini IS NULL THEN RAISE EXCEPTION 'Informe o início da semana'; END IF;
    v_fim := v_ini + 6;
    IF v_fim >= (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'A semana precisa estar completa (terminar antes de hoje)'; END IF;
    v_p := v_p || jsonb_build_object('inicio', v_ini, 'fim', v_fim);
  END IF;
  IF v_cat->'campos' ? 'janela_dias' THEN v_p := v_p || jsonb_build_object('janela_dias', greatest(1, least(30, coalesce((p_params->>'janela_dias')::int, 30)))); END IF;
  IF v_cat->'campos' ? 'janela_horas' THEN v_p := v_p || jsonb_build_object('janela_horas', greatest(1, least(168, coalesce((p_params->>'janela_horas')::int, 24)))); END IF;
  IF v_cat->'campos' ? 'max_leads' THEN v_p := v_p || jsonb_build_object('max_leads', greatest(1, least(300, coalesce((p_params->>'max_leads')::int, 100)))); END IF;
  IF v_cat->'campos' ? 'reanalisar' THEN v_p := v_p || jsonb_build_object('reanalisar', coalesce((p_params->>'reanalisar')::boolean, false)); END IF;
  IF v_cat->'campos' ? 'enviar' THEN v_p := v_p || jsonb_build_object('enviar', coalesce((p_params->>'enviar')::boolean, false)); END IF;

  INSERT INTO dash_atend.auto_execucoes (tipo, simulacao, params, criado_por, origem_id)
  VALUES (p_tipo, p_simulacao, v_p, v_admin, p_origem) RETURNING id INTO v_id;

  IF p_tipo = 'anuncios_meta' THEN
    -- Investimento é por empresa: um item por conta de anúncios, mesmo que várias lojas sejam da mesma empresa
    INSERT INTO dash_atend.auto_itens (execucao_id, ordem, loja_id, rotulo, alvo)
    SELECT v_id, row_number() OVER (ORDER BY c.name, ad.id), min(a.id), c.name || coalesce(' · ' || nullif(ad.name, ''), ''),
           jsonb_build_object('ad_account_id', ad.id, 'meta_ad_account_id', ad.meta_ad_account_id, 'client_id', c.id, 'client_name', c.name, 'lojas', array_agg(a.name ORDER BY a.name))
    FROM metrics_dev.ghl_accounts a JOIN public.clients c ON c.id = a.client_id
    JOIN public.ad_accounts ad ON ad.client_id = c.id AND ad.is_active AND nullif(trim(ad.meta_ad_account_id), '') IS NOT NULL
    WHERE a.id = ANY(v_lojas) GROUP BY c.id, c.name, ad.id, ad.name, ad.meta_ad_account_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO dash_atend.auto_itens (execucao_id, ordem, loja_id, rotulo, status, erro, concluido_em)
    SELECT v_id, v_n + row_number() OVER (ORDER BY a.name), a.id, a.name, 'ignorado', 'A empresa desta conta não tem conta de anúncios do Meta cadastrada', now()
    FROM metrics_dev.ghl_accounts a WHERE a.id = ANY(v_lojas)
      AND NOT EXISTS (SELECT 1 FROM public.ad_accounts ad WHERE ad.client_id = a.client_id AND ad.is_active AND nullif(trim(ad.meta_ad_account_id), '') IS NOT NULL);
  ELSE
    INSERT INTO dash_atend.auto_itens (execucao_id, ordem, loja_id, rotulo)
    SELECT v_id, row_number() OVER (ORDER BY a.name), a.id, btrim(a.name) FROM metrics_dev.ghl_accounts a WHERE a.id = ANY(v_lojas);
  END IF;

  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (v_admin, 'rodar_automacao',
    jsonb_build_object('execucao', v_id, 'automacao', v_cat->>'nome', 'simulacao', p_simulacao, 'contas', cardinality(v_lojas)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_auto_status(p_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM dash_atend.exigir_admin();
  SELECT to_jsonb(e) || jsonb_build_object(
      'nome', (SELECT c->>'nome' FROM jsonb_array_elements(dash_atend.auto_catalogo()) c WHERE c->>'tipo' = e.tipo),
      'por', (SELECT coalesce(m.nome, u.email) FROM auth.users u LEFT JOIN dash_atend.membros m ON m.user_id = u.id WHERE u.id = e.criado_por),
      'agora', now(),
      'na_fila_antes', (SELECT count(*) FROM dash_atend.auto_execucoes x WHERE x.status IN ('pendente','executando') AND x.criado_em < e.criado_em AND e.status = 'pendente'),
      'itens', (SELECT jsonb_agg(to_jsonb(i) - 'alvo' || jsonb_build_object(
          'media_seg', (SELECT round(avg(extract(epoch FROM h.concluido_em - h.iniciado_em))) FROM (
             SELECT h2.* FROM dash_atend.auto_itens h2 JOIN dash_atend.auto_execucoes e2 ON e2.id = h2.execucao_id
             WHERE e2.tipo = e.tipo AND h2.loja_id = i.loja_id AND h2.status = 'ok' AND h2.id <> i.id ORDER BY h2.concluido_em DESC LIMIT 5) h))
        ORDER BY i.ordem) FROM dash_atend.auto_itens i WHERE i.execucao_id = e.id))
    INTO v FROM dash_atend.auto_execucoes e WHERE e.id = p_id;
  IF v IS NULL THEN RAISE EXCEPTION 'Execução não encontrada'; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_auto_lista(p_limite int DEFAULT 30) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.id DESC) FROM (
    SELECT e.id, e.tipo, e.simulacao, e.params, e.status, e.criado_em, e.iniciado_em, e.concluido_em, e.erro, e.origem_id,
      (SELECT c->>'nome' FROM jsonb_array_elements(dash_atend.auto_catalogo()) c WHERE c->>'tipo' = e.tipo) nome,
      (SELECT coalesce(m.nome, u.email) FROM auth.users u LEFT JOIN dash_atend.membros m ON m.user_id = u.id WHERE u.id = e.criado_por) por,
      (SELECT count(*) FROM dash_atend.auto_itens i WHERE i.execucao_id = e.id) total,
      (SELECT count(*) FROM dash_atend.auto_itens i WHERE i.execucao_id = e.id AND i.status IN ('ok','falhou','ignorado','cancelado')) feitos,
      (SELECT count(*) FROM dash_atend.auto_itens i WHERE i.execucao_id = e.id AND i.status = 'falhou') falhas,
      (SELECT string_agg(i.rotulo, ', ' ORDER BY i.ordem) FROM (SELECT * FROM dash_atend.auto_itens i WHERE i.execucao_id = e.id ORDER BY i.ordem LIMIT 4) i) contas
    FROM dash_atend.auto_execucoes e ORDER BY e.id DESC LIMIT greatest(1, least(p_limite, 100))) x), '[]');
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_auto_cancelar(p_id bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin uuid := dash_atend.exigir_admin(); v_status text;
BEGIN
  UPDATE dash_atend.auto_execucoes SET cancelar = true,
    status = CASE WHEN status = 'pendente' THEN 'cancelado' ELSE status END,
    concluido_em = CASE WHEN status = 'pendente' THEN now() ELSE concluido_em END
  WHERE id = p_id AND status IN ('pendente','executando') RETURNING status INTO v_status;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Esta execução já terminou'; END IF;
  IF v_status = 'cancelado' THEN
    UPDATE dash_atend.auto_itens SET status = 'cancelado', concluido_em = now() WHERE execucao_id = p_id AND status = 'pendente';
  END IF;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (v_admin, 'cancelar_automacao', jsonb_build_object('execucao', p_id));
  RETURN jsonb_build_object('status', v_status);
END $$;

-- ---------- Funções do n8n (service_role) ----------
CREATE OR REPLACE FUNCTION public.atend_service_auto_pegar(p_n8n text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v dash_atend.auto_execucoes;
BEGIN
  -- Execução travada (n8n caiu no meio): sem sinal há 2 h vira falha
  UPDATE dash_atend.auto_itens i SET status = 'falhou', erro = 'Interrompida: o n8n parou de responder', concluido_em = now()
  FROM dash_atend.auto_execucoes e WHERE e.id = i.execucao_id AND e.status = 'executando' AND coalesce(e.atualizado_em, e.iniciado_em) < now() - interval '2 hours' AND i.status IN ('pendente','executando');
  UPDATE dash_atend.auto_execucoes SET status = 'falhou', erro = 'Interrompida: o n8n parou de responder', concluido_em = now()
  WHERE status = 'executando' AND coalesce(atualizado_em, iniciado_em) < now() - interval '2 hours';
  -- Uma por vez
  IF EXISTS (SELECT 1 FROM dash_atend.auto_execucoes WHERE status = 'executando') THEN RETURN NULL; END IF;
  SELECT * INTO v FROM dash_atend.auto_execucoes WHERE status = 'pendente' ORDER BY criado_em LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v.id IS NULL THEN RETURN NULL; END IF;
  UPDATE dash_atend.auto_execucoes SET status = 'executando', iniciado_em = now(), atualizado_em = now(), n8n_execucao = p_n8n WHERE id = v.id;
  RETURN jsonb_build_object('id', v.id, 'tipo', v.tipo, 'simulacao', v.simulacao, 'params', v.params,
    'itens', (SELECT jsonb_agg(jsonb_build_object('id', i.id, 'loja_id', i.loja_id, 'rotulo', i.rotulo, 'alvo', i.alvo,
        'location_id', a.ghl_location_id, 'pipeline_id', a.ghl_pipeline_id, 'timezone', a.timezone) ORDER BY i.ordem)
      FROM dash_atend.auto_itens i LEFT JOIN metrics_dev.ghl_accounts a ON a.id = i.loja_id
      WHERE i.execucao_id = v.id AND i.status = 'pendente'));
END $$;

CREATE OR REPLACE FUNCTION public.atend_service_auto_item(p_item bigint, p_status text, p_resultado jsonb DEFAULT NULL, p_erro text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_exec bigint; v_cancelar boolean;
BEGIN
  IF p_status NOT IN ('executando','ok','falhou','ignorado','cancelado') THEN RAISE EXCEPTION 'status invalido'; END IF;
  UPDATE dash_atend.auto_itens SET status = p_status,
    iniciado_em = CASE WHEN p_status = 'executando' THEN now() ELSE iniciado_em END,
    concluido_em = CASE WHEN p_status = 'executando' THEN NULL ELSE now() END,
    resultado = coalesce(p_resultado, resultado), erro = left(p_erro, 2000)
  WHERE id = p_item RETURNING execucao_id INTO v_exec;
  UPDATE dash_atend.auto_execucoes SET atualizado_em = now() WHERE id = v_exec RETURNING cancelar INTO v_cancelar;
  RETURN jsonb_build_object('cancelar', coalesce(v_cancelar, false));
END $$;

CREATE OR REPLACE FUNCTION public.atend_service_auto_fim(p_id bigint, p_erro text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE dash_atend.auto_itens SET status = 'cancelado', concluido_em = now()
  WHERE execucao_id = p_id AND status IN ('pendente','executando');
  UPDATE dash_atend.auto_execucoes e SET
    status = CASE WHEN p_erro IS NOT NULL THEN 'falhou' WHEN e.cancelar THEN 'cancelado' ELSE 'concluido' END,
    erro = left(p_erro, 2000), concluido_em = now(), atualizado_em = now()
  WHERE e.id = p_id;
  -- Dados novos no banco: o painel não deve mostrar o resultado guardado antigo
  IF (SELECT tipo FROM dash_atend.auto_execucoes WHERE id = p_id) IN ('recarregar','anuncios_meta','etapas') THEN DELETE FROM dash_atend.cache; END IF;
END $$;

REVOKE ALL ON FUNCTION public.atend_admin_auto_catalogo(), public.atend_admin_auto_criar(text,bigint[],jsonb,boolean,bigint),
  public.atend_admin_auto_status(bigint), public.atend_admin_auto_lista(int), public.atend_admin_auto_cancelar(bigint),
  public.atend_service_auto_pegar(text), public.atend_service_auto_item(bigint,text,jsonb,text), public.atend_service_auto_fim(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_auto_catalogo(), public.atend_admin_auto_criar(text,bigint[],jsonb,boolean,bigint),
  public.atend_admin_auto_status(bigint), public.atend_admin_auto_lista(int), public.atend_admin_auto_cancelar(bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_service_auto_pegar(text), public.atend_service_auto_item(bigint,text,jsonb,text), public.atend_service_auto_fim(bigint,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_auto_pegar(text), public.atend_service_auto_item(bigint,text,jsonb,text), public.atend_service_auto_fim(bigint,text) TO service_role;

-- Ajustes aplicados depois (migrations dash_atend_automacoes_rotulo_meta, _sem_meta, _nome_limpo, dash_atend_cache_delete_com_where):
--  * "Atualizar anúncios e investimento do Meta" saiu do catálogo: o fluxo do n8n tem uma versão em edição diferente da publicada.
--  * Nome da conta sem quebra de linha: btrim(a.name, E' \n\r\t').
--  * dash_atend.limpar_cache() e atend_service_auto_fim usam DELETE ... WHERE true (o PostgREST recusa DELETE sem WHERE;
--    isso fazia atend_service_salvar_etapas falhar desde o cache de 29/10).
CREATE OR REPLACE FUNCTION dash_atend.limpar_cache() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN DELETE FROM dash_atend.cache WHERE true; RETURN NULL; END $function$;
