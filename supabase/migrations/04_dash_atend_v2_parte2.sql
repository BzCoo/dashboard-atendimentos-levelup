-- ========== Funções existentes atualizadas ==========
CREATE OR REPLACE FUNCTION public.atend_kpis(p_inicio date, p_fim date, p_conta bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_contas bigint[] := dash_atend.contas_permitidas(p_conta);
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) - '_ord' ORDER BY t._ord) FROM (SELECT q.*, row_number() OVER () AS _ord FROM (
WITH p AS (
  SELECT COALESCE(CAST(p_fim AS DATE), (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) AS fim,
         COALESCE(CAST(p_inicio AS DATE), (now() AT TIME ZONE 'America/Sao_Paulo')::date - 7) AS ini
), per AS (
  SELECT ini, fim, ini - (fim - ini + 1) AS ant_ini, ini - 1 AS ant_fim FROM p
), contas AS (
  SELECT a.id, trim(both chr(10) from a.name) AS loja, a.timezone AS tz, a.sla_target_seconds AS sla_alvo,
         a.sla_business_hours AS bh, a.ghl_pipeline_id
  FROM metrics_dev.ghl_accounts a
  WHERE a.is_active AND a.id = ANY(v_contas)
), base AS (SELECT 1), resp AS (SELECT * FROM dash_atend.resp(p_inicio, p_fim, v_contas)), conv AS (SELECT * FROM dash_atend.conv(p_inicio, p_fim, v_contas)), ve AS (SELECT periodo, count(*) AS n FROM dash_atend.vendas_etapa(p_inicio, p_fim, v_contas) GROUP BY periodo),
m AS (
  SELECT periodo, count(*) AS atendimentos,
    count(*) FILTER (WHERE respondido) AS respondidos,
    count(*) FILTER (WHERE NOT respondido) AS sem_resposta,
    count(*) FILTER (WHERE respondido AND seg_comercial <= sla_alvo) AS dentro_sla,
    round(100.0 * count(*) FILTER (WHERE respondido) / NULLIF(count(*), 0), 1) AS taxa_resposta,
    round(100.0 * count(*) FILTER (WHERE respondido AND seg_comercial <= sla_alvo) / NULLIF(count(*) FILTER (WHERE respondido), 0), 1) AS taxa_sla,
    round((avg(seg_comercial) FILTER (WHERE respondido) / 60)::numeric, 1) AS tempo_medio_min,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY seg_comercial) FILTER (WHERE respondido) / 60)::numeric, 1) AS tempo_mediano_min FROM resp GROUP BY periodo
), v AS (
  SELECT periodo, count(*) AS vendas FROM conv GROUP BY periodo
)
SELECT per.ini AS de, per.fim AS ate, per.ant_ini AS de_ant, per.ant_fim AS ate_ant,
  (SELECT count(*) FROM contas) AS lojas,
  (SELECT round(max(sla_alvo) / 60.0) FROM contas) AS sla_min,
  COALESCE(a.atendimentos, 0) AS atendimentos, COALESCE(b.atendimentos, 0) AS atendimentos_ant,
  round(100.0 * (COALESCE(a.atendimentos, 0) - COALESCE(b.atendimentos, 0)) / NULLIF(b.atendimentos, 0), 1) AS var_atendimentos,
  a.taxa_resposta, b.taxa_resposta AS taxa_resposta_ant, a.taxa_resposta - b.taxa_resposta AS var_taxa_resposta,
  COALESCE(a.dentro_sla, 0) AS dentro_sla, COALESCE(a.respondidos, 0) AS respondidos,
  a.taxa_sla, b.taxa_sla AS taxa_sla_ant, a.taxa_sla - b.taxa_sla AS var_taxa_sla,
  a.tempo_medio_min, b.tempo_medio_min AS tempo_medio_min_ant, a.tempo_medio_min - b.tempo_medio_min AS var_tempo_medio_min,
  a.tempo_mediano_min,
  COALESCE(a.sem_resposta, 0) AS sem_resposta, COALESCE(b.sem_resposta, 0) AS sem_resposta_ant,
  COALESCE(a.sem_resposta, 0) - COALESCE(b.sem_resposta, 0) AS var_sem_resposta,
  COALESCE(va.vendas, 0) AS vendas, COALESCE(vb.vendas, 0) AS vendas_ant,
  COALESCE(va.vendas, 0) - COALESCE(vb.vendas, 0) AS var_vendas,
  COALESCE(ea.n, 0) AS vendas_etapa, COALESCE(eb.n, 0) AS vendas_etapa_ant, COALESCE(ea.n, 0) - COALESCE(eb.n, 0) AS var_vendas_etapa
