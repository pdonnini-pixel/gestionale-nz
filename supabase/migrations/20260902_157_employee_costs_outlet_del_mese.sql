-- 157 — L'outlet del dipendente diventa un fatto DEL MESE.
-- (audit AUDIT_PERSONALE_2026-09-02.md, finding F3 + F7)
--
-- Problema: `employee_outlet_allocations` conserva una sola fotografia, quella
-- di oggi (43 righe su NZ, tutte con valid_to NULL). Il numero di dipendenti di
-- un mese passato veniva quindi ricalcolato con l'anagrafica corrente: se una
-- persona cambia punto vendita a luglio, anche giugno risultava cambiato.
--
-- Soluzione: la filiale, che il file paghe già contiene riga per riga, viene
-- salvata sul cedolino. Da quel momento il mese è congelato.
--
-- ADDITIVA: solo ADD COLUMN IF NOT EXISTS + CREATE INDEX + un UPDATE su colonne
-- appena create (tutte NULL). Nessun DROP, nessuna riga toccata nel contenuto.
-- Da applicare IDENTICA sui 3 tenant: NZ -> Made -> Zago.

BEGIN;

-- 1. Outlet di competenza del cedolino (nome outlet, come outlet_code delle
--    allocazioni). NULL = riga vecchia senza filiale nota: chi legge ripiega
--    sull'allocazione anagrafica, come faceva prima.
ALTER TABLE public.employee_costs
  ADD COLUMN IF NOT EXISTS outlet_code text;

-- Da dove arriva il valore, per non confondere un dato letto dal file con uno
-- dedotto dall'anagrafica: 'file' (filiale letta dal PDF/Excel del mese),
-- 'anagrafica' (dedotto dall'allocazione corrente in fase di backfill).
ALTER TABLE public.employee_costs
  ADD COLUMN IF NOT EXISTS outlet_source text;

CREATE INDEX IF NOT EXISTS idx_employee_costs_outlet_period
  ON public.employee_costs (company_id, year, month, outlet_code);

-- 2. Snapshot delle righe rimosse da un ricarico (fase 3): il carico di un mese
--    è una sostituzione, ma ciò che esce resta recuperabile qui. NO DATA LOSS.
ALTER TABLE public.employee_cost_imports
  ADD COLUMN IF NOT EXISTS removed_snapshot jsonb;

ALTER TABLE public.employee_cost_imports
  ADD COLUMN IF NOT EXISTS rows_removed integer DEFAULT 0;

-- 3. Backfill delle righe già caricate. I PDF dei mesi passati non sono
--    archiviati (employee_documents è vuoto), quindi l'unica fonte disponibile
--    è l'allocazione primaria corrente: il passato non migliora, ma da qui in
--    poi smette di riscriversi. outlet_source='anagrafica' lo dichiara.
UPDATE public.employee_costs ec
SET outlet_code = a.outlet_code,
    outlet_source = 'anagrafica'
FROM (
  SELECT DISTINCT ON (employee_id) employee_id, outlet_code
  FROM public.employee_outlet_allocations
  ORDER BY employee_id, is_primary DESC NULLS LAST, created_at NULLS LAST
) a
WHERE a.employee_id = ec.employee_id
  AND ec.outlet_code IS NULL;

COMMIT;

-- VERIFICA (da eseguire su ogni tenant dopo l'applicazione):
--   select year, month, outlet_code, outlet_source, count(*)
--   from employee_costs where netto is not null
--   group by 1,2,3,4 order by 1,2,3;
-- Atteso su NZ: gen/feb/mar 2026, tutte le righe con outlet_source='anagrafica'
-- e il conteggio per outlet identico a quello mostrato oggi dalla pagina.
