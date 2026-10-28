-- Dashboard de Atendimentos v2: nomes de etapas, vendas por etapa, investimento, anúncios,
-- metas, histórico de acessos e fila de envio para o WhatsApp.

-- ========== Tabelas ==========
CREATE TABLE IF NOT EXISTS dash_atend.etapa_nomes (
  loja_id bigint NOT NULL,
  stage_id text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('crm', 'manual')),
  nome text NOT NULL,
  posicao int,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  PRIMARY KEY (loja_id, stage_id, origem)
);
COMMENT ON TABLE dash_atend.etapa_nomes IS 'Nomes das etapas do funil: origem crm (sincronizado do GHL pelo n8n) ou manual (definido pelo ADM, tem prioridade).';
ALTER TABLE dash_atend.etapa_nomes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS dash_atend.sync_etapas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_em timestamptz NOT NULL DEFAULT now(),
  pedido_por uuid,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'rodando', 'ok', 'falhou')),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  resultado jsonb
);
COMMENT ON TABLE dash_atend.sync_etapas IS 'Pedidos e execuções da sincronização dos nomes das etapas com o CRM.';
ALTER TABLE dash_atend.sync_etapas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS dash_atend.metas (
  loja_id bigint PRIMARY KEY,               -- 0 = meta padrão para todas as lojas
  meta_sla numeric CHECK (meta_sla BETWEEN 0 AND 100),
  meta_resposta numeric CHECK (meta_resposta BETWEEN 0 AND 100),
  meta_tempo_min numeric CHECK (meta_tempo_min >= 0),
  meta_custo_atend numeric CHECK (meta_custo_atend >= 0),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
COMMENT ON TABLE dash_atend.metas IS 'Metas por loja (loja_id 0 = padrão): % no SLA, % de resposta, tempo de 1a resposta e custo por atendimento.';
ALTER TABLE dash_atend.metas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS dash_atend.acessos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acessos_user_em ON dash_atend.acessos (user_id, em DESC);
COMMENT ON TABLE dash_atend.acessos IS 'Aberturas do painel (no máximo uma a cada 30 min por pessoa).';
ALTER TABLE dash_atend.acessos ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS dash_atend.envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid NOT NULL,
  destino text NOT NULL CHECK (destino IN ('loja', 'levelup')),
  loja_id bigint,
  destino_nome text NOT NULL,
  grupo_jid text NOT NULL CHECK (grupo_jid ~ '^[0-9]+@g\.us$'),
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 20000),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviando', 'enviado', 'falhou', 'incerto')),
  tentativas int NOT NULL DEFAULT 0,
  erro text,
  provider_id text,
  enviado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS envios_status ON dash_atend.envios (status, criado_em);
COMMENT ON TABLE dash_atend.envios IS 'Fila de mensagens do painel para o WhatsApp. O grupo é resolvido no banco; o n8n envia e registra o resultado.';
ALTER TABLE dash_atend.envios ENABLE ROW LEVEL SECURITY;

