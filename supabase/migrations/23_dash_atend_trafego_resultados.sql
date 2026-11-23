-- Central do tráfego › Resultados (Dev e Gestor): gasto e resultado por cliente e ranking de anúncios de todas as contas.
-- Gasto por cliente: public.account_daily_reports (nível conta, sempre em dia). Gasto por anúncio: public.ad_daily_reports.
-- Leads: metrics_dev.ghl_lead_ad_attribution (lead do CRM ligado ao anúncio). Avanço/venda: histórico de etapas do GHL.

-- Saldos passa a usar o gasto por conta (account_daily_reports), que não depende da sincronização por anúncio
CREATE OR REPLACE FUNCTION dash_atend.trafego_base()
RETURNS TABLE (id bigint, nome text, cliente_id bigint, cliente text, meta_id text, ativa boolean, saldo numeric, prepaga boolean,
  saldo_em timestamptz, gasto_ontem numeric, gasto_7d numeric, media_dia numeric, ult_dia_dados date, limite numeric, limite_proprio boolean,
  dias_restantes numeric, sync_status text, sync_em timestamptz, sync_erro text)
LANGUAGE sql STABLE SET search_path TO '' AS $$
  WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
  g AS (
    SELECT r.ad_account_id,
      sum(r.spend) FILTER (WHERE r.report_date = h.d - 1) AS ontem,
      sum(r.spend) FILTER (WHERE r.report_date BETWEEN h.d - 7 AND h.d - 1) AS g7,
      max(r.report_date) AS ult
    FROM public.account_daily_reports r CROSS JOIN hoje h
    WHERE r.report_date >= h.d - 45
    GROUP BY r.ad_account_id
  )
  SELECT a.id, regexp_replace(COALESCE(a.name, a.meta_ad_account_id), '^CA\s*-\s*', ''), a.client_id, c.name, a.meta_ad_account_id, a.is_active,
    a.balance, COALESCE(a."Conta_PrePaga", false), a.updated_at,
    COALESCE(g.ontem, 0), COALESCE(g.g7, 0), round(COALESCE(g.g7, 0) / 7.0, 2), g.ult,
    dash_atend.trafego_limite(a.id, a."Conta_PrePaga"), EXISTS (SELECT 1 FROM dash_atend.trafego_limites l WHERE l.ad_account_id = a.id),
    CASE WHEN COALESCE(a."Conta_PrePaga", false) AND COALESCE(g.g7, 0) > 0 THEN round(a.balance / (g.g7 / 7.0), 1) END,
    s.status, s.collected_at, left(s.error_message, 200)
  FROM public.ad_accounts a
  LEFT JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN g ON g.ad_account_id = a.id
  LEFT JOIN LATERAL (SELECT x.status, x.collected_at, x.error_message FROM public.ad_metrics_sync_runs x
    WHERE x.ad_account_id = a.id ORDER BY x.collected_at DESC LIMIT 1) s ON true
$$;
REVOKE ALL ON FUNCTION dash_atend.trafego_base() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.atend_trafego_saldos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN jsonb_build_object(
    'contas', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.ativa DESC, b.dias_restantes NULLS LAST, b.saldo) FROM dash_atend.trafego_base() b), '[]'),
    'ult_dia_dados', (SELECT max(r.report_date) FROM public.account_daily_reports r WHERE r.report_date >= current_date - 60),
    'ult_dia_anuncios', (SELECT max(r.report_date) FROM public.ad_daily_reports r WHERE r.spend > 0 AND r.report_date >= current_date - 60),
    'saldo_em', (SELECT max(a.updated_at) FROM public.ad_accounts a WHERE a.is_active),
    'alertas', COALESCE((SELECT jsonb_agg(jsonb_build_object('em', x.em, 'conta', regexp_replace(COALESCE(a.name, ''), '^CA\s*-\s*', ''), 'cliente', c.name,
        'saldo', x.saldo, 'limite', x.limite, 'dias', x.dias_restantes) ORDER BY x.em DESC)
      FROM (SELECT * FROM dash_atend.trafego_alertas ORDER BY em DESC LIMIT 80) x
      JOIN public.ad_accounts a ON a.id = x.ad_account_id LEFT JOIN public.clients c ON c.id = a.client_id), '[]'));
