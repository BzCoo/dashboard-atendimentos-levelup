-- Aplicadas no banco (migrations dash_atend_conversao_retornos, dash_atend_saude_dados, dash_atend_cache_resultados):
--  * public.atend_conversao(p_inicio, p_fim, p_conta, p_comparar): conversão em venda, dias até a venda e clientes que voltaram
--  * public.atend_admin_saude(): alertas por loja (carga, responsável, etapas, grupo de CRM, investimento Meta, horário) + histórico de ações
--  * public.atend_admin_salvar_vendedor_padrao(p_loja, p_ghl_user_id): grava metrics_dev.ghl_accounts.default_owner_ghl_user_id
--  * Cache: dash_atend.cache + dash_atend.marca_carga(). As funções pesadas do painel (kpis, serie, etapas, vendedores, por_loja,
--    investimento, anuncios, horarios, conversao) foram movidas para dash_atend._<nome> e as públicas viraram "embrulhos" que
--    devolvem o resultado guardado enquanto não houver carga nova. A chave inclui as lojas permitidas ao login.
--    Renomear etapa limpa o cache (gatilho em dash_atend.etapa_nomes).
CREATE TABLE IF NOT EXISTS dash_atend.cache (chave text PRIMARY KEY, carga timestamptz, valor jsonb NOT NULL, criado_em timestamptz NOT NULL DEFAULT now());
ALTER TABLE dash_atend.cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dash_atend.cache FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION dash_atend.marca_carga() RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT max(last_synced_at) FROM metrics_dev.ghl_accounts WHERE is_active $$;