FROM per
LEFT JOIN m a ON a.periodo = 'atual'
LEFT JOIN m b ON b.periodo = 'anterior'
LEFT JOIN v va ON va.periodo = 'atual'
LEFT JOIN v vb ON vb.periodo = 'anterior'
LEFT JOIN ve ea ON ea.periodo = 'atual'
LEFT JOIN ve eb ON eb.periodo = 'anterior'
) q) t), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.atend_por_loja(p_inicio date, p_fim date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_contas bigint[] := dash_atend.contas_permitidas(NULL);
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) - '_ord' ORDER BY t._ord) FROM (SELECT q.*, row_number() OVER () AS _ord FROM (
WITH p AS (
  SELECT COALESCE(CAST(p_fim AS DATE), (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) AS fim,
         COALESCE(CAST(p_inicio AS DATE), (now() AT TIME ZONE 'America/Sao_Paulo')::date - 7) AS ini
), per AS (
  SELECT ini, fim, ini - (fim - ini + 1) AS ant_ini, ini - 1 AS ant_fim FROM p
), contas AS (
  SELECT a.id, trim(both chr(10) from a.name) AS loja, a.timezone AS tz, a.sla_target_seconds AS sla_alvo,
         a.sla_business_hours AS bh, a.ghl_pipeline_id
  FROM metrics_dev.ghl_accounts a
  WHERE a.is_active AND a.id = ANY(v_contas)
), base AS (SELECT 1), resp AS (SELECT * FROM dash_atend.resp(p_inicio, p_fim, v_contas)), conv AS (SELECT * FROM dash_atend.conv(p_inicio, p_fim, v_contas)), ve AS (SELECT loja_id, count(*) FILTER (WHERE periodo = 'atual') AS n, count(*) FILTER (WHERE periodo = 'anterior') AS n_ant FROM dash_atend.vendas_etapa(p_inicio, p_fim, v_contas) GROUP BY loja_id),
m AS (
  SELECT loja_id, periodo, count(*) AS atendimentos,
    count(*) FILTER (WHERE respondido) AS respondidos,
    count(*) FILTER (WHERE NOT respondido) AS sem_resposta,
    count(*) FILTER (WHERE respondido AND seg_comercial <= sla_alvo) AS dentro_sla,
    round(100.0 * count(*) FILTER (WHERE respondido) / NULLIF(count(*), 0), 1) AS taxa_resposta,
    round(100.0 * count(*) FILTER (WHERE respondido AND seg_comercial <= sla_alvo) / NULLIF(count(*) FILTER (WHERE respondido), 0), 1) AS taxa_sla,
    round((avg(seg_comercial) FILTER (WHERE respondido) / 60)::numeric, 1) AS tempo_medio_min,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY seg_comercial) FILTER (WHERE respondido) / 60)::numeric, 1) AS tempo_mediano_min FROM resp GROUP BY loja_id, periodo
), v AS (
  SELECT loja_id, periodo, count(*) AS vendas FROM conv GROUP BY loja_id, periodo
)
SELECT c.id AS loja_id, c.loja,
  COALESCE(a.atendimentos, 0) AS atendimentos,
  COALESCE(b.atendimentos, 0) AS atendimentos_ant,
  round(100.0 * (COALESCE(a.atendimentos, 0) - COALESCE(b.atendimentos, 0)) / NULLIF(b.atendimentos, 0), 1) AS var_atendimentos,
  a.taxa_resposta, a.taxa_sla, b.taxa_sla AS taxa_sla_ant, a.taxa_sla - b.taxa_sla AS var_taxa_sla,
  a.tempo_medio_min, b.tempo_medio_min AS tempo_medio_min_ant,
  COALESCE(va.vendas, 0) AS vendas, COALESCE(vb.vendas, 0) AS vendas_ant,
  COALESCE(e.n, 0) AS vendas_etapa, COALESCE(e.n_ant, 0) AS vendas_etapa_ant
