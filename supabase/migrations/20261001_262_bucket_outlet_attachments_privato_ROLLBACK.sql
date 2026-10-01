-- ROLLBACK 262: rimette pubblico il bucket su NZ (com'era al 01/10/2026).
-- Su Made e Zago bucket e policy restano: toglierli farebbe perdere eventuali
-- file caricati nel frattempo. Nessun file toccato.
UPDATE storage.buckets SET public = true WHERE id = 'outlet-attachments';
