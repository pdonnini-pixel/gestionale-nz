-- Migrazione 136 — Disposizioni MULTIPLE per fattura (acconto + residuo)
--
-- Contesto: con i pagamenti ad ACCONTO (parziale) una fattura può avere più
-- disposizioni "in sospeso" contemporanee: una per l'acconto e una (o più) per
-- il residuo. L'indice UNIQUE parziale della migration 066 permetteva UNA sola
-- disposizione per payable e bloccava (23505) la disposizione del residuo.
--
-- Cambio: si rimuove il vincolo di unicità e lo si sostituisce con un indice
-- NON-unique (stesso predicato) per non perdere le prestazioni sulle query che
-- filtrano action_type='disposizione' (dispMap, dedup confirmDistinta).
--
-- L'anti-doppione (evitare due disposizioni identiche / superare il residuo) è
-- ora garantito lato applicazione in confirmDistinta con una guardia sull'IMPORTO
-- (somma disposto + nuovo ≤ residuo della fattura), non più dall'unicità dell'indice.
--
-- NON distruttivo: nessun dato toccato, solo indici. Reversibile (vedi _ROLLBACK).
-- REGOLA #0: applicare su NZ + Made + Zago.

BEGIN;

DROP INDEX IF EXISTS public.payable_actions_disposizione_unique;

CREATE INDEX IF NOT EXISTS payable_actions_disposizione_payable_idx
  ON public.payable_actions (payable_id)
  WHERE action_type = 'disposizione';

COMMIT;