-- ========== Utilitários ==========
CREATE OR REPLACE FUNCTION dash_atend.norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT trim(upper(translate(coalesce(p, ''), 'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç_', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc ')))
$$;

-- Etapa de venda (vendido, venda realizada, sucesso, fechamento) sem pegar insucesso / não vendido / perdido
CREATE OR REPLACE FUNCTION dash_atend.etapa_venda(p_nome text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT dash_atend.norm(p_nome) ~ '\m(VENDID|VENDA|SUCESSO|FECHAMENTO|FECHAMOS)'
     AND dash_atend.norm(p_nome) !~ '\m(NAO|INSUCESSO|PERD|SEM VENDA)'
$$;

-- Etapa que indica avanço comercial (condição de pagamento, simulação, ficha, visita, negociação ou venda)
CREATE OR REPLACE FUNCTION dash_atend.etapa_avanco(p_nome text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT dash_atend.norm(p_nome) ~ '\m(COND|CONDICAO|SIMULA|FICHA|CREDITO APROV|LIBEROU|VISIT|AGEND|NEGOCIA|PROPOSTA|VENDID|VENDA|SUCESSO|FECHA)'
     AND dash_atend.norm(p_nome) !~ '\m(NAO|INSUCESSO|PERD)'
$$;

-- Nome de cada etapa por loja: manual > CRM > mapeamento do relatório > mapeamento do pipeline
CREATE OR REPLACE FUNCTION dash_atend.nomes_etapas(v_contas bigint[])
RETURNS TABLE (loja_id bigint, stage_id text, nome text, posicao int)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT DISTINCT ON (s.loja_id, s.stage_id) s.loja_id, s.stage_id, s.nome, s.posicao
  FROM (
    SELECT e.loja_id, e.stage_id, e.nome, e.posicao, CASE e.origem WHEN 'manual' THEN 0 ELSE 1 END AS pri
    FROM dash_atend.etapa_nomes e WHERE e.loja_id = ANY(v_contas)
    UNION ALL
    SELECT x.id, m.value, m.key, NULL::int, 2 FROM metrics_dev.ghl_accounts x
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(x.weekly_report_stage_mapping, '{}'::jsonb)) m WHERE x.id = ANY(v_contas)
    UNION ALL
    SELECT x.id, m.value, m.key, NULL::int, 3 FROM metrics_dev.ghl_accounts x
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(x.pipeline_stage_mapping, '{}'::jsonb)) m WHERE x.id = ANY(v_contas)
  ) s
  ORDER BY s.loja_id, s.stage_id, s.pri, s.nome
$$;

-- Oportunidades que entraram numa etapa de venda no período atual / anterior
CREATE OR REPLACE FUNCTION dash_atend.vendas_etapa(p_inicio date, p_fim date, v_contas bigint[])
RETURNS TABLE (loja_id bigint, vendedor_id text, periodo text, ghl_opportunity_id text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH p AS (
    SELECT COALESCE(p_fim, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) AS fim,
           COALESCE(p_inicio, COALESCE(p_fim, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) - 6) AS ini
  ), per AS (SELECT ini, fim, ini - (fim - ini + 1) AS ant_ini, ini - 1 AS ant_fim FROM p),
  n AS (SELECT * FROM dash_atend.nomes_etapas(v_contas) x WHERE dash_atend.etapa_venda(x.nome)),
  e AS (
    SELECT h.ghl_account_id AS loja_id, h.assigned_ghl_user_id AS vendedor_id, h.ghl_opportunity_id, h.entered_at,
      CASE WHEN (h.entered_at AT TIME ZONE a.timezone)::date BETWEEN per.ini AND per.fim THEN 'atual' ELSE 'anterior' END AS periodo
    FROM metrics_dev.ghl_opportunity_stage_history h
    JOIN metrics_dev.ghl_accounts a ON a.id = h.ghl_account_id AND h.pipeline_id = a.ghl_pipeline_id
    JOIN n ON n.loja_id = h.ghl_account_id AND n.stage_id = h.stage_id
    CROSS JOIN per
    WHERE h.ghl_account_id = ANY(v_contas) AND h.entry_time_source = 'ghl_last_stage_change'
      AND (h.entered_at AT TIME ZONE a.timezone)::date BETWEEN per.ant_ini AND per.fim
  )
  SELECT DISTINCT ON (e.loja_id, e.ghl_opportunity_id, e.periodo) e.loja_id, e.vendedor_id, e.periodo, e.ghl_opportunity_id
  FROM e ORDER BY e.loja_id, e.ghl_opportunity_id, e.periodo, e.entered_at
$$;

-- Empresas (clientes) cujo investimento o usuário pode ver:
-- admin vê todas; membro de loja só vê se tiver acesso a todas as subcontas ativas da empresa.
CREATE OR REPLACE FUNCTION dash_atend.clientes_visiveis(v_contas bigint[])
RETURNS bigint[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m dash_atend.membros; r bigint[];
BEGIN
  m := dash_atend.membro_atual();
  IF m.id IS NULL THEN RETURN '{}'; END IF;
  SELECT array_agg(DISTINCT a.client_id) INTO r
  FROM metrics_dev.ghl_accounts a
  WHERE a.id = ANY(v_contas) AND a.client_id IS NOT NULL
    AND (m.papel = 'admin' OR NOT EXISTS (
      SELECT 1 FROM metrics_dev.ghl_accounts b
      WHERE b.client_id = a.client_id AND b.is_active AND NOT (b.id = ANY(m.lojas))));
  RETURN COALESCE(r, '{}');
END $$;

-- ========== Investimento e custo por atendimento ==========
CREATE OR REPLACE FUNCTION public.atend_investimento(p_inicio date, p_fim date, p_conta bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_contas bigint[] := dash_atend.contas_permitidas(p_conta);
  v_cli bigint[];
  v_todas bigint[];
  v_fim date := COALESCE(p_fim, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1);
  v_ini date := COALESCE(p_inicio, COALESCE(p_fim, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) - 6);
  v_aini date; v_afim date;
  v_ocultas int;
BEGIN
  v_aini := v_ini - (v_fim - v_ini + 1); v_afim := v_ini - 1;
  v_cli := dash_atend.clientes_visiveis(v_contas);
  v_todas := ARRAY(SELECT a.id FROM metrics_dev.ghl_accounts a WHERE a.is_active AND a.client_id = ANY(v_cli));
  SELECT count(DISTINCT a.client_id) INTO v_ocultas FROM metrics_dev.ghl_accounts a
   WHERE a.id = ANY(v_contas) AND a.client_id IS NOT NULL AND NOT (a.client_id = ANY(v_cli));
  RETURN (
    WITH gasto AS (
      SELECT aa.client_id,
        sum(r.spend) FILTER (WHERE r.report_date BETWEEN v_ini AND v_fim) AS inv,
        sum(r.spend) FILTER (WHERE r.report_date BETWEEN v_aini AND v_afim) AS inv_ant,
        count(DISTINCT r.report_date) FILTER (WHERE r.report_date BETWEEN v_ini AND v_fim) AS dias_com_dado
      FROM public.account_daily_reports r JOIN public.ad_accounts aa ON aa.id = r.ad_account_id
      WHERE aa.client_id = ANY(v_cli) AND r.report_date BETWEEN v_aini AND v_fim
      GROUP BY aa.client_id
    ), ult AS (
      SELECT aa.client_id, max(r.report_date) AS ultimo_dia
      FROM public.account_daily_reports r JOIN public.ad_accounts aa ON aa.id = r.ad_account_id
      WHERE aa.client_id = ANY(v_cli) GROUP BY aa.client_id
    ), at AS (
      SELECT a.client_id, count(*) FILTER (WHERE r.periodo = 'atual') AS atend, count(*) FILTER (WHERE r.periodo = 'anterior') AS atend_ant
      FROM dash_atend.resp(v_ini, v_fim, v_todas) r JOIN metrics_dev.ghl_accounts a ON a.id = r.loja_id GROUP BY a.client_id
    ), vd AS (
      SELECT a.client_id, count(*) FILTER (WHERE c.periodo = 'atual') AS vendas, count(*) FILTER (WHERE c.periodo = 'anterior') AS vendas_ant
      FROM dash_atend.conv(v_ini, v_fim, v_todas) c JOIN metrics_dev.ghl_accounts a ON a.id = c.loja_id GROUP BY a.client_id
    ), ve AS (
      SELECT a.client_id, count(*) FILTER (WHERE v.periodo = 'atual') AS vendas_etapa, count(*) FILTER (WHERE v.periodo = 'anterior') AS vendas_etapa_ant
      FROM dash_atend.vendas_etapa(v_ini, v_fim, v_todas) v JOIN metrics_dev.ghl_accounts a ON a.id = v.loja_id GROUP BY a.client_id
    ), linhas AS (
      SELECT c.id AS cliente_id, c.name AS empresa,
        (SELECT count(*) FROM metrics_dev.ghl_accounts x WHERE x.client_id = c.id AND x.is_active) AS subcontas,
        (SELECT jsonb_agg(trim(both chr(10) from x.name) ORDER BY x.name) FROM metrics_dev.ghl_accounts x WHERE x.client_id = c.id AND x.is_active) AS subcontas_nomes,
        round(COALESCE(g.inv, 0), 2) AS investimento, round(COALESCE(g.inv_ant, 0), 2) AS investimento_ant,
        COALESCE(g.dias_com_dado, 0) AS dias_com_dado, u.ultimo_dia,
        COALESCE(t.atend, 0) AS atendimentos, COALESCE(t.atend_ant, 0) AS atendimentos_ant,
        GREATEST(COALESCE(v.vendas, 0), COALESCE(e.vendas_etapa, 0)) AS vendas,
        GREATEST(COALESCE(v.vendas_ant, 0), COALESCE(e.vendas_etapa_ant, 0)) AS vendas_ant
      FROM public.clients c
      LEFT JOIN gasto g ON g.client_id = c.id LEFT JOIN ult u ON u.client_id = c.id
      LEFT JOIN at t ON t.client_id = c.id LEFT JOIN vd v ON v.client_id = c.id LEFT JOIN ve e ON e.client_id = c.id
      WHERE c.id = ANY(v_cli)
    ), calc AS (
      SELECT l.*,
        (l.dias_com_dado > 0) AS tem_dados,
        CASE WHEN l.dias_com_dado > 0 THEN round(l.investimento / NULLIF(l.atendimentos, 0), 2) END AS custo_atend,
        CASE WHEN l.investimento_ant > 0 THEN round(l.investimento_ant / NULLIF(l.atendimentos_ant, 0), 2) END AS custo_atend_ant,
        CASE WHEN l.dias_com_dado > 0 THEN round(l.investimento / NULLIF(l.vendas, 0), 2) END AS custo_venda,
        round(100.0 * (l.investimento - l.investimento_ant) / NULLIF(l.investimento_ant, 0), 1) AS var_investimento
      FROM linhas l
    ), tot AS (
      SELECT sum(investimento) AS investimento, sum(investimento_ant) AS investimento_ant,
        sum(atendimentos) AS atendimentos_todos,
        sum(atendimentos) FILTER (WHERE tem_dados) AS atendimentos,
        sum(atendimentos_ant) FILTER (WHERE investimento_ant > 0) AS atendimentos_ant,
        sum(vendas) FILTER (WHERE tem_dados) AS vendas, count(*) AS empresas, sum(subcontas) AS subcontas,
        count(*) FILTER (WHERE NOT tem_dados) AS empresas_sem_dados,
        jsonb_agg(empresa ORDER BY empresa) FILTER (WHERE NOT tem_dados) AS nomes_sem_dados
      FROM calc
    )
    SELECT jsonb_build_object(
      'de', v_ini, 'ate', v_fim, 'de_ant', v_aini, 'ate_ant', v_afim,
      'empresas_ocultas', v_ocultas,
      'empresas', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.investimento DESC, c.empresa) FROM calc c), '[]'::jsonb),
      'total', (SELECT jsonb_build_object(
        'empresas', t.empresas, 'subcontas', t.subcontas,
        'investimento', round(COALESCE(t.investimento, 0), 2), 'investimento_ant', round(COALESCE(t.investimento_ant, 0), 2),
        'var_investimento', round(100.0 * (t.investimento - t.investimento_ant) / NULLIF(t.investimento_ant, 0), 1),
        'atendimentos', COALESCE(t.atendimentos, 0), 'atendimentos_todos', COALESCE(t.atendimentos_todos, 0), 'vendas', COALESCE(t.vendas, 0),
        'empresas_sem_dados', t.empresas_sem_dados, 'nomes_sem_dados', COALESCE(t.nomes_sem_dados, '[]'::jsonb),
        'custo_atend', round(t.investimento / NULLIF(t.atendimentos, 0), 2),
        'custo_atend_ant', round(t.investimento_ant / NULLIF(t.atendimentos_ant, 0), 2),
        'var_custo_atend', round(t.investimento / NULLIF(t.atendimentos, 0) - t.investimento_ant / NULLIF(t.atendimentos_ant, 0), 2),
        'custo_venda', round(t.investimento / NULLIF(t.vendas, 0), 2)
      ) FROM tot t)
    )
  );
END $$;

-- ========== Anúncios e veículos que trazem lead ==========
CREATE OR REPLACE FUNCTION public.atend_anuncios(p_inicio date, p_fim date, p_conta bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_contas bigint[] := dash_atend.contas_permitidas(p_conta);
  v_cli bigint[];
  v_fim date := COALESCE(p_fim, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1);
  v_ini date := COALESCE(p_inicio, COALESCE(p_fim, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) - 6);
BEGIN
  v_cli := dash_atend.clientes_visiveis(v_contas);
  RETURN (
    WITH nomes AS (SELECT * FROM dash_atend.nomes_etapas(v_contas)),
    leads AS (
      SELECT l.attendance_id, l.meta_ad_id,
        NULLIF(trim(COALESCE(l.ad_name_written, l.ad_title)), '') AS titulo,
        NULLIF(upper(trim(l.vehicle_written)), '') AS veiculo, NULLIF(trim(l.price_written), '') AS preco,
        t.ghl_account_id AS loja_id, t.ghl_opportunity_id, a.client_id,
        (t.first_human_response_at IS NOT NULL) AS respondido,
        (t.converted_at IS NOT NULL OR lower(COALESCE(t.opportunity_status, '')) = 'won') AS ganho
      FROM metrics_dev.ghl_lead_ad_attribution l
      JOIN metrics_dev.ghl_attendances t ON t.id = l.attendance_id
      JOIN metrics_dev.ghl_accounts a ON a.id = t.ghl_account_id
      WHERE t.ghl_account_id = ANY(v_contas) AND (l.ad_message_at AT TIME ZONE a.timezone)::date BETWEEN v_ini AND v_fim
    ), marcos AS (
      SELECT h.ghl_account_id AS loja_id, h.ghl_opportunity_id,
        bool_or(dash_atend.etapa_avanco(n.nome)) AS avancou, bool_or(dash_atend.etapa_venda(n.nome)) AS vendeu
      FROM metrics_dev.ghl_opportunity_stage_history h
      JOIN nomes n ON n.loja_id = h.ghl_account_id AND n.stage_id = h.stage_id
      WHERE h.ghl_account_id = ANY(v_contas) AND h.ghl_opportunity_id IN (SELECT ghl_opportunity_id FROM leads WHERE ghl_opportunity_id IS NOT NULL)
      GROUP BY 1, 2
    ), base AS (
      SELECT l.*, COALESCE(m.avancou, false) AS avancou, (l.ganho OR COALESCE(m.vendeu, false)) AS vendeu
      FROM leads l LEFT JOIN marcos m ON m.loja_id = l.loja_id AND m.ghl_opportunity_id = l.ghl_opportunity_id
    ), gasto AS (
      SELECT ad.meta_ad_id, sum(r.spend) AS inv
      FROM public.ad_daily_reports r JOIN public.ads ad ON ad.id = r.ad_id JOIN public.ad_accounts aa ON aa.id = ad.ad_account_id
      WHERE aa.client_id = ANY(v_cli) AND r.report_date BETWEEN v_ini AND v_fim AND ad.meta_ad_id IN (SELECT meta_ad_id FROM leads)
      GROUP BY ad.meta_ad_id
    ), leads_empresa AS (   -- todos os leads do anúncio na empresa (o investimento do anúncio é da empresa inteira)
      SELECT l.meta_ad_id, count(*) AS n
      FROM metrics_dev.ghl_lead_ad_attribution l
      JOIN metrics_dev.ghl_attendances t ON t.id = l.attendance_id
      JOIN metrics_dev.ghl_accounts a ON a.id = t.ghl_account_id
      WHERE a.client_id = ANY(v_cli) AND l.meta_ad_id IN (SELECT meta_ad_id FROM leads)
        AND (l.ad_message_at AT TIME ZONE a.timezone)::date BETWEEN v_ini AND v_fim
      GROUP BY l.meta_ad_id
    ), por_anuncio AS (
      SELECT b.meta_ad_id,
        COALESCE(max(ad.name), max(b.titulo), 'Anúncio sem nome') AS anuncio,
        mode() WITHIN GROUP (ORDER BY b.veiculo) AS veiculo, mode() WITHIN GROUP (ORDER BY b.preco) AS preco,
        max(ad.effective_status) AS status,
        count(*) AS leads, count(*) FILTER (WHERE b.respondido) AS respondidos,
        count(*) FILTER (WHERE b.avancou) AS avancaram, count(*) FILTER (WHERE b.vendeu) AS vendas,
        bool_and(b.client_id = ANY(v_cli)) AS inv_visivel,
        string_agg(DISTINCT trim(both chr(10) from ac.name), ', ') AS lojas
      FROM base b
      LEFT JOIN public.ads ad ON ad.meta_ad_id = b.meta_ad_id
      JOIN metrics_dev.ghl_accounts ac ON ac.id = b.loja_id
      GROUP BY b.meta_ad_id
    ), anuncios AS (
      SELECT p.*, p.meta_ad_id AS chave,
        round(100.0 * p.respondidos / NULLIF(p.leads, 0), 1) AS taxa_resposta,
        round(100.0 * p.avancaram / NULLIF(p.leads, 0), 1) AS taxa_avanco,
        CASE WHEN p.inv_visivel THEN round(g.inv, 2) END AS investimento,
        CASE WHEN p.inv_visivel THEN round(g.inv / NULLIF(le.n, 0), 2) END AS custo_lead
      FROM por_anuncio p LEFT JOIN gasto g ON g.meta_ad_id = p.meta_ad_id LEFT JOIN leads_empresa le ON le.meta_ad_id = p.meta_ad_id
    ), veiculos AS (
      SELECT b.veiculo, b.veiculo AS chave, count(*) AS leads, count(*) FILTER (WHERE b.respondido) AS respondidos,
        count(*) FILTER (WHERE b.avancou) AS avancaram, count(*) FILTER (WHERE b.vendeu) AS vendas,
        count(DISTINCT b.meta_ad_id) AS anuncios, mode() WITHIN GROUP (ORDER BY b.preco) AS preco,
        round(100.0 * count(*) FILTER (WHERE b.avancou) / NULLIF(count(*), 0), 1) AS taxa_avanco
      FROM base b WHERE b.veiculo IS NOT NULL GROUP BY b.veiculo
    )
    SELECT jsonb_build_object(
      'de', v_ini, 'ate', v_fim,
      'leads_com_anuncio', (SELECT count(*) FROM base),
      'anuncios_distintos', (SELECT count(*) FROM anuncios),
      'veiculos_distintos', (SELECT count(*) FROM veiculos),
      'investimento_visivel', COALESCE(array_length(v_cli, 1), 0) > 0,
      'anuncios', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'inv_visivel' ORDER BY x.leads DESC, x.anuncio) FROM (SELECT * FROM anuncios ORDER BY leads DESC, anuncio LIMIT 50) x), '[]'::jsonb),
      'veiculos', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.leads DESC, x.veiculo) FROM (SELECT * FROM veiculos ORDER BY leads DESC, veiculo LIMIT 30) x), '[]'::jsonb)
    )
  );
