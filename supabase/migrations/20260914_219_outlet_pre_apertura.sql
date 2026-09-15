-- ─────────────────────────────────────────────────────────────────────────────
-- 20260914_219 — Outlet in pre-apertura: tre date/legami che l'anagrafica non
-- sapeva tenere. Additiva, idempotente, nessun dato toccato.
--
-- Caso reale (NZ, settembre 2026): unità B46 al Roma Outlet Village, apertura
-- prevista il 5/11/2026. La caparra è già uscita, il canone decorre
-- dall'apertura, la fideiussione ha una scadenza propria (6 mesi oltre la fine
-- del contratto) e il concedente è un fornitore a tutti gli effetti. Nella
-- tabella `outlets` mancavano tre cose:
--
--   rent_start_date       data di decorrenza del canone. Senza, il cashflow
--                         proiettava l'affitto dal primo giorno di anagrafica,
--                         anche mesi prima dell'apertura.
--   guarantee_expiry      scadenza della fideiussione/garanzia. Il pannello
--                         «Alert scadenze» della scheda outlet la leggeva già
--                         (colonna inesistente: l'alert non compariva mai).
--   landlord_supplier_id  il concedente collegato all'anagrafica fornitori.
--                         Finora `concedente` era testo libero: fatture,
--                         allocazione costi e contratto non puntavano allo
--                         stesso soggetto.
--
-- Da applicare su NZ → Made → Zago (parità tenant, Regola #0).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS rent_start_date date,
  ADD COLUMN IF NOT EXISTS guarantee_expiry date,
  ADD COLUMN IF NOT EXISTS landlord_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.outlets.rent_start_date IS
  'Data di decorrenza del canone (di norma la data di apertura). Il cashflow proietta l''affitto solo da qui in poi.';
COMMENT ON COLUMN public.outlets.guarantee_expiry IS
  'Scadenza della fideiussione/garanzia bancaria (importo in deposit_guarantee). Alimenta gli alert della scheda outlet.';
COMMENT ON COLUMN public.outlets.landlord_supplier_id IS
  'Fornitore che corrisponde al concedente (agganciato per P.IVA in suppliers). Il campo testuale concedente resta come etichetta.';

CREATE INDEX IF NOT EXISTS idx_outlets_landlord_supplier
  ON public.outlets (landlord_supplier_id)
  WHERE landlord_supplier_id IS NOT NULL;

COMMIT;

-- ── Verifica (stessa su NZ, Made, Zago: attese 3 righe) ─────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'outlets'
--   AND column_name IN ('rent_start_date', 'guarantee_expiry', 'landlord_supplier_id')
-- ORDER BY column_name;
