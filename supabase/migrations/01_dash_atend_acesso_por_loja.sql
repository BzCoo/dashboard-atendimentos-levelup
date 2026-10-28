-- Site "Dashboard de Atendimentos - Level Up": acesso por loja
CREATE SCHEMA IF NOT EXISTS dash_atend;
REVOKE ALL ON SCHEMA dash_atend FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS dash_atend.membros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL DEFAULT '',
  papel text NOT NULL CHECK (papel IN ('admin', 'loja')),
  lojas bigint[] NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE dash_atend.membros IS 'Quem pode entrar no site de atendimentos: admin ve todas as lojas e administra acessos; loja ve so as lojas do array lojas (ids de metrics_dev.ghl_accounts).';
ALTER TABLE dash_atend.membros ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS dash_atend.eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  em timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  acao text NOT NULL,
  detalhe jsonb
);
COMMENT ON TABLE dash_atend.eventos IS 'Registro das acoes de administracao do site de atendimentos.';
ALTER TABLE dash_atend.eventos ENABLE ROW LEVEL SECURITY;

-- Primeiro administrador
INSERT INTO dash_atend.membros (user_id, nome, papel)
SELECT id, 'Yago Neves', 'admin' FROM auth.users WHERE lower(email) = 'yagoneves4087@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- Base: atendimentos do periodo atual e anterior, com 1a resposta em horario comercial (regra do relatorio semanal)
CREATE OR REPLACE FUNCTION dash_atend.resp(p_inicio date, p_fim date, v_contas bigint[])
RETURNS TABLE (id bigint, loja_id bigint, loja text, sla_alvo integer, vendedor_id text, cli_local timestamp, resp_local timestamp,
               dia date, periodo text, fim_periodo date, respondido boolean, seg_comercial numeric)
LANGUAGE sql STABLE SET search_path = '' AS $fn$
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
), base AS (
  SELECT t.id, t.ghl_account_id AS loja_id, c.loja, c.sla_alvo, c.bh, t.assigned_ghl_user_id AS vendedor_id,
    t.first_customer_message_at AT TIME ZONE c.tz AS cli_local,
    t.first_human_response_at AT TIME ZONE c.tz AS resp_local,
    (t.first_customer_message_at AT TIME ZONE c.tz)::date AS dia,
    CASE WHEN (t.first_customer_message_at AT TIME ZONE c.tz)::date BETWEEN per.ini AND per.fim THEN 'atual' ELSE 'anterior' END AS periodo,
    CASE WHEN (t.first_customer_message_at AT TIME ZONE c.tz)::date BETWEEN per.ini AND per.fim THEN per.fim ELSE per.ant_fim END AS fim_periodo
  FROM metrics_dev.ghl_attendances t
  JOIN contas c ON c.id = t.ghl_account_id
  CROSS JOIN per
  WHERE t.ghl_opportunity_id IS NOT NULL
    AND (t.first_customer_message_at AT TIME ZONE c.tz)::date BETWEEN per.ant_ini AND per.fim
    AND EXISTS (SELECT 1 FROM metrics_dev.ghl_opportunity_stage_history h
                WHERE h.ghl_account_id = c.id AND h.ghl_opportunity_id = t.ghl_opportunity_id AND h.pipeline_id = c.ghl_pipeline_id)
), resp AS (
  SELECT b.*,
    (b.resp_local IS NOT NULL AND b.resp_local::date <= b.fim_periodo) AS respondido,
    biz.seg AS seg_comercial
  FROM base b
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(greatest(0, extract(epoch FROM
      least(b.resp_local, d::date + CASE WHEN extract(isodow FROM d) < 6
              THEN COALESCE(NULLIF(b.bh->'weekdays'->>'end', '')::time, time '18:00')
              ELSE COALESCE(NULLIF(b.bh->'saturday'->>'end', '')::time, time '13:00') END)
      - greatest(b.cli_local, d::date + CASE WHEN extract(isodow FROM d) < 6
              THEN COALESCE(NULLIF(b.bh->'weekdays'->>'start', '')::time, time '09:00')
              ELSE COALESCE(NULLIF(b.bh->'saturday'->>'start', '')::time, time '09:00') END)))), 0) AS seg
    FROM generate_series(date_trunc('day', b.cli_local), date_trunc('day', b.resp_local), interval '1 day') d
    WHERE b.resp_local IS NOT NULL AND b.resp_local::date <= b.fim_periodo
      AND (extract(isodow FROM d) BETWEEN 1 AND 5
           OR (extract(isodow FROM d) = 6 AND COALESCE((b.bh->'saturday'->>'enabled')::boolean, false)))
      AND NOT EXISTS (SELECT 1 FROM metrics_dev.sla_holidays hd WHERE hd.holiday_date = d::date)
  ) biz ON true
)
SELECT id, loja_id, loja, sla_alvo, vendedor_id, cli_local, resp_local, dia, periodo, fim_periodo, respondido, seg_comercial::numeric FROM resp
$fn$;

