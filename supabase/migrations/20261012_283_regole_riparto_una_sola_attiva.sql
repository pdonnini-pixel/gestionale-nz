-- Migrazione 283 — una sola regola di riparto ATTIVA per fornitore (12/10/2026)
--
-- Il vincolo del baseline UNIQUE (company_id, supplier_id, is_active) voleva dire
-- «una sola regola attiva», ma vieta anche di avere due regole DISATTIVATE per
-- lo stesso fornitore: al secondo cambio di riparto la disattivazione della
-- regola vecchia va in errore. È successo al riparto notturno l'11 e il
-- 12/10/2026 (Amazon Business: regola già cambiata una volta), che si è fermato
-- senza aggiornare nessun fornitore; lo stesso errore colpirebbe l'editor del
-- riparto in Fornitori al secondo salvataggio.
--
-- Si sostituisce con un indice unico parziale sulle sole regole attive: la
-- regola «una attiva per fornitore» resta garantita dal database, lo storico
-- delle regole disattivate può crescere. Nessuna riga modificata o cancellata.

CREATE UNIQUE INDEX IF NOT EXISTS supplier_allocation_rules_one_active_per_supplier
  ON public.supplier_allocation_rules (company_id, supplier_id)
  WHERE is_active;

ALTER TABLE public.supplier_allocation_rules
  DROP CONSTRAINT IF EXISTS supplier_allocation_rules_company_id_supplier_id_is_active_key;
