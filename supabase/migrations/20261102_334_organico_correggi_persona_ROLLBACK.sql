-- Rollback 20261102_334: toglie la funzione. Le correzioni gia' fatte restano
-- (sono dati: scheda e assunzione corrette, nota datata in coda).
DROP FUNCTION IF EXISTS public.organico_correggi_persona(uuid, text, text, text, uuid, text, numeric, date, date, text);
