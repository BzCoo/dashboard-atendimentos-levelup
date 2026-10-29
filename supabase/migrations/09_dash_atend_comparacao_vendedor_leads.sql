-- 1) Período de comparação escolhido no painel ('anterior' | 'mes' | 'ano').
--    As funções públicas recebem p_comparar e gravam a escolha em dash_atend.comparar (só na transação).
CREATE OR REPLACE FUNCTION dash_atend.ant_ini(p_ini date, p_fim date)
RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN current_setting('dash_atend.comparar', true) = 'mes' AND (p_fim - interval '1 month')::date < p_ini THEN (p_ini - interval '1 month')::date
    WHEN current_setting('dash_atend.comparar', true) = 'ano' AND (p_fim - interval '1 year')::date < p_ini THEN (p_ini - interval '1 year')::date
    ELSE p_ini - (p_fim - p_ini + 1) END
$$;
CREATE OR REPLACE FUNCTION dash_atend.ant_fim(p_ini date, p_fim date)
RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN current_setting('dash_atend.comparar', true) = 'mes' AND (p_fim - interval '1 month')::date < p_ini THEN (p_fim - interval '1 month')::date
    WHEN current_setting('dash_atend.comparar', true) = 'ano' AND (p_fim - interval '1 year')::date < p_ini THEN (p_fim - interval '1 year')::date
    ELSE p_ini - 1 END
$$;

DO $m$
DECLARE r record; d text; v_old text;
  v_per_old constant text := 'SELECT ini, fim, ini - (fim - ini + 1) AS ant_ini, ini - 1 AS ant_fim FROM p';
  v_per_new constant text := 'SELECT ini, fim, dash_atend.ant_ini(ini, fim) AS ant_ini, dash_atend.ant_fim(ini, fim) AS ant_fim FROM p';
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE (n.nspname = 'dash_atend' AND p.proname IN ('conv', 'resp', 'vendas_etapa'))
              OR (n.nspname = 'public' AND p.proname IN ('atend_etapas', 'atend_kpis', 'atend_por_loja', 'atend_serie', 'atend_vendedores', 'atend_investimento'))
  LOOP
    d := pg_get_functiondef(r.oid); v_old := d;
    d := replace(d, v_per_old, v_per_new);
    d := regexp_replace(d, '(\((?:[^()]|\([^()]*\))*\)::date) BETWEEN per\.ant_ini AND per\.fim',
                           '\1 BETWEEN per.ant_ini AND per.fim AND NOT (\1 > per.ant_fim AND \1 < per.ini)', 'g');
    d := replace(d, 'v_aini := v_ini - (v_fim - v_ini + 1); v_afim := v_ini - 1;', 'v_aini := dash_atend.ant_ini(v_ini, v_fim); v_afim := dash_atend.ant_fim(v_ini, v_fim);');
    IF d <> v_old THEN EXECUTE d; END IF;
  END LOOP;
END $m$;

DO $m$
DECLARE r record; d text; v_sig text;
BEGIN
  FOR r IN SELECT p.oid, p.proname, pg_get_function_arguments(p.oid) args, pg_get_function_identity_arguments(p.oid) ident
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('atend_etapas', 'atend_kpis', 'atend_por_loja', 'atend_serie', 'atend_vendedores', 'atend_investimento')
             AND pg_get_function_arguments(p.oid) NOT LIKE '%p_comparar%'
  LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'public.' || r.proname || '(' || r.args || ')', 'public.' || r.proname || '(' || r.args || ', p_comparar text DEFAULT ''anterior''::text)');
    d := regexp_replace(d, E'\nBEGIN\n', E'\nBEGIN\n  PERFORM set_config(''dash_atend.comparar'', CASE WHEN p_comparar IN (''mes'', ''ano'') THEN p_comparar ELSE ''anterior'' END, true);\n');
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, r.ident);
    EXECUTE d;
    v_sig := format('public.%I(%s, text)', r.proname, r.ident);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_sig);
  END LOOP;
END $m$;

-- 2) Página do vendedor e 3) lista de leads da loja: ver public.atend_vendedor e public.atend_leads no banco
--    (definições completas aplicadas pelas migrations dash_atend_vendedor_detalhe e dash_atend_leads_loja).