END $$;

-- ========== Metas ==========
CREATE OR REPLACE FUNCTION public.atend_metas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_contas bigint[] := dash_atend.contas_permitidas(NULL);
BEGIN
  RETURN jsonb_build_object(
    'padrao', (SELECT to_jsonb(m) - 'atualizado_por' FROM dash_atend.metas m WHERE m.loja_id = 0),
    'lojas', COALESCE((SELECT jsonb_object_agg(m.loja_id::text, to_jsonb(m) - 'atualizado_por') FROM dash_atend.metas m WHERE m.loja_id = ANY(v_contas)), '{}'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_metas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN jsonb_build_object(
    'padrao', (SELECT to_jsonb(m) - 'atualizado_por' FROM dash_atend.metas m WHERE m.loja_id = 0),
    'lojas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('loja_id', a.id, 'loja', trim(both chr(10) from a.name),
        'meta_sla', m.meta_sla, 'meta_resposta', m.meta_resposta, 'meta_tempo_min', m.meta_tempo_min, 'meta_custo_atend', m.meta_custo_atend,
        'personalizada', m.loja_id IS NOT NULL) ORDER BY a.name)
      FROM metrics_dev.ghl_accounts a LEFT JOIN dash_atend.metas m ON m.loja_id = a.id WHERE a.is_active), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_salvar_meta(p_loja bigint, p_sla numeric, p_resposta numeric, p_tempo numeric, p_custo numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin uuid := dash_atend.exigir_admin(); v_loja bigint := COALESCE(p_loja, 0);
BEGIN
  IF v_loja <> 0 AND NOT EXISTS (SELECT 1 FROM metrics_dev.ghl_accounts a WHERE a.id = v_loja) THEN RAISE EXCEPTION 'Loja nao encontrada'; END IF;
  IF p_sla IS NULL AND p_resposta IS NULL AND p_tempo IS NULL AND p_custo IS NULL THEN
    DELETE FROM dash_atend.metas WHERE loja_id = v_loja;   -- sem nenhuma meta: volta a usar o padrão
  ELSE
    INSERT INTO dash_atend.metas (loja_id, meta_sla, meta_resposta, meta_tempo_min, meta_custo_atend, atualizado_por)
    VALUES (v_loja, p_sla, p_resposta, p_tempo, p_custo, v_admin)
    ON CONFLICT (loja_id) DO UPDATE SET meta_sla = EXCLUDED.meta_sla, meta_resposta = EXCLUDED.meta_resposta,
      meta_tempo_min = EXCLUDED.meta_tempo_min, meta_custo_atend = EXCLUDED.meta_custo_atend, atualizado_em = now(), atualizado_por = v_admin;
  END IF;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (v_admin, 'salvar_meta', jsonb_build_object('loja', v_loja, 'sla', p_sla, 'resposta', p_resposta, 'tempo', p_tempo, 'custo', p_custo));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ========== Etapas (nomes) ==========
CREATE OR REPLACE FUNCTION public.atend_admin_etapas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN jsonb_build_object(
    'ultima_sync', (SELECT to_jsonb(s) FROM dash_atend.sync_etapas s ORDER BY s.id DESC LIMIT 1),
    'etapas', COALESCE((
      WITH usadas AS (
        SELECT h.ghl_account_id AS loja_id, h.stage_id,
          count(*) FILTER (WHERE h.entered_at > now() - interval '30 days') AS entradas_30d, max(h.entered_at) AS ultima_entrada
        FROM metrics_dev.ghl_opportunity_stage_history h
        JOIN metrics_dev.ghl_accounts a ON a.id = h.ghl_account_id AND a.is_active AND h.pipeline_id = a.ghl_pipeline_id
        GROUP BY 1, 2
      ), todas AS (
        SELECT loja_id, stage_id FROM usadas
        UNION SELECT e.loja_id, e.stage_id FROM dash_atend.etapa_nomes e JOIN metrics_dev.ghl_accounts a ON a.id = e.loja_id AND a.is_active
      ), res AS (SELECT * FROM dash_atend.nomes_etapas(ARRAY(SELECT id FROM metrics_dev.ghl_accounts WHERE is_active)))
      SELECT jsonb_agg(jsonb_build_object(
          'chave', t.loja_id || ':' || t.stage_id, 'loja_id', t.loja_id, 'loja', trim(both chr(10) from a.name), 'stage_id', t.stage_id,
          'nome', r.nome, 'nome_crm', c.nome, 'nome_manual', mn.nome, 'posicao', COALESCE(c.posicao, r.posicao),
          'entradas_30d', COALESCE(u.entradas_30d, 0), 'ultima_entrada', u.ultima_entrada,
          'venda', dash_atend.etapa_venda(r.nome), 'avanco', dash_atend.etapa_avanco(r.nome))
        ORDER BY a.name, COALESCE(c.posicao, 999), r.nome NULLS LAST)
      FROM todas t
      JOIN metrics_dev.ghl_accounts a ON a.id = t.loja_id
      LEFT JOIN usadas u ON u.loja_id = t.loja_id AND u.stage_id = t.stage_id
      LEFT JOIN res r ON r.loja_id = t.loja_id AND r.stage_id = t.stage_id
      LEFT JOIN dash_atend.etapa_nomes c ON c.loja_id = t.loja_id AND c.stage_id = t.stage_id AND c.origem = 'crm'
      LEFT JOIN dash_atend.etapa_nomes mn ON mn.loja_id = t.loja_id AND mn.stage_id = t.stage_id AND mn.origem = 'manual'
    ), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_salvar_etapa(p_loja bigint, p_stage text, p_nome text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin uuid := dash_atend.exigir_admin(); v_nome text := NULLIF(trim(p_nome), '');
BEGIN
  IF p_stage IS NULL OR length(p_stage) > 200 THEN RAISE EXCEPTION 'Etapa invalida'; END IF;
  IF v_nome IS NOT NULL AND length(v_nome) > 80 THEN RAISE EXCEPTION 'Nome muito longo (max. 80)'; END IF;
  IF v_nome IS NULL THEN
    DELETE FROM dash_atend.etapa_nomes WHERE loja_id = p_loja AND stage_id = p_stage AND origem = 'manual';
  ELSE
    INSERT INTO dash_atend.etapa_nomes (loja_id, stage_id, origem, nome, atualizado_por) VALUES (p_loja, p_stage, 'manual', v_nome, v_admin)
    ON CONFLICT (loja_id, stage_id, origem) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now(), atualizado_por = v_admin;
  END IF;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (v_admin, 'salvar_etapa', jsonb_build_object('loja', p_loja, 'stage', p_stage, 'nome', v_nome));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_pedir_sync()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin uuid := dash_atend.exigir_admin(); v_id bigint;
BEGIN
  SELECT id INTO v_id FROM dash_atend.sync_etapas WHERE status IN ('pendente', 'rodando') AND pedido_em > now() - interval '15 minutes' ORDER BY id DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO dash_atend.sync_etapas (pedido_por) VALUES (v_admin) RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- ========== Histórico de acessos ==========
CREATE OR REPLACE FUNCTION public.atend_registrar_acesso()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m dash_atend.membros := dash_atend.membro_atual();
BEGIN
  IF m.id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM dash_atend.acessos a WHERE a.user_id = m.user_id AND a.em > now() - interval '30 minutes') THEN
    INSERT INTO dash_atend.acessos (user_id) VALUES (m.user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_acessos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', x.id, 'em', x.em, 'nome', x.nome, 'email', x.email, 'papel', x.papel, 'lojas', x.lojas) ORDER BY x.em DESC)
    FROM (
      SELECT a.id, a.em, m.nome, u.email, m.papel,
        (SELECT string_agg(trim(both chr(10) from g.name), ', ' ORDER BY g.name) FROM metrics_dev.ghl_accounts g WHERE g.id = ANY(m.lojas)) AS lojas
      FROM dash_atend.acessos a
      JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN dash_atend.membros m ON m.user_id = a.user_id
      ORDER BY a.em DESC LIMIT 300
    ) x), '[]'::jsonb);
END $$;

-- ========== Envio para o WhatsApp ==========
CREATE OR REPLACE FUNCTION dash_atend.grupo_levelup()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '120363413138112195@g.us' $$;

CREATE OR REPLACE FUNCTION public.atend_admin_destinos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN jsonb_build_object(
    'levelup', jsonb_build_object('nome', 'Grupo interno Level Up (onde chega o relatório semanal)'),
    'lojas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('loja_id', a.id, 'loja', trim(both chr(10) from a.name), 'empresa', c.name,
        'tem_grupo', COALESCE(c.whatsapp_group_id, '') ~ '^[0-9]+@g\.us$') ORDER BY a.name)
      FROM metrics_dev.ghl_accounts a LEFT JOIN public.clients c ON c.id = a.client_id WHERE a.is_active), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_enviar(p_destino text, p_loja bigint, p_texto text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin uuid := dash_atend.exigir_admin(); v_jid text; v_nome text; v_id uuid; v_texto text := trim(COALESCE(p_texto, ''));
BEGIN
  IF v_texto = '' THEN RAISE EXCEPTION 'Mensagem vazia'; END IF;
  IF length(v_texto) > 20000 THEN RAISE EXCEPTION 'Mensagem muito longa (max. 20.000 caracteres)'; END IF;
  IF p_destino = 'levelup' THEN
    v_jid := dash_atend.grupo_levelup(); v_nome := 'Grupo interno Level Up';
  ELSIF p_destino = 'loja' THEN
    SELECT trim(c.whatsapp_group_id), 'Grupo da ' || c.name INTO v_jid, v_nome
    FROM metrics_dev.ghl_accounts a JOIN public.clients c ON c.id = a.client_id WHERE a.id = p_loja AND a.is_active;
    IF v_jid IS NULL OR v_jid !~ '^[0-9]+@g\.us$' THEN RAISE EXCEPTION 'Esta loja nao tem grupo de WhatsApp cadastrado'; END IF;
  ELSE
    RAISE EXCEPTION 'Destino invalido';
  END IF;
  IF (SELECT count(*) FROM dash_atend.envios e WHERE e.criado_por = v_admin AND e.criado_em > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'Limite de 30 envios por hora atingido';
  END IF;
  IF EXISTS (SELECT 1 FROM dash_atend.envios e WHERE e.grupo_jid = v_jid AND e.texto = v_texto AND e.criado_em > now() - interval '10 minutes' AND e.status <> 'falhou') THEN
    RAISE EXCEPTION 'Esta mesma mensagem ja foi enviada para este grupo nos ultimos 10 minutos';
  END IF;
  INSERT INTO dash_atend.envios (criado_por, destino, loja_id, destino_nome, grupo_jid, texto)
  VALUES (v_admin, p_destino, CASE WHEN p_destino = 'loja' THEN p_loja END, v_nome, v_jid, v_texto) RETURNING id INTO v_id;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (v_admin, 'enviar_whatsapp', jsonb_build_object('envio', v_id, 'destino', p_destino, 'loja', p_loja));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'destino', v_nome);
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_envios(p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', e.id, 'criado_em', e.criado_em, 'destino', e.destino_nome, 'status', e.status, 'erro', e.erro,
      'enviado_em', e.enviado_em, 'por', COALESCE(NULLIF(m.nome, ''), u.email), 'inicio', left(e.texto, 120)) ORDER BY e.criado_em DESC)
    FROM (SELECT * FROM dash_atend.envios x WHERE p_id IS NULL OR x.id = p_id ORDER BY x.criado_em DESC LIMIT 30) e
    LEFT JOIN dash_atend.membros m ON m.user_id = e.criado_por LEFT JOIN auth.users u ON u.id = e.criado_por), '[]'::jsonb);
