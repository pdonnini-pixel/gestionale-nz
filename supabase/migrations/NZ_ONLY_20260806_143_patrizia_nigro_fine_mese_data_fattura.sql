-- NZ_ONLY — Fornitore PATRIZIA NIGRO: piano "fine mese DATA FATTURA" (mese stesso)
--
-- Contesto: Patrizio segnala che PATRIZIA NIGRO (P.IVA 02063730978) è un fornitore
-- "fine mese data fattura con RiBa", NON un "30 gg data fattura fine mese".
-- Le sue fatture reali lo confermano (scadenza XML = ultimo giorno del MESE della
-- fattura): 46-2026 05/05→31/05, 62-2026 05/06→30/06, 73-2026 03/07→31/07.
-- La fattura 88-2026 (03/08) è l'UNICA senza <DataScadenzaPagamento> nell'XML: il
-- bridge A-Cube ha usato il piano fornitore (fine_mese + prima_scadenza_gg=30) e ha
-- prodotto 30/09 (= fine mese del mese SUCCESSIVO), sbagliando.
--
-- Modello: con base 'fine_mese' il calcolo (fn_supplier_installment_schedule) è
-- ultimo giorno di (mese_emissione + floor(prima_gg/30) + rata-1). Quindi:
--   prima_gg = 0  -> fine mese DATA FATTURA (mese stesso)  <-- corretto per lei
--   prima_gg = 30 -> fine mese del mese successivo ("30 gg DF fine mese")
--
-- AMBITO: solo NZ (dato specifico dei fornitori di New Zago; Made/Zago hanno
-- P.IVA/fornitori diversi). Coerente con PAYMENT_PLAN_NOTES.md.
-- Non distruttivo: due UPDATE puntuali con guardie sui valori attesi.

begin;

-- 1) Piano fornitore: 30 -> 0 (fine mese data fattura). Base/metodo/banca invariati.
update public.suppliers
   set prima_scadenza_gg = 0, updated_at = now()
 where partita_iva = '02063730978'
   and payment_base = 'fine_mese'
   and prima_scadenza_gg = 30;

-- 2) Fattura 88-2026 (senza scadenza XML): 30/09 -> 31/08, coerente con la
--    electronic_invoice (già 31/08) e con "fine mese data fattura".
--    Guardia: solo se ancora da pagare e con la scadenza errata attesa.
update public.payables
   set due_date = date '2026-08-31',
       original_due_date = date '2026-08-31',
       updated_at = now()
 where supplier_vat = '02063730978'
   and invoice_number = '88-2026'
   and due_date = date '2026-09-30'
   and coalesce(amount_paid, 0) = 0;

commit;

-- Verifica
-- select prima_scadenza_gg, payment_base, default_payment_method
--   from public.suppliers where partita_iva = '02063730978';
-- select invoice_number, due_date from public.payables
--   where supplier_vat = '02063730978' and invoice_number = '88-2026';
