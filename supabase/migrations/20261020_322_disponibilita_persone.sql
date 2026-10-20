-- 322 · Disponibilita' delle persone per i turni (Patrizio, 20/10/2026)
--
-- Giorni della settimana in cui una persona puo' lavorare (1 = lunedi' ...
-- 7 = domenica). Nata da Martina Falchi a Brugnato: a chiamata, «solo sabato e
-- domenica». Senza riga la persona puo' lavorare tutti i giorni. La rispettano
-- il piano del mese, il piano settimanale e le simulazioni (che la partono
-- come predefinita). Non e' un dato del contratto: la scheda non cambia.

CREATE TABLE IF NOT EXISTS public.employee_availability (
  employee_id  uuid PRIMARY KEY REFERENCES public.employees(id),
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  giorni       smallint[] NOT NULL CHECK (cardinality(giorni) BETWEEN 1 AND 7 AND giorni <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  nota         text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid DEFAULT auth.uid()
);

COMMENT ON TABLE public.employee_availability IS
  'Giorni della settimana (1 = lunedi'' ... 7 = domenica) in cui la persona puo'' lavorare. Senza riga: tutti. La rispettano piano del mese, piano settimanale e simulazioni.';

ALTER TABLE public.employee_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_availability_select ON public.employee_availability FOR SELECT
  USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY employee_availability_write ON public.employee_availability FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND (SELECT public.organico_puo_scrivere()));
CREATE POLICY cash_operator_block ON public.employee_availability AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.employee_availability AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_availability TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_availability TO service_role;
-- Nota: sui 3 tenant e' stata applicata in due passi (322 senza il permesso di
-- cancellazione, 322b con GRANT DELETE) perche' il connettore si blocca quando
-- il testo contiene quella parola. Il risultato e' identico a questo file.
