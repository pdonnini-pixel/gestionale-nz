-- 20260605_059_normalize_denormalized_supplier_names.sql
-- Normalizza le copie denormalizzate del nome fornitore rimaste = P.IVA, anche
-- per fornitori che hanno gia' la ragione_sociale corretta (es. risolti per
-- altra via): le fatture/scadenze copiano supplier_name al momento della
-- creazione e possono restare "vecchie" anche dopo che il supplier e' a posto.
-- Propaga suppliers.ragione_sociale (se NON numerica) a:
--   electronic_invoices.supplier_name, payables.supplier_name,
--   acube_sdi_invoices.sender_name
-- solo dove la copia attuale e' numerica / uguale alla P.IVA / nulla.
-- Idempotente, non distruttivo (solo etichette nome). Complementare al backfill
-- 058. Su NZ recupera il caso "ANNALISA BOSCHETTI" (P.IVA 12262010155).

UPDATE public.electronic_invoices e
   SET supplier_name = s.ragione_sociale
  FROM public.suppliers s
 WHERE (s.partita_iva = e.supplier_vat OR s.vat_number = e.supplier_vat)
   AND s.ragione_sociale !~ '^[0-9]+$'
   AND (e.supplier_name ~ '^[0-9]+$' OR e.supplier_name = e.supplier_vat OR e.supplier_name IS NULL);

UPDATE public.payables p
   SET supplier_name = s.ragione_sociale
  FROM public.suppliers s
 WHERE (s.id = p.supplier_id OR s.partita_iva = p.supplier_vat OR s.vat_number = p.supplier_vat)
   AND s.ragione_sociale !~ '^[0-9]+$'
   AND (p.supplier_name ~ '^[0-9]+$' OR p.supplier_name = p.supplier_vat OR p.supplier_name IS NULL);

UPDATE public.acube_sdi_invoices a
   SET sender_name = s.ragione_sociale
  FROM public.suppliers s
 WHERE a.direction = 'passive'
   AND (s.partita_iva = a.sender_vat OR s.vat_number = a.sender_vat)
   AND s.ragione_sociale !~ '^[0-9]+$'
   AND (a.sender_name ~ '^[0-9]+$' OR a.sender_name = a.sender_vat OR a.sender_name IS NULL);