-- Vendas (ganhas/convertidas) do periodo atual e anterior
CREATE OR REPLACE FUNCTION dash_atend.conv(p_inicio date, p_fim date, v_contas bigint[])
RETURNS TABLE (loja_id bigint, vendedor_id text, periodo text)
LANGUAGE sql STABLE SET search_path = '' AS $fn$
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
), conv AS (
  SELECT t.ghl_account_id AS loja_id, t.assigned_ghl_user_id AS vendedor_id,
    CASE WHEN (COALESCE(t.converted_at, t.opportunity_status_changed_at) AT TIME ZONE c.tz)::date BETWEEN per.ini AND per.fim
         THEN 'atual' ELSE 'anterior' END AS periodo
  FROM metrics_dev.ghl_attendances t
  JOIN contas c ON c.id = t.ghl_account_id
  CROSS JOIN per
  WHERE (t.converted_at IS NOT NULL OR lower(COALESCE(t.opportunity_status, '')) = 'won')
    AND (COALESCE(t.converted_at, t.opportunity_status_changed_at) AT TIME ZONE c.tz)::date BETWEEN per.ant_ini AND per.fim
)
SELECT loja_id, vendedor_id, periodo FROM conv
$fn$;

-- Membro ativo logado (ou nada)
CREATE OR REPLACE FUNCTION dash_atend.membro_atual()
RETURNS dash_atend.membros LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.* FROM dash_atend.membros m WHERE m.user_id = auth.uid() AND m.ativo LIMIT 1
$$;

-- Lojas que o usuario logado pode ver; com p_conta, so ela (se permitida)
CREATE OR REPLACE FUNCTION dash_atend.contas_permitidas(p_conta bigint DEFAULT NULL)
RETURNS bigint[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m dash_atend.membros; v bigint[];
BEGIN
  m := dash_atend.membro_atual();
  IF m.id IS NULL THEN RAISE EXCEPTION 'Acesso nao autorizado' USING ERRCODE = '42501'; END IF;
  IF m.papel = 'admin' THEN
    v := ARRAY(SELECT a.id FROM metrics_dev.ghl_accounts a WHERE a.is_active);
  ELSE
    v := ARRAY(SELECT a.id FROM metrics_dev.ghl_accounts a WHERE a.is_active AND a.id = ANY(m.lojas));
  END IF;
  IF p_conta IS NOT NULL THEN
    IF NOT (p_conta = ANY(v)) THEN RAISE EXCEPTION 'Loja nao permitida para este usuario' USING ERRCODE = '42501'; END IF;
    v := ARRAY[p_conta];
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION dash_atend.exigir_admin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m dash_atend.membros;
BEGIN
  m := dash_atend.membro_atual();
  IF m.id IS NULL OR m.papel <> 'admin' THEN RAISE EXCEPTION 'Somente administradores' USING ERRCODE = '42501'; END IF;
  RETURN m.user_id;
END $$;

-- Quem sou eu
CREATE OR REPLACE FUNCTION public.atend_me()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m dash_atend.membros;
BEGIN
  m := dash_atend.membro_atual();
  IF m.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', m.id, 'nome', m.nome, 'papel', m.papel,
    'email', (SELECT u.email FROM auth.users u WHERE u.id = m.user_id),
    'lojas', COALESCE((SELECT jsonb_agg(jsonb_build_object('loja_id', a.id, 'loja', trim(both chr(10) from a.name)) ORDER BY a.name)
                       FROM metrics_dev.ghl_accounts a WHERE a.id = ANY(dash_atend.contas_permitidas(NULL))), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.atend_lojas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_contas bigint[] := dash_atend.contas_permitidas(NULL);
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) - '_ord' ORDER BY t._ord) FROM (SELECT q.*, row_number() OVER () AS _ord FROM (
WITH contas AS (
  SELECT a.id, trim(both chr(10) from a.name) AS loja, a.timezone AS tz, a.sla_target_seconds AS sla_alvo,
         a.sla_business_hours AS bh, a.ghl_pipeline_id
  FROM metrics_dev.ghl_accounts a
  WHERE a.is_active AND a.id = ANY(v_contas)
)
SELECT c.id AS loja_id, c.loja,
  (SELECT max(x.last_sync_completed_at) FROM metrics_dev.ghl_accounts x WHERE x.is_active) AS ultima_carga
FROM contas c ORDER BY c.loja
) q) t), '[]'::jsonb);
END $$;

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
), base AS (SELECT 1), resp AS (SELECT * FROM dash_atend.resp(p_inicio, p_fim, v_contas)), conv AS (SELECT * FROM dash_atend.conv(p_inicio, p_fim, v_contas)),
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
  COALESCE(va.vendas, 0) - COALESCE(vb.vendas, 0) AS var_vendas
