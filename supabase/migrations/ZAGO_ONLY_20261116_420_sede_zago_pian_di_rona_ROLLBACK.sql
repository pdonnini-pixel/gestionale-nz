-- ROLLBACK ZAGO_ONLY 420 — solo Zago. Disattiva (non cancella) il punto sede;
-- la sede legale di prima si legge nelle note dell'azienda e si rimette a mano.
UPDATE public.outlets SET is_active = false WHERE code = 'ZAGO-SEDE' AND is_active;
