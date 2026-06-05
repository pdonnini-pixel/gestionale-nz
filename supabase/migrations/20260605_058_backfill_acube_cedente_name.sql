-- 20260605_058_backfill_acube_cedente_name.sql
-- Backfill nomi "ditta individuale / persona fisica" gia' importati con
-- ragione_sociale = P.IVA (prima del fix trigger della migration 057).
-- Ricava il nome vero dall'XML FatturaPA (electronic_invoices.xml_content)
-- e lo propaga su 4 tabelle: suppliers, electronic_invoices, payables,
-- acube_sdi_invoices. Solo dove il nome estratto e' diverso dalla P.IVA.
--
-- Idempotente: dopo l'esecuzione nessun supplier ha piu' ragione_sociale
-- numerica, quindi una seconda esecuzione e' un no-op. No-op anche dove non
-- ci sono casi (Made/Zago: 0 fornitori numerici). Non distruttivo (solo
-- aggiornamento di etichette nome; importi/KPI invariati).
-- Atteso su NZ: 11 fornitori (persone fisiche) risolti.

CREATE TEMP TABLE _acube_name_fix AS
SELECT s.id AS supplier_id, s.partita_iva,
       public._acube_extract_cedente_name(
         (SELECT e.xml_content FROM public.electronic_invoices e
            WHERE e.supplier_vat = s.partita_iva AND e.xml_content IS NOT NULL
            LIMIT 1),
         s.partita_iva) AS nome_reale
FROM public.suppliers s
WHERE (s.is_deleted IS NULL OR s.is_deleted = false)
  AND s.ragione_sociale ~ '^[0-9]+$';

-- Tiene solo i casi effettivamente risolti (nome estratto <> P.IVA).
DELETE FROM _acube_name_fix
WHERE nome_reale IS NULL
   OR btrim(nome_reale) = ''
   OR nome_reale = partita_iva;

UPDATE public.suppliers s
   SET ragione_sociale = f.nome_reale,
       name            = f.nome_reale
  FROM _acube_name_fix f
 WHERE s.id = f.supplier_id;

UPDATE public.electronic_invoices e
   SET supplier_name = f.nome_reale
  FROM _acube_name_fix f
 WHERE e.supplier_vat = f.partita_iva;

UPDATE public.payables p
   SET supplier_name = f.nome_reale
  FROM _acube_name_fix f
 WHERE p.supplier_id = f.supplier_id
    OR p.supplier_vat = f.partita_iva;

UPDATE public.acube_sdi_invoices a
   SET sender_name = f.nome_reale
  FROM _acube_name_fix f
 WHERE a.sender_vat = f.partita_iva;

DROP TABLE _acube_name_fix;