FROM per
LEFT JOIN m a ON a.periodo = 'atual'
LEFT JOIN m b ON b.periodo = 'anterior'
LEFT JOIN v va ON va.periodo = 'atual'
LEFT JOIN v vb ON vb.periodo = 'anterior'
) q) t), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.atend_serie(p_inicio date, p_fim date, p_conta bigint DEFAULT NULL)
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
), base AS (SELECT 1), resp AS (SELECT * FROM dash_atend.resp(p_inicio, p_fim, v_contas)),
dias AS (
  SELECT 'atual' AS periodo, d::date AS dia, (d::date - per.ini) AS idx FROM per, generate_series(per.ini, per.fim, interval '1 day') d
  UNION ALL
  SELECT 'anterior', d::date, (d::date - per.ant_ini) FROM per, generate_series(per.ant_ini, per.ant_fim, interval '1 day') d
), m AS (
  SELECT periodo, dia, count(*) AS atendimentos,
    count(*) FILTER (WHERE respondido) AS respondidos,
    count(*) FILTER (WHERE NOT respondido) AS sem_resposta,
    count(*) FILTER (WHERE respondido AND seg_comercial <= sla_alvo) AS dentro_sla,
    round(100.0 * count(*) FILTER (WHERE respondido) / NULLIF(count(*), 0), 1) AS taxa_resposta,
    round(100.0 * count(*) FILTER (WHERE respondido AND seg_comercial <= sla_alvo) / NULLIF(count(*) FILTER (WHERE respondido), 0), 1) AS taxa_sla,
    round((avg(seg_comercial) FILTER (WHERE respondido) / 60)::numeric, 1) AS tempo_medio_min,
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY seg_comercial) FILTER (WHERE respondido) / 60)::numeric, 1) AS tempo_mediano_min FROM resp GROUP BY periodo, dia
)
SELECT ds.periodo, ds.dia, ds.idx,
  COALESCE(m.atendimentos, 0) AS atendimentos, COALESCE(m.respondidos, 0) AS respondidos,
  COALESCE(m.dentro_sla, 0) AS dentro_sla, m.taxa_sla, m.tempo_medio_min
FROM dias ds LEFT JOIN m ON m.periodo = ds.periodo AND m.dia = ds.dia
ORDER BY ds.periodo DESC, ds.dia
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
), base AS (SELECT 1), resp AS (SELECT * FROM dash_atend.resp(p_inicio, p_fim, v_contas)), conv AS (SELECT * FROM dash_atend.conv(p_inicio, p_fim, v_contas)),
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
  COALESCE(va.vendas, 0) AS vendas, COALESCE(vb.vendas, 0) AS vendas_ant
FROM contas c
LEFT JOIN m a ON a.loja_id = c.id AND a.periodo = 'atual'
LEFT JOIN m b ON b.loja_id = c.id AND b.periodo = 'anterior'
LEFT JOIN v va ON va.loja_id = c.id AND va.periodo = 'atual'
LEFT JOIN v vb ON vb.loja_id = c.id AND vb.periodo = 'anterior'
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
), base AS (SELECT 1), resp AS (SELECT * FROM dash_atend.resp(p_inicio, p_fim, v_contas)), conv AS (SELECT * FROM dash_atend.conv(p_inicio, p_fim, v_contas)),
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
  COALESCE(va.vendas, 0) AS vendas, COALESCE(vb.vendas, 0) AS vendas_ant
