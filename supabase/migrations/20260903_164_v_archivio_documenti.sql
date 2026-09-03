-- 164 — Vista unica dell'archivio documenti. Applicata sui 3 tenant il 03/09/2026.
-- I documenti stavano sparsi in sei tabelle, ognuna coi suoi nomi di colonna, e
-- la pagina Archivio ne mostrava tre. Chi cercava un file doveva sapere da quale
-- porta era entrato. Qui diventano un elenco solo, diviso in sezioni.
--
-- Nota: le fatture elettroniche NON hanno un file su Storage, l'XML vive nella
-- colonna xml_content. Per quelle bucket e percorso restano nulli e
-- l'interfaccia le apre col visualizzatore fattura.
--
-- Verifica su NZ: conteggi identici alle tabelle di origine
-- (Fatture 1868, Estratti conto 25, Bilanci 1, Paghe 2, Contratti 0).
CREATE OR REPLACE VIEW public.v_archivio_documenti AS
SELECT 'inv:' || i.id::text AS id, i.company_id, 'Fatture'::text AS sezione,
       COALESCE(NULLIF(btrim(i.supplier_name), ''), 'Fornitore non indicato') || ' · ' || COALESCE(i.invoice_number, 's.n.') AS titolo,
       COALESCE(i.invoice_number, i.id::text) || '.xml' AS file_name,
       NULL::text AS storage_bucket, NULL::text AS storage_path,
       (i.xml_content IS NOT NULL) AS ha_file,
       EXTRACT(YEAR FROM i.invoice_date)::int AS anno, EXTRACT(MONTH FROM i.invoice_date)::int AS mese,
       'Fattura elettronica'::text AS funzione, 'electronic_invoices'::text AS fonte, i.id AS riferimento_id,
       COALESCE(i.invoice_date::timestamptz, i.created_at) AS data, NULL::bigint AS file_size
FROM public.electronic_invoices i
UNION ALL
SELECT 'doc:' || d.id::text, d.company_id,
       CASE WHEN d.category = 'fattura' THEN 'Fatture' WHEN d.reference_type = 'outlet' THEN 'Contratti e outlet' ELSE 'Altro' END,
       COALESCE(NULLIF(btrim(d.description), ''), d.file_name), d.file_name,
       COALESCE(d.storage_bucket, CASE WHEN d.category = 'fattura' THEN 'invoices' ELSE 'general-documents' END),
       COALESCE(d.file_path, d.storage_path), (COALESCE(d.file_path, d.storage_path) IS NOT NULL),
       COALESCE(d.year, EXTRACT(YEAR FROM COALESCE(d.uploaded_at, d.created_at))::int), d.month,
       COALESCE(NULLIF(d.import_source, ''), 'Documento archiviato'), 'documents', d.id,
       COALESCE(d.uploaded_at, d.created_at), d.file_size
FROM public.documents d
UNION ALL
SELECT 'bank:' || b.id::text, b.company_id, 'Estratti conto', COALESCE(b.file_name, 'Estratto conto'),
       b.file_name, 'bank-statements', b.file_path, (b.file_path IS NOT NULL),
       EXTRACT(YEAR FROM COALESCE(b.period_from, b.uploaded_at, b.created_at))::int,
       EXTRACT(MONTH FROM COALESCE(b.period_from, b.uploaded_at, b.created_at))::int,
       COALESCE(NULLIF(b.import_type, ''), 'Estratto conto'), 'bank_imports', b.id,
       COALESCE(b.uploaded_at, b.created_at), b.file_size
FROM public.bank_imports b
UNION ALL
SELECT 'bil:' || s.id::text, s.company_id, 'Bilanci',
       COALESCE(NULLIF(s.period_label, ''), 'Bilancio ' || COALESCE(s.year::text, '')),
       s.file_name, 'balance-sheets', s.file_path, (s.file_path IS NOT NULL), s.year, NULL::int,
       'Bilancio', 'balance_sheet_imports', s.id, COALESCE(s.uploaded_at, s.created_at), s.file_size
FROM public.balance_sheet_imports s
UNION ALL
SELECT 'emp:' || e.id::text, e.company_id, 'Paghe e personale',
       COALESCE(NULLIF(e.doc_type, ''), 'Documento dipendente'), e.file_name, 'employee-documents', e.file_path,
       (e.file_path IS NOT NULL), e.year, e.month,
       COALESCE(NULLIF(e.doc_type, ''), 'Documento dipendente'), 'employee_documents', e.id,
       COALESCE(e.uploaded_at, e.created_at), e.file_size
FROM public.employee_documents e
UNION ALL
SELECT 'out:' || a.id::text, a.company_id, 'Contratti e outlet',
       COALESCE(NULLIF(a.label, ''), a.file_name, a.attachment_type), a.file_name, 'outlet-attachments', a.file_path,
       (a.file_path IS NOT NULL),
       EXTRACT(YEAR FROM COALESCE(a.uploaded_at, a.created_at))::int,
       EXTRACT(MONTH FROM COALESCE(a.uploaded_at, a.created_at))::int,
       COALESCE(NULLIF(a.attachment_type, ''), 'Allegato outlet'), 'outlet_attachments', a.id,
       COALESCE(a.uploaded_at, a.created_at), a.file_size
FROM public.outlet_attachments a
UNION ALL
SELECT 'imp:' || m.id::text, m.company_id,
       CASE m.modulo WHEN 'Personale' THEN 'Paghe e personale' WHEN 'Banche' THEN 'Estratti conto'
            WHEN 'Fatturazione' THEN 'Fatture' WHEN 'Outlet' THEN 'Contratti e outlet'
            WHEN 'Bilancio' THEN 'Bilanci' WHEN 'Scadenzario' THEN 'Scadenzario' ELSE 'Altro' END,
       COALESCE(NULLIF(m.funzione, ''), NULLIF(m.source, ''), m.file_name), m.file_name,
       COALESCE(m.storage_bucket, 'general-documents'), m.file_path, (m.file_path IS NOT NULL),
       COALESCE(m.year, EXTRACT(YEAR FROM COALESCE(m.uploaded_at, m.created_at))::int), m.month,
       COALESCE(NULLIF(m.funzione, ''), NULLIF(m.source, ''), 'Caricamento'), 'import_documents', m.id,
       COALESCE(m.uploaded_at, m.created_at), m.file_size
FROM public.import_documents m;

ALTER VIEW public.v_archivio_documenti SET (security_invoker = on);
REVOKE ALL ON public.v_archivio_documenti FROM PUBLIC, anon;
GRANT SELECT ON public.v_archivio_documenti TO authenticated, service_role;

COMMENT ON VIEW public.v_archivio_documenti IS
  'Elenco unico dei documenti archiviati, diviso per sezione. Sei fonti diverse normalizzate: sezione, titolo, file, bucket, percorso, periodo, provenienza.';
