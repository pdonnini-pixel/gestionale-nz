-- Migration 085 — Chiusura manuale fatture (partitario)
-- Additiva, idempotente. Da applicare su TUTTI E 3 i tenant: NZ + Made + Zago.
--
-- Scopo: permettere la chiusura "a mano" di una fattura fornitore (es. pagata
-- contanti, compensata, stralciata) registrando la corretta chiusura contabile
-- nel partitario con dicitura "Chiusa a mano" + data di chiusura.
--
-- Modello (approvato): riuso di status='pagato' + flag closed_manually=true.
-- Nessun nuovo valore enum payable_status (niente ALTER TYPE), nessun impatto
-- sui filtri esistenti. La data di chiusura riusa payables.payment_date.
-- La registrazione nel registro avviene su payable_actions con
-- action_type='chiusura_manuale' (campo text, nessun enum da estendere).

ALTER TABLE payables
  ADD COLUMN IF NOT EXISTS closed_manually boolean NOT NULL DEFAULT false;

ALTER TABLE payables
  ADD COLUMN IF NOT EXISTS manual_close_reason text;

COMMENT ON COLUMN payables.closed_manually IS
  'Fattura chiusa manualmente da operatore (chiusura contabile senza movimento bancario). Registrata in payable_actions con action_type=chiusura_manuale.';
COMMENT ON COLUMN payables.manual_close_reason IS
  'Motivazione opzionale della chiusura manuale (es. compensazione, stralcio, pagata contanti).';

-- Nota: se la vista v_payables_operative enumera le colonne (anziche' p.*),
-- NON e' necessario aggiornarla per questa feature: il frontend legge
-- closed_manually/manual_close_reason da un select esplicito su payables.