FROM chaves k
JOIN contas c ON c.id = k.loja_id
LEFT JOIN metrics_dev.ghl_users u ON u.ghl_account_id = k.loja_id AND u.ghl_user_id = k.vendedor_id
LEFT JOIN m a ON a.loja_id = k.loja_id AND a.vendedor_id = k.vendedor_id AND a.periodo = 'atual'
LEFT JOIN m b ON b.loja_id = k.loja_id AND b.vendedor_id = k.vendedor_id AND b.periodo = 'anterior'
LEFT JOIN v va ON va.loja_id = k.loja_id AND va.vendedor_id = k.vendedor_id AND va.periodo = 'atual'
LEFT JOIN v vb ON vb.loja_id = k.loja_id AND vb.vendedor_id = k.vendedor_id AND vb.periodo = 'anterior'
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
nomes AS (
  SELECT DISTINCT ON (x.id, s.stage_id) x.id AS loja_id, s.stage_id, s.nome
  FROM metrics_dev.ghl_accounts x
  JOIN contas c ON c.id = x.id
  CROSS JOIN LATERAL (
    SELECT e.value AS stage_id, e.key AS nome, 0 AS pri FROM jsonb_each_text(COALESCE(x.weekly_report_stage_mapping, jsonb_build_object())) e
    UNION ALL
    SELECT e.value, e.key, 1 FROM jsonb_each_text(COALESCE(x.pipeline_stage_mapping, jsonb_build_object())) e
  ) s
  ORDER BY x.id, s.stage_id, s.pri, s.nome
), ent AS (
  SELECT COALESCE(n.nome, 'Etapa sem nome') AS etapa,
    CASE WHEN (h.entered_at AT TIME ZONE c.tz)::date BETWEEN per.ini AND per.fim THEN 'atual' ELSE 'anterior' END AS periodo,
    h.ghl_opportunity_id
  FROM metrics_dev.ghl_opportunity_stage_history h
  JOIN contas c ON c.id = h.ghl_account_id AND h.pipeline_id = c.ghl_pipeline_id
  CROSS JOIN per
  LEFT JOIN nomes n ON n.loja_id = c.id AND n.stage_id = h.stage_id
  WHERE h.entry_time_source = 'ghl_last_stage_change'
    AND (h.entered_at AT TIME ZONE c.tz)::date BETWEEN per.ant_ini AND per.fim
)
SELECT trim(upper(translate(etapa, 'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç_', 'AAAAEEIOOOUCaaaaeeiooouc '))) AS etapa,
  count(DISTINCT ghl_opportunity_id) FILTER (WHERE periodo = 'atual') AS leads,
  count(DISTINCT ghl_opportunity_id) FILTER (WHERE periodo = 'anterior') AS leads_ant
FROM ent GROUP BY 1
ORDER BY leads DESC, etapa
) q) t), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.atend_horarios(p_inicio date, p_fim date, p_conta bigint DEFAULT NULL)
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
), base AS (SELECT 1), resp AS (SELECT * FROM dash_atend.resp(p_inicio, p_fim, v_contas))
SELECT extract(isodow FROM cli_local)::int AS dia_semana, extract(hour FROM cli_local)::int AS hora,
  count(*) AS atendimentos,
  count(*) FILTER (WHERE respondido AND seg_comercial <= sla_alvo) AS dentro_sla,
  count(*) FILTER (WHERE respondido) AS respondidos
FROM resp WHERE periodo = 'atual'
GROUP BY 1, 2 ORDER BY 1, 2
) q) t), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.atend_automacao()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) - '_ord' ORDER BY t._ord) FROM (SELECT q.*, row_number() OVER () AS _ord FROM (
SELECT a.id AS loja_id, trim(both chr(10) from a.name) AS loja,
  a.last_sync_status AS sync_status, a.last_sync_completed_at AS ultima_carga,
  a.weekly_report_enabled AS relatorio_ativo, a.weekly_report_weekday AS dia_envio, a.weekly_report_hour AS hora_envio,
  a.weekly_report_last_status AS relatorio_status, a.weekly_report_last_run_at AS ultimo_relatorio,
  left(COALESCE(a.weekly_report_last_error, a.last_sync_error, ''), 160) AS erro
FROM metrics_dev.ghl_accounts a
WHERE a.is_active
ORDER BY (COALESCE(a.last_sync_status, '') <> 'success' OR COALESCE(a.weekly_report_last_status, '') NOT IN ('success', '')) DESC, loja
) q) t), '[]'::jsonb);
END $$;

