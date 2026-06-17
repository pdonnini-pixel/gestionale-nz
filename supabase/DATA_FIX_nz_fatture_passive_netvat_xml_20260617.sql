-- ════════════════════════════════════════════════════════════════════
-- DATA FIX (solo NZ) — backfill net/vat + XML reale fatture passive
-- Eseguito il 2026-06-17. Idempotente (solo UPDATE), backup pre-modifica.
--
-- Le 91 fatture scaricate il 17/06/2026 avevano net_amount/vat_amount NULL e
-- xml_content = JSON A-Cube. Recuperati: net/vat dal payload, vero FatturaPA XML
-- da A-Cube. Made/Zago: nessun dato passive (0 righe), nessun backfill.
--
-- Verifica post-fix (NZ, anno 2026):
--   null net/vat = 0 ; xml_content non-XML = 0
--   MCA 00494/2026/FPR → net 69.68, vat 6.82, gross 76.50
--   KPI: n_total 860, note di credito (TD04) 54, con ID SDI 860, lordo 2.071.932,38
-- ════════════════════════════════════════════════════════════════════

-- 1) Backup righe toccate (no data loss)
CREATE TABLE IF NOT EXISTS public.acube_sdi_invoices_bkp_20260617 AS
  SELECT * FROM public.acube_sdi_invoices
  WHERE direction='passive' AND (xml_content IS NULL OR xml_content NOT LIKE '<%');
CREATE TABLE IF NOT EXISTS public.electronic_invoices_bkp_20260617 AS
  SELECT * FROM public.electronic_invoices
  WHERE net_amount IS NULL OR vat_amount IS NULL OR xml_content IS NULL OR xml_content NOT LIKE '<%';

-- 2) Scarica il vero FatturaPA XML da A-Cube per le righe acube_sdi_invoices
--    con xml mancante/non-XML e aggiorna xml_content. (login una volta, loop)
DO $$
DECLARE
  v_creds record; v_login http_response; v_jwt text;
  r record; v_resp http_response;
BEGIN
  PERFORM set_config('statement_timeout','600000', true);
  PERFORM http_set_curlopt('CURLOPT_TIMEOUT','30');
  SELECT email, password INTO v_creds FROM public.get_acube_credentials('production') LIMIT 1;
  SELECT * INTO v_login FROM http(('POST','https://common.api.acubeapi.com/login',
    ARRAY[http_header('Accept','application/json')],'application/json',
    json_build_object('email',v_creds.email,'password',v_creds.password)::text)::http_request);
  v_jwt := (v_login.content::jsonb)->>'token';
  IF v_jwt IS NULL THEN RAISE EXCEPTION 'login A-Cube fallito'; END IF;

  FOR r IN SELECT acube_uuid FROM public.acube_sdi_invoices
           WHERE direction='passive' AND (xml_content IS NULL OR xml_content NOT LIKE '<%')
  LOOP
    BEGIN
      SELECT * INTO v_resp FROM http((
        'GET', format('https://api.acubeapi.com/invoices/%s', r.acube_uuid),
        ARRAY[http_header('Authorization','Bearer '||v_jwt), http_header('Accept','application/xml')],
        NULL, NULL)::http_request);
      IF v_resp.status = 200 AND left(COALESCE(v_resp.content,''),1) = '<' THEN
        UPDATE public.acube_sdi_invoices SET xml_content = v_resp.content WHERE acube_uuid = r.acube_uuid;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;

-- 3) Aggiorna electronic_invoices: net/vat dal payload + XML reale da acube_sdi_invoices
WITH src AS (
  SELECT ei.id AS ei_id, asi.xml_content AS real_xml, nv.net, nv.vat
  FROM public.electronic_invoices ei
  JOIN public.acube_sdi_invoices asi ON asi.acube_uuid = ei.acube_uuid
  CROSS JOIN LATERAL public._acube_net_vat_from_payload(asi.payload) nv
  WHERE ei.acube_uuid IS NOT NULL
    AND (ei.net_amount IS NULL OR ei.vat_amount IS NULL OR ei.xml_content IS NULL OR ei.xml_content NOT LIKE '<%')
)
UPDATE public.electronic_invoices ei
SET net_amount = COALESCE(ei.net_amount, src.net),
    vat_amount = COALESCE(ei.vat_amount, src.vat),
    xml_content = CASE WHEN src.real_xml LIKE '<%' THEN src.real_xml ELSE ei.xml_content END,
    updated_at = now()
FROM src
WHERE ei.id = src.ei_id;
