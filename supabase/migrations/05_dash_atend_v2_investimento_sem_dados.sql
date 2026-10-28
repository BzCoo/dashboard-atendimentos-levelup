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

REVOKE ALL ON FUNCTION public.atend_investimento(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_investimento(date, date, bigint) TO authenticated;
