-- 328 · Accordi con il dipendente per i turni (Patrizio, 28/10/2026)
--
-- Nella scheda dipendente, riquadro «Disponibilita' per i turni»: per ogni
-- giorno della settimana sempre, mai, oppure solo in una fascia oraria.
-- L'orario di contratto non cambia: gli accordi dicono quando, non quanto.
--   giorni      giorni ISO in cui puo' lavorare (gia' c'era, 322)
--   fasce       per giorno ISO, le fasce in cui puo' lavorare:
--               {"4": [{"dalle": "14:00", "alle": "20:00"}]}; giorno assente =
--               tutto l'orario. Il formato accetta piu' fasce per giorno; oggi
--               la pagina ne usa una (il turno non si spezza).
--   valido_dal / valido_al  validita' dell'accordo (vuote = sempre)
-- Li modifica solo la responsabile HR (organico_e_hr), gli altri li vedono.
-- Solo colonne nuove e una policy piu' stretta: nessun dato toccato.

ALTER TABLE public.employee_availability
  ADD COLUMN IF NOT EXISTS fasce jsonb,
  ADD COLUMN IF NOT EXISTS valido_dal date,
  ADD COLUMN IF NOT EXISTS valido_al date;

COMMENT ON COLUMN public.employee_availability.fasce IS
  'Per giorno ISO (1 = lunedi'' ... 7 = domenica) le fasce in cui la persona puo'' lavorare, es. {"4": [{"dalle": "14:00", "alle": "20:00"}]}. Giorno assente: tutto l''orario.';

ALTER POLICY employee_availability_write ON public.employee_availability
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_e_hr()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_e_hr()));