END $function$;

-- Página: Central do tráfego › Resultados. p_dias = tamanho do período (até ontem), comparado com o período anterior igual.
CREATE OR REPLACE FUNCTION public.atend_trafego_resultados(p_dias integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_dias int := LEAST(GREATEST(COALESCE(p_dias, 7), 1), 90);
  v_fim date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1;
  v_ini date; v_afim date; v_aini date;
  v_contas bigint[] := ARRAY(SELECT id FROM metrics_dev.ghl_accounts WHERE is_active);
BEGIN
  PERFORM dash_atend.exigir_admin();
  v_ini := v_fim - v_dias + 1; v_afim := v_ini - 1; v_aini := v_afim - v_dias + 1;
  RETURN (
    WITH nomes AS (SELECT * FROM dash_atend.nomes_etapas(v_contas)),
    leads AS (
      SELECT l.meta_ad_id, a.client_id, t.ghl_account_id AS loja_id, t.ghl_opportunity_id,
        ((l.ad_message_at AT TIME ZONE a.timezone)::date >= v_ini) AS atual,
        NULLIF(trim(COALESCE(l.ad_name_written, l.ad_title)), '') AS titulo,
        (t.first_human_response_at IS NOT NULL) AS respondido,
        (t.converted_at IS NOT NULL OR lower(COALESCE(t.opportunity_status, '')) = 'won') AS ganho
      FROM metrics_dev.ghl_lead_ad_attribution l
      JOIN metrics_dev.ghl_attendances t ON t.id = l.attendance_id
      JOIN metrics_dev.ghl_accounts a ON a.id = t.ghl_account_id
      WHERE (l.ad_message_at AT TIME ZONE a.timezone)::date BETWEEN v_aini AND v_fim
    ), marcos AS (
      SELECT h.ghl_account_id AS loja_id, h.ghl_opportunity_id,
        bool_or(dash_atend.etapa_avanco(n.nome)) AS avancou, bool_or(dash_atend.etapa_venda(n.nome)) AS vendeu
      FROM metrics_dev.ghl_opportunity_stage_history h
      JOIN nomes n ON n.loja_id = h.ghl_account_id AND n.stage_id = h.stage_id
      WHERE h.ghl_opportunity_id IN (SELECT ghl_opportunity_id FROM leads WHERE ghl_opportunity_id IS NOT NULL)
      GROUP BY 1, 2
    ), base AS (
      SELECT l.*, COALESCE(m.avancou, false) AS avancou, (l.ganho OR COALESCE(m.vendeu, false)) AS vendeu
      FROM leads l LEFT JOIN marcos m ON m.loja_id = l.loja_id AND m.ghl_opportunity_id = l.ghl_opportunity_id
    ),
    -- Por cliente
    gc AS (
      SELECT aa.client_id,
        sum(r.spend) FILTER (WHERE r.report_date >= v_ini) AS gasto, sum(r.spend) FILTER (WHERE r.report_date < v_ini) AS gasto_ant,
        sum(r.conversations) FILTER (WHERE r.report_date >= v_ini) AS conversas, sum(r.conversations) FILTER (WHERE r.report_date < v_ini) AS conversas_ant
      FROM public.account_daily_reports r JOIN public.ad_accounts aa ON aa.id = r.ad_account_id
      WHERE r.report_date BETWEEN v_aini AND v_fim GROUP BY aa.client_id
    ), lc AS (
      SELECT client_id, count(*) FILTER (WHERE atual) AS leads, count(*) FILTER (WHERE NOT atual) AS leads_ant,
        count(*) FILTER (WHERE atual AND respondido) AS respondidos, count(*) FILTER (WHERE atual AND avancou) AS avancaram,
        count(*) FILTER (WHERE atual AND vendeu) AS vendas
      FROM base GROUP BY client_id
    ), cli AS (
      SELECT c.id AS cliente_id, c.name AS cliente,
        round(COALESCE(g.gasto, 0), 2) AS gasto, round(COALESCE(g.gasto_ant, 0), 2) AS gasto_ant,
        COALESCE(g.conversas, 0) AS conversas, COALESCE(g.conversas_ant, 0) AS conversas_ant,
        COALESCE(l.leads, 0) AS leads, COALESCE(l.leads_ant, 0) AS leads_ant, COALESCE(l.respondidos, 0) AS respondidos,
        COALESCE(l.avancaram, 0) AS avancaram, COALESCE(l.vendas, 0) AS vendas,
        EXISTS (SELECT 1 FROM metrics_dev.ghl_accounts x WHERE x.client_id = c.id AND x.is_active) AS tem_crm
      FROM public.clients c LEFT JOIN gc g ON g.client_id = c.id LEFT JOIN lc l ON l.client_id = c.id
      WHERE COALESCE(g.gasto, 0) + COALESCE(g.gasto_ant, 0) > 0 OR COALESCE(l.leads, 0) > 0
    ),
    -- Por anúncio (só o período atual)
    ga AS (
      SELECT ad.meta_ad_id, sum(r.spend) AS gasto, sum(r.conversations) AS conversas
      FROM public.ad_daily_reports r JOIN public.ads ad ON ad.id = r.ad_id
      WHERE r.report_date BETWEEN v_ini AND v_fim GROUP BY ad.meta_ad_id HAVING sum(r.spend) > 0 OR sum(r.conversations) > 0
    ), la AS (
      SELECT meta_ad_id, max(titulo) AS titulo, min(client_id) AS client_id, count(*) AS leads, count(*) FILTER (WHERE respondido) AS respondidos,
        count(*) FILTER (WHERE avancou) AS avancaram, count(*) FILTER (WHERE vendeu) AS vendas
      FROM base WHERE atual AND meta_ad_id IS NOT NULL GROUP BY meta_ad_id
    ), an AS (
      SELECT COALESCE(g.meta_ad_id, l.meta_ad_id) AS meta_ad_id,
        COALESCE(ad.name, l.titulo, 'Anúncio sem nome') AS anuncio, ad.effective_status AS status, ad.ad_format AS formato,
        COALESCE(c.name, cl.name) AS cliente, COALESCE(aa.client_id, l.client_id) AS cliente_id,
        round(COALESCE(g.gasto, 0), 2) AS gasto, COALESCE(g.conversas, 0) AS conversas,
        COALESCE(l.leads, 0) AS leads, COALESCE(l.respondidos, 0) AS respondidos, COALESCE(l.avancaram, 0) AS avancaram, COALESCE(l.vendas, 0) AS vendas
      FROM ga g FULL JOIN la l ON l.meta_ad_id = g.meta_ad_id
      LEFT JOIN public.ads ad ON ad.meta_ad_id = COALESCE(g.meta_ad_id, l.meta_ad_id)
      LEFT JOIN public.ad_accounts aa ON aa.id = ad.ad_account_id
      LEFT JOIN public.clients c ON c.id = aa.client_id
      LEFT JOIN public.clients cl ON cl.id = l.client_id
    )
    SELECT jsonb_build_object(
      'de', v_ini, 'ate', v_fim, 'de_ant', v_aini, 'ate_ant', v_afim, 'dias', v_dias,
      'ult_dia_contas', (SELECT max(report_date) FROM public.account_daily_reports WHERE report_date >= v_aini),
      'ult_dia_anuncios', (SELECT max(r.report_date) FROM public.ad_daily_reports r WHERE r.spend > 0 AND r.report_date >= v_aini),
      'clientes', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.gasto DESC, x.cliente) FROM cli x), '[]'),
      'anuncios', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.gasto DESC, x.leads DESC) FROM (SELECT * FROM an ORDER BY gasto DESC, leads DESC LIMIT 400) x), '[]')
    )
  );
END $function$;
REVOKE ALL ON FUNCTION public.atend_trafego_resultados(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_trafego_resultados(integer) TO authenticated;
