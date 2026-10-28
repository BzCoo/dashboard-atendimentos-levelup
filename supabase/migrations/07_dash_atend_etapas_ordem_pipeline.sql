-- Movimento no funil: ordena pela posição da etapa no pipeline (posição relativa, média entre as lojas)
DO $m$
DECLARE d text := pg_get_functiondef('public.atend_etapas'::regproc);
BEGIN
  d := replace(d, $a$nomes AS (SELECT * FROM dash_atend.nomes_etapas(v_contas)), ent AS (
  SELECT COALESCE(n.nome, 'Etapa sem nome') AS etapa, n.posicao,$a$,
  $a$nomes AS (SELECT x.*, x.posicao::numeric / NULLIF(max(x.posicao) OVER (PARTITION BY x.loja_id), 0) AS rel FROM dash_atend.nomes_etapas(v_contas) x), ent AS (
  SELECT COALESCE(n.nome, 'Etapa sem nome') AS etapa, n.posicao, n.rel,$a$);
  d := replace(d, $a$min(posicao) AS posicao,$a$, $a$min(posicao) AS posicao, round(avg(rel), 4) AS ordem,$a$);
  d := replace(d, $a$ORDER BY leads DESC, etapa$a$, $a$ORDER BY avg(rel) NULLS LAST, min(posicao) NULLS LAST, leads DESC, etapa$a$);
  EXECUTE d;
END $m$;
