-- Rollback Migration 085 — Chiusura manuale fatture
-- Applicare su NZ + Made + Zago solo se necessario annullare la 085.
-- ATTENZIONE: rimuove i flag di chiusura manuale dalle fatture gia' chiuse a mano
-- (le fatture restano comunque 'pagato'; si perde solo la marcatura "a mano").

ALTER TABLE payables DROP COLUMN IF EXISTS closed_manually;
ALTER TABLE payables DROP COLUMN IF EXISTS manual_close_reason;
