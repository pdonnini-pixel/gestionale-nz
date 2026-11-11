-- =====================================================================
-- Migrazione 399 — Turni: modello in prova (pausa corta pagata, giorni a
--                  massima intensita', motivo dello straordinario)
-- =====================================================================
-- PERCHE': i quattordici punti fissati da Patrizio l'11/11/2026, da provare
-- su Roma Soratte prima di decidere se diventano il modello di tutti gli
-- outlet (ORGANICO_TURNI_NOTES.md, sezione «Modello in prova»).
--
--   1. Pausa corta pagata: fino a 6 ore di turno nessuna pausa; oltre 6 e
--      fino a 8 la pausa corta si timbra ma non si toglie dalle ore; sopra
--      le 8 ore la pausa lunga si timbra e si toglie.
--   2. Giorni a massima intensita': sabato, domenica, festivi e giorni di
--      evento lavorano tutti; una persona sola per mezz'ora all'apertura e
--      per un'ora alla chiusura; straordinari ammessi.
--   3. Lo straordinario ha un motivo: giorno forte, oppure una persona in
--      piu' chiesta dalla direzione per ricarico del magazzino o allestimento.
--
-- COME: due scelte del negozio in outlet_shift_rules (NULL = spente, quindi
-- nessun negozio cambia finche' qualcuno non le accende) e una colonna in
-- shifts. Tabelle esistenti: RLS e GRANT restano quelli che hanno.
--
-- NO DATA LOSS: solo ADD COLUMN senza default. Nessuna riga cambiata.
-- Tenant: NZ e Zago (Made non riceve piu' migration dal 03/11/2026).
-- =====================================================================

BEGIN;

ALTER TABLE public.outlet_shift_rules ADD COLUMN IF NOT EXISTS pausa_corta_pagata boolean;
COMMENT ON COLUMN public.outlet_shift_rules.pausa_corta_pagata IS
  'Pausa corta pagata (Patrizio, 11/11/2026): true = la pausa si decide sulle ore di turno; oltre 6 e fino a 8 ore la pausa corta (pausa_minuti) si timbra ma non si toglie dalle ore, sopra le 8 la pausa lunga si toglie. NULL o false = ogni pausa si toglie.';

ALTER TABLE public.outlet_shift_rules ADD COLUMN IF NOT EXISTS giorni_pieni boolean;
COMMENT ON COLUMN public.outlet_shift_rules.giorni_pieni IS
  'Giorni a massima intensita'' (Patrizio, 11/11/2026): true = sabato, domenica, festivi e giorni di evento lavorano tutti, una persona sola mezz''ora all''apertura e un''ora alla chiusura, straordinari ammessi. NULL o false = il weekend segue il traffico.';

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS straordinario_motivo text;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_straordinario_motivo_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_straordinario_motivo_check
  CHECK (straordinario_motivo IS NULL OR straordinario_motivo IN ('giorno_forte', 'ricarico', 'allestimento'));
COMMENT ON COLUMN public.shifts.straordinario_motivo IS
  'Perche'' il turno ha ore di straordinario: giorno_forte (sabato, domenica, festivo, evento), ricarico o allestimento (persona in piu'' chiesta dalla direzione). NULL = non indicato.';

COMMIT;

-- Verifica (su ogni tenant):
-- SELECT count(*) FILTER (WHERE column_name IN ('pausa_corta_pagata','giorni_pieni')) AS regole,
--        (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='shifts' AND column_name='straordinario_motivo') AS turni
--   FROM information_schema.columns WHERE table_schema='public' AND table_name='outlet_shift_rules';
-- Atteso: regole = 2, turni = 1.