FROM contas c
LEFT JOIN m a ON a.loja_id = c.id AND a.periodo = 'atual'
LEFT JOIN m b ON b.loja_id = c.id AND b.periodo = 'anterior'
LEFT JOIN v va ON va.loja_id = c.id AND va.periodo = 'atual'
LEFT JOIN v vb ON vb.loja_id = c.id AND vb.periodo = 'anterior'
LEFT JOIN ve e ON e.loja_id = c.id
ORDER BY COALESCE(a.atendimentos, 0) DESC, c.loja
) q) t), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.atend_vendedores(p_inicio date, p_fim date, p_conta bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_contas bigint[] := dash_atend.contas_permitidas(p_conta);
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) - '_ord' ORDER BY t._ord) FROM (SELECT q.*, row_number() OVER () AS _ord FROM (
WITH p AS (
  SELECT COALESCE(CAST(p_fim AS DATE), (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) AS fim,
         COALESCE(CAST(p_inicio AS DATE), (now() AT TIME ZONE 'America/Sao_Paulo')::date - 7) AS ini
), per AS (
  SELECT ini, fim, ini - (fim - ini + 1) AS ant_ini, ini - 1 AS ant_fim FROM p
), contas AS (
  SELECT a.id, trim(both chr(10) from a.name) AS loja, a.timezone AS tz, a.sla_target_seconds AS sla_alvo,
         a.sla_business_hours AS bh, a.ghl_pipeline_id
  FROM metrics_dev.ghl_accounts a
  WHERE a.is_active AND a.id = ANY(v_contas)
), base AS (SELECT 1), resp AS (SELECT * FROM dash_atend.resp(p_inicio, p_fim, v_contas)), conv AS (SELECT * FROM dash_atend.conv(p_inicio, p_fim, v_contas)), ve AS (SELECT loja_id, COALESCE(vendedor_id, '-') AS vendedor_id, count(*) FILTER (WHERE periodo = 'atual') AS n FROM dash_atend.vendas_etapa(p_inicio, p_fim, v_contas) GROUP BY 1, 2),
m AS (
  SELECT loja_id, COALESCE(vendedor_id, '-') AS vendedor_id, periodo, count(*) AS atendimentos,
    count(*) FILTER (WHERE respondido) AS respondidos,
    count(*) FILTER (WHERE NOT respondido) AS sem_resposta,
    count(*) FILTER (WHERE respondido AND seg_comercial <= sla_alvo) AS dentro_sla,
    round(100.0 * count(*) FILTER (WHERE respondido) / NULLIF(count(*), 0), 1) AS taxa_resposta,
    round(100.0 * count(*) FILTER (WHERE respondido AND seg_comercial <= sla_alvo) / NULLIF(count(*) FILTER (WHERE respondido), 0), 1) AS taxa_sla,
    round((avg(seg_comercial) FILTER (WHERE respondido) / 60)::numeric, 1) AS tempo_medio_min,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY seg_comercial) FILTER (WHERE respondido) / 60)::numeric, 1) AS tempo_mediano_min FROM resp GROUP BY 1, 2, 3
), v AS (
  SELECT loja_id, COALESCE(vendedor_id, '-') AS vendedor_id, periodo, count(*) AS vendas FROM conv GROUP BY 1, 2, 3
), chaves AS (
  SELECT DISTINCT loja_id, vendedor_id FROM m UNION SELECT DISTINCT loja_id, vendedor_id FROM v
)
SELECT k.loja_id || ':' || k.vendedor_id AS chave, c.loja,
  COALESCE(u.name, CASE WHEN k.vendedor_id = '-' THEN 'Sem responsavel' ELSE 'Usuario ' || left(k.vendedor_id, 6) END) AS vendedor,
  COALESCE(a.atendimentos, 0) AS atendimentos, COALESCE(b.atendimentos, 0) AS atendimentos_ant,
  round(100.0 * (COALESCE(a.atendimentos, 0) - COALESCE(b.atendimentos, 0)) / NULLIF(b.atendimentos, 0), 1) AS var_atendimentos,
  COALESCE(a.respondidos, 0) AS respondidos, a.taxa_resposta, a.taxa_sla, a.tempo_medio_min,
  COALESCE(va.vendas, 0) AS vendas, COALESCE(vb.vendas, 0) AS vendas_ant, COALESCE(e.n, 0) AS vendas_etapa
