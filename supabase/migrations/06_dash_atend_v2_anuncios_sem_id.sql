-- Agrupa leads sem ID de anúncio numa linha própria ("Anúncios sem ID informado (vários)")
DO $m$
DECLARE d text := pg_get_functiondef('public.atend_anuncios'::regproc);
BEGIN
  d := replace(d, $a$COALESCE(max(ad.name), max(b.titulo), 'Anúncio sem nome') AS anuncio,$a$,
                  $a$CASE WHEN b.meta_ad_id IS NULL THEN 'Anúncios sem ID informado (vários)' ELSE COALESCE(max(ad.name), max(b.titulo), 'Anúncio sem nome') END AS anuncio,$a$);
  d := replace(d, $a$SELECT p.*, p.meta_ad_id AS chave,$a$, $a$SELECT p.*, COALESCE(p.meta_ad_id, 'sem-id') AS chave,$a$);
  EXECUTE d;
END $m$;