END $$;

-- Usadas só pelo n8n (service_role)
CREATE OR REPLACE FUNCTION public.atend_service_envios_pegar(p_limite int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  -- envio travado em "enviando" há mais de 10 min não é reenviado automaticamente (evita duplicar)
  UPDATE dash_atend.envios SET status = 'incerto', erro = 'Sem confirmação do WhatsApp; confira o grupo antes de reenviar', atualizado_em = now()
  WHERE status = 'enviando' AND atualizado_em < now() - interval '10 minutes';
  WITH alvo AS (
    SELECT id FROM dash_atend.envios WHERE status = 'pendente' ORDER BY criado_em LIMIT GREATEST(1, LEAST(p_limite, 20)) FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE dash_atend.envios e SET status = 'enviando', tentativas = e.tentativas + 1, atualizado_em = now()
    FROM alvo WHERE e.id = alvo.id RETURNING e.id, e.grupo_jid, e.texto
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'grupo_jid', grupo_jid, 'texto', texto)), '[]'::jsonb) INTO r FROM upd;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.atend_service_envio_resultado(p_id uuid, p_status text, p_provider_id text, p_erro text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_status NOT IN ('enviado', 'falhou', 'incerto') THEN RAISE EXCEPTION 'Status invalido'; END IF;
  UPDATE dash_atend.envios SET status = p_status, provider_id = p_provider_id, erro = left(p_erro, 500),
    enviado_em = CASE WHEN p_status = 'enviado' THEN now() END, atualizado_em = now()
  WHERE id = p_id AND status = 'enviando';
  RETURN jsonb_build_object('ok', FOUND);
END $$;

CREATE OR REPLACE FUNCTION public.atend_service_sync_pegar()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint; v_ultima timestamptz;
BEGIN
  UPDATE dash_atend.sync_etapas SET status = 'falhou', resultado = jsonb_build_object('erro', 'tempo esgotado') WHERE status = 'rodando' AND iniciado_em < now() - interval '20 minutes';
  SELECT max(concluido_em) INTO v_ultima FROM dash_atend.sync_etapas WHERE status = 'ok';
  SELECT id INTO v_id FROM dash_atend.sync_etapas WHERE status = 'pendente' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN
    -- sincronização automática uma vez por dia
    IF v_ultima IS NOT NULL AND v_ultima > now() - interval '24 hours' THEN RETURN jsonb_build_object('fazer', false); END IF;
    IF EXISTS (SELECT 1 FROM dash_atend.sync_etapas WHERE status = 'rodando') THEN RETURN jsonb_build_object('fazer', false); END IF;
    INSERT INTO dash_atend.sync_etapas (status, iniciado_em) VALUES ('rodando', now()) RETURNING id INTO v_id;
  ELSE
    UPDATE dash_atend.sync_etapas SET status = 'rodando', iniciado_em = now() WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('fazer', true, 'sync_id', v_id, 'contas', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', a.id, 'location_id', a.ghl_location_id, 'pipeline_id', a.ghl_pipeline_id) ORDER BY a.id)
    FROM metrics_dev.ghl_accounts a WHERE a.is_active AND a.ghl_pipeline_id IS NOT NULL AND a.ghl_location_id IS NOT NULL), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.atend_service_salvar_etapas(p_loja bigint, p_etapas jsonb)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  INSERT INTO dash_atend.etapa_nomes (loja_id, stage_id, origem, nome, posicao)
  SELECT p_loja, e->>'id', 'crm', left(trim(e->>'name'), 120), NULLIF(e->>'position', '')::int
  FROM jsonb_array_elements(COALESCE(p_etapas, '[]'::jsonb)) e
  WHERE COALESCE(e->>'id', '') <> '' AND COALESCE(trim(e->>'name'), '') <> ''
  ON CONFLICT (loja_id, stage_id, origem) DO UPDATE SET nome = EXCLUDED.nome, posicao = EXCLUDED.posicao, atualizado_em = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.atend_service_sync_fim(p_sync_id bigint, p_ok boolean, p_resultado jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE dash_atend.sync_etapas SET status = CASE WHEN p_ok THEN 'ok' ELSE 'falhou' END, concluido_em = now(), resultado = p_resultado WHERE id = p_sync_id
$$;