FROM chaves k
JOIN contas c ON c.id = k.loja_id
LEFT JOIN metrics_dev.ghl_users u ON u.ghl_account_id = k.loja_id AND u.ghl_user_id = k.vendedor_id
LEFT JOIN m a ON a.loja_id = k.loja_id AND a.vendedor_id = k.vendedor_id AND a.periodo = 'atual'
LEFT JOIN m b ON b.loja_id = k.loja_id AND b.vendedor_id = k.vendedor_id AND b.periodo = 'anterior'
LEFT JOIN v va ON va.loja_id = k.loja_id AND va.vendedor_id = k.vendedor_id AND va.periodo = 'atual'
LEFT JOIN v vb ON vb.loja_id = k.loja_id AND vb.vendedor_id = k.vendedor_id AND vb.periodo = 'anterior'
LEFT JOIN ve e ON e.loja_id = k.loja_id AND e.vendedor_id = k.vendedor_id
WHERE COALESCE(a.atendimentos, 0) + COALESCE(va.vendas, 0) > 0
ORDER BY COALESCE(a.atendimentos, 0) DESC, vendedor
) q) t), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.atend_etapas(p_inicio date, p_fim date, p_conta bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_contas bigint[] := dash_atend.contas_permitidas(p_conta);
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) - '_ord' ORDER BY t._ord) FROM (SELECT q.*, row_number() OVER () AS _ord FROM (
WITH p AS (
  SELECT COALESCE(CAST(p_fim AS DATE), (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1) AS fim,
         COALESCE(CAST(p_inicio AS DATE), (now() AT TIME ZONE 'America/Sao_Paulo')::date - 7) AS ini
), per AS (
  SELECT ini, fim, ini - (fim - ini + 1) AS ant_ini, ini - 1 AS ant_fim FROM p
), contas AS (
  SELECT a.id, trim(both chr(10) from a.name) AS loja, a.timezone AS tz, a.sla_target_seconds AS sla_alvo,
         a.sla_business_hours AS bh, a.ghl_pipeline_id
  FROM metrics_dev.ghl_accounts a
  WHERE a.is_active AND a.id = ANY(v_contas)
),
nomes AS (SELECT * FROM dash_atend.nomes_etapas(v_contas)), ent AS (
  SELECT COALESCE(n.nome, 'Etapa sem nome') AS etapa, n.posicao,
    CASE WHEN (h.entered_at AT TIME ZONE c.tz)::date BETWEEN per.ini AND per.fim THEN 'atual' ELSE 'anterior' END AS periodo,
    h.ghl_opportunity_id
  FROM metrics_dev.ghl_opportunity_stage_history h
  JOIN contas c ON c.id = h.ghl_account_id AND h.pipeline_id = c.ghl_pipeline_id
  CROSS JOIN per
  LEFT JOIN nomes n ON n.loja_id = c.id AND n.stage_id = h.stage_id
  WHERE h.entry_time_source = 'ghl_last_stage_change'
    AND (h.entered_at AT TIME ZONE c.tz)::date BETWEEN per.ant_ini AND per.fim
)
SELECT dash_atend.norm(etapa) AS etapa, bool_or(dash_atend.etapa_venda(etapa)) AS venda, min(posicao) AS posicao,
  count(DISTINCT ghl_opportunity_id) FILTER (WHERE periodo = 'atual') AS leads,
  count(DISTINCT ghl_opportunity_id) FILTER (WHERE periodo = 'anterior') AS leads_ant
FROM ent GROUP BY 1
ORDER BY leads DESC, etapa
) q) t), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_membros()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'user_id', m.user_id, 'nome', m.nome, 'email', u.email, 'papel', m.papel, 'ativo', m.ativo,
      'lojas', m.lojas,
      'lojas_nomes', (SELECT COALESCE(jsonb_agg(trim(both chr(10) from a.name) ORDER BY a.name), '[]'::jsonb) FROM metrics_dev.ghl_accounts a WHERE a.id = ANY(m.lojas)),
      'ultimo_acesso', COALESCE((SELECT max(a.em) FROM dash_atend.acessos a WHERE a.user_id = m.user_id), u.last_sign_in_at),
      'acessos_30d', (SELECT count(*) FROM dash_atend.acessos a WHERE a.user_id = m.user_id AND a.em > now() - interval '30 days'), 'criado_em', m.criado_em, 'eu', m.user_id = auth.uid())
    ORDER BY (m.papel = 'admin') DESC, m.nome, u.email)
    FROM dash_atend.membros m JOIN auth.users u ON u.id = m.user_id), '[]'::jsonb);
END $$;

-- ========== Permissões ==========
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dash_atend FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA dash_atend FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atend_investimento(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_investimento(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_anuncios(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_anuncios(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_metas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_metas() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_metas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_metas() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_salvar_meta(bigint, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_salvar_meta(bigint, numeric, numeric, numeric, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_etapas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_etapas() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_salvar_etapa(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_salvar_etapa(bigint, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_pedir_sync() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_pedir_sync() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_registrar_acesso() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_registrar_acesso() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_acessos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_acessos() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_destinos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_destinos() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_enviar(text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_enviar(text, bigint, text) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_envios(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_envios(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_kpis(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_kpis(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_por_loja(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_por_loja(date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_vendedores(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_vendedores(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_etapas(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_etapas(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_membros() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_membros() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_service_envios_pegar(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_envios_pegar(int) TO service_role;
REVOKE ALL ON FUNCTION public.atend_service_envio_resultado(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_envio_resultado(uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.atend_service_sync_pegar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_sync_pegar() TO service_role;
REVOKE ALL ON FUNCTION public.atend_service_salvar_etapas(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_salvar_etapas(bigint, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.atend_service_sync_fim(bigint, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_sync_fim(bigint, boolean, jsonb) TO service_role;