-- Administracao de acessos
CREATE OR REPLACE FUNCTION public.atend_admin_membros()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'user_id', m.user_id, 'nome', m.nome, 'email', u.email, 'papel', m.papel, 'ativo', m.ativo,
      'lojas', m.lojas,
      'lojas_nomes', (SELECT COALESCE(jsonb_agg(trim(both chr(10) from a.name) ORDER BY a.name), '[]'::jsonb) FROM metrics_dev.ghl_accounts a WHERE a.id = ANY(m.lojas)),
      'ultimo_acesso', u.last_sign_in_at, 'criado_em', m.criado_em, 'eu', m.user_id = auth.uid())
    ORDER BY (m.papel = 'admin') DESC, m.nome, u.email)
    FROM dash_atend.membros m JOIN auth.users u ON u.id = m.user_id), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_salvar_membro(p_id uuid, p_nome text, p_papel text, p_lojas bigint[], p_ativo boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin uuid := dash_atend.exigir_admin(); m dash_atend.membros;
BEGIN
  IF p_papel NOT IN ('admin', 'loja') THEN RAISE EXCEPTION 'Perfil invalido'; END IF;
  SELECT * INTO m FROM dash_atend.membros WHERE id = p_id;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Acesso nao encontrado'; END IF;
  IF m.user_id = v_admin AND (p_papel <> 'admin' OR NOT p_ativo) THEN
    RAISE EXCEPTION 'Voce nao pode remover o seu proprio perfil de administrador';
  END IF;
  IF p_papel = 'loja' AND COALESCE(array_length(p_lojas, 1), 0) = 0 THEN RAISE EXCEPTION 'Escolha ao menos uma loja'; END IF;
  UPDATE dash_atend.membros SET nome = COALESCE(NULLIF(trim(p_nome), ''), nome), papel = p_papel,
    lojas = CASE WHEN p_papel = 'admin' THEN '{}' ELSE ARRAY(SELECT DISTINCT x FROM unnest(p_lojas) x WHERE x IN (SELECT a.id FROM metrics_dev.ghl_accounts a)) END,
    ativo = p_ativo, atualizado_em = now()
  WHERE id = p_id;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (v_admin, 'salvar_membro', jsonb_build_object('membro', p_id, 'papel', p_papel, 'lojas', p_lojas, 'ativo', p_ativo));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.atend_admin_remover_membro(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin uuid := dash_atend.exigir_admin(); m dash_atend.membros;
BEGIN
  SELECT * INTO m FROM dash_atend.membros WHERE id = p_id;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Acesso nao encontrado'; END IF;
  IF m.user_id = v_admin THEN RAISE EXCEPTION 'Voce nao pode remover o seu proprio acesso'; END IF;
  DELETE FROM dash_atend.membros WHERE id = p_id;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (v_admin, 'remover_membro', jsonb_build_object('membro', p_id, 'user_id', m.user_id));
  RETURN jsonb_build_object('ok', true);
END $$;

-- Usadas so pela Edge Function (service_role)
CREATE OR REPLACE FUNCTION public.atend_service_user_id(p_email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id FROM auth.users u WHERE lower(u.email) = lower(trim(p_email)) LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.atend_service_vincular(p_user_id uuid, p_nome text, p_papel text, p_lojas bigint[], p_admin uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_papel NOT IN ('admin', 'loja') THEN RAISE EXCEPTION 'Perfil invalido'; END IF;
  INSERT INTO dash_atend.membros (user_id, nome, papel, lojas, criado_por)
  VALUES (p_user_id, COALESCE(trim(p_nome), ''), p_papel,
          CASE WHEN p_papel = 'admin' THEN '{}' ELSE ARRAY(SELECT DISTINCT x FROM unnest(p_lojas) x WHERE x IN (SELECT a.id FROM metrics_dev.ghl_accounts a)) END,
          p_admin)
  ON CONFLICT (user_id) DO UPDATE SET nome = EXCLUDED.nome, papel = EXCLUDED.papel, lojas = EXCLUDED.lojas, ativo = true, atualizado_em = now()
  RETURNING id INTO v_id;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (p_admin, 'criar_membro', jsonb_build_object('membro', v_id, 'papel', p_papel, 'lojas', p_lojas));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.atend_service_membro_user(p_membro uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.user_id FROM dash_atend.membros m WHERE m.id = p_membro
$$;

CREATE OR REPLACE FUNCTION public.atend_service_registrar(p_admin uuid, p_acao text, p_detalhe jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe) VALUES (p_admin, p_acao, p_detalhe)
$$;

-- Permissoes
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dash_atend FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA dash_atend FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.atend_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_me() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_lojas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_lojas() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_kpis(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_kpis(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_serie(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_serie(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_por_loja(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_por_loja(date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_vendedores(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_vendedores(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_etapas(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_etapas(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_horarios(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_horarios(date, date, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_automacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_automacao() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_membros() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_membros() TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_salvar_membro(uuid, text, text, bigint[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_salvar_membro(uuid, text, text, bigint[], boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_admin_remover_membro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_admin_remover_membro(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.atend_service_user_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_user_id(text) TO service_role;
REVOKE ALL ON FUNCTION public.atend_service_vincular(uuid, text, text, bigint[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_vincular(uuid, text, text, bigint[], uuid) TO service_role;
REVOKE ALL ON FUNCTION public.atend_service_membro_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_membro_user(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.atend_service_registrar(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_registrar(uuid, text, jsonb) TO service_role;