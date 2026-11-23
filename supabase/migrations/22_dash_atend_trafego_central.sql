-- Central do tráfego (equipe: Dev e Gestor): saldo das contas de anúncio, quanto o saldo ainda dura,
-- limite de alerta por conta e histórico dos avisos de saldo baixo.
-- Fonte: public.ad_accounts (saldo, atualizado 8h30/16h30 pelo n8n), public.ads + public.ad_daily_reports (gasto diário).

-- Limite de alerta por conta. Sem linha aqui: conta pré-paga alerta abaixo de R$ 200; pós-paga não alerta.
CREATE TABLE IF NOT EXISTS dash_atend.trafego_limites (
  ad_account_id bigint PRIMARY KEY REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  limite numeric(12,2),            -- NULL = não alertar
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dash_atend.trafego_limites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS dash_atend.trafego_alertas (
  id bigserial PRIMARY KEY,
  em timestamptz NOT NULL DEFAULT now(),
  rodada text,
  ad_account_id bigint REFERENCES public.ad_accounts(id) ON DELETE CASCADE,
  saldo numeric(12,2),
  limite numeric(12,2),
  dias_restantes numeric(8,1)
);
ALTER TABLE dash_atend.trafego_alertas ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS trafego_alertas_em_idx ON dash_atend.trafego_alertas (em DESC);
CREATE INDEX IF NOT EXISTS ad_metrics_sync_runs_conta_idx ON public.ad_metrics_sync_runs (ad_account_id, collected_at DESC);

-- Royal Motors (cliente 9) já era avisada com até R$ 3.000
INSERT INTO dash_atend.trafego_limites (ad_account_id, limite)
SELECT id, 3000 FROM public.ad_accounts WHERE client_id = 9
ON CONFLICT (ad_account_id) DO NOTHING;

-- Limite efetivo de uma conta
CREATE OR REPLACE FUNCTION dash_atend.trafego_limite(p_conta bigint, p_prepaga boolean)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM dash_atend.trafego_limites l WHERE l.ad_account_id = p_conta)
              THEN (SELECT l.limite FROM dash_atend.trafego_limites l WHERE l.ad_account_id = p_conta)
              WHEN COALESCE(p_prepaga, false) THEN 200::numeric END
$$;

-- Saldo + gasto de cada conta (base da página e do alerta)
CREATE OR REPLACE FUNCTION dash_atend.trafego_base()
RETURNS TABLE (id bigint, nome text, cliente_id bigint, cliente text, meta_id text, ativa boolean, saldo numeric, prepaga boolean,
  saldo_em timestamptz, gasto_ontem numeric, gasto_7d numeric, media_dia numeric, ult_dia_dados date, limite numeric, limite_proprio boolean,
  dias_restantes numeric, sync_status text, sync_em timestamptz, sync_erro text)
LANGUAGE sql STABLE SET search_path TO '' AS $$
  WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
  g AS (
    SELECT ad.ad_account_id,
      sum(r.spend) FILTER (WHERE r.report_date = h.d - 1) AS ontem,
      sum(r.spend) FILTER (WHERE r.report_date BETWEEN h.d - 7 AND h.d - 1) AS g7,
      max(r.report_date) FILTER (WHERE r.spend > 0) AS ult
    FROM public.ad_daily_reports r JOIN public.ads ad ON ad.id = r.ad_id CROSS JOIN hoje h
    WHERE r.report_date >= h.d - 45
    GROUP BY ad.ad_account_id
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

-- Página: Central do tráfego › Saldos
CREATE OR REPLACE FUNCTION public.atend_trafego_saldos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  PERFORM dash_atend.exigir_admin();
  RETURN jsonb_build_object(
    'contas', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.ativa DESC, b.dias_restantes NULLS LAST, b.saldo) FROM dash_atend.trafego_base() b), '[]'),
    'ult_dia_dados', (SELECT max(r.report_date) FROM public.ad_daily_reports r WHERE r.spend > 0 AND r.report_date >= current_date - 60),
    'saldo_em', (SELECT max(a.updated_at) FROM public.ad_accounts a WHERE a.is_active),
    'alertas', COALESCE((SELECT jsonb_agg(jsonb_build_object('em', x.em, 'conta', regexp_replace(COALESCE(a.name, ''), '^CA\s*-\s*', ''), 'cliente', c.name,
        'saldo', x.saldo, 'limite', x.limite, 'dias', x.dias_restantes) ORDER BY x.em DESC)
      FROM (SELECT * FROM dash_atend.trafego_alertas ORDER BY em DESC LIMIT 80) x
      JOIN public.ad_accounts a ON a.id = x.ad_account_id LEFT JOIN public.clients c ON c.id = a.client_id), '[]'));
END $function$;

-- Salvar o limite de alerta de uma conta. p_padrao = true volta para o padrão (pré-paga R$ 200; pós-paga sem aviso).
CREATE OR REPLACE FUNCTION public.atend_trafego_limite_salvar(p_conta bigint, p_limite numeric, p_padrao boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_user uuid := dash_atend.exigir_admin(); v_antes numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ad_accounts WHERE id = p_conta) THEN RAISE EXCEPTION 'Conta de anuncio nao encontrada'; END IF;
  IF p_limite IS NOT NULL AND (p_limite < 0 OR p_limite > 1000000) THEN RAISE EXCEPTION 'Limite invalido'; END IF;
  SELECT limite INTO v_antes FROM dash_atend.trafego_limites WHERE ad_account_id = p_conta;
  IF p_padrao THEN
    DELETE FROM dash_atend.trafego_limites WHERE ad_account_id = p_conta;
  ELSE
    INSERT INTO dash_atend.trafego_limites (ad_account_id, limite, atualizado_por, atualizado_em) VALUES (p_conta, p_limite, v_user, now())
    ON CONFLICT (ad_account_id) DO UPDATE SET limite = EXCLUDED.limite, atualizado_por = v_user, atualizado_em = now();
  END IF;
  INSERT INTO dash_atend.eventos (user_id, acao, detalhe)
  VALUES (v_user, 'trafego_limite', jsonb_build_object('conta', p_conta, 'antes', v_antes, 'depois', CASE WHEN p_padrao THEN 'padrão' ELSE COALESCE(p_limite::text, 'sem aviso') END));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- n8n (Alerta de saldo): recebe as contas atualizadas na rodada e devolve as que estão abaixo do limite, já registradas no histórico.
CREATE OR REPLACE FUNCTION public.atend_service_saldo_alertas(p_rodada text, p_contas bigint[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v jsonb;
BEGIN
  WITH baixo AS (
    SELECT b.* FROM dash_atend.trafego_base() b
    WHERE b.id = ANY (p_contas) AND b.ativa AND b.limite IS NOT NULL AND b.saldo IS NOT NULL AND b.saldo < b.limite
  ), ins AS (
    INSERT INTO dash_atend.trafego_alertas (rodada, ad_account_id, saldo, limite, dias_restantes)
    SELECT p_rodada, id, saldo, limite, dias_restantes FROM baixo RETURNING 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'nome', b.nome, 'cliente', b.cliente, 'meta_id', b.meta_id, 'saldo', b.saldo,
      'limite', b.limite, 'dias', b.dias_restantes, 'media_dia', b.media_dia) ORDER BY b.dias_restantes NULLS LAST, b.saldo), '[]')
  INTO v FROM baixo b WHERE (SELECT count(*) FROM ins) >= 0;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.atend_service_saldo_alertas(text, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atend_service_saldo_alertas(text, bigint[]) TO service_role;
REVOKE ALL ON FUNCTION public.atend_trafego_saldos() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.atend_trafego_limite_salvar(bigint, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atend_trafego_saldos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.atend_trafego_limite_salvar(bigint, numeric, boolean) TO authenticated;
REVOKE ALL ON FUNCTION dash_atend.trafego_base() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dash_atend.trafego_limite(bigint, boolean) FROM PUBLIC, anon, authenticated;
