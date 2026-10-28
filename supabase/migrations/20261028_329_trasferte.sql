-- 329 · Trasferte (Patrizio, 28/10/2026)
--
-- Orario di lavoro svolto fuori dal negozio di riferimento: le referenti che
-- vanno in altre sedi. Le ore valgono come lavoro (entrano nelle ore della
-- settimana, con la pausa) ma non come presenza nel negozio di riferimento: il
-- piano dei turni pianifica intorno. Se la destinazione e' uno dei negozi, si
-- decide volta per volta se quelle ore coprono anche quel negozio
-- (copre_destinazione). Le inseriscono la responsabile HR e chi tiene
-- l'organico (poi anche le responsabili di negozio). Per ora niente rimborsi.
-- Tabella a parte (non in shifts) cosi' nessun conteggio esistente le prende
-- per turni in negozio. Tabella nuova: nessun dato toccato.

CREATE TABLE IF NOT EXISTS public.employee_trasferte (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id),
  employee_id         uuid NOT NULL REFERENCES public.employees(id),
  outlet_id           uuid REFERENCES public.outlets(id),
  data                date NOT NULL,
  inizio              time NOT NULL,
  fine                time NOT NULL,
  pausa_minuti        smallint NOT NULL DEFAULT 0 CHECK (pausa_minuti BETWEEN 0 AND 240),
  destinazione_outlet_id uuid REFERENCES public.outlets(id),
  luogo               text,
  copre_destinazione  boolean NOT NULL DEFAULT false,
  motivo              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT auth.uid(),
  created_by_nome     text,
  CHECK (fine > inizio),
  CHECK (destinazione_outlet_id IS NOT NULL OR coalesce(trim(luogo), '') <> ''),
  CHECK (NOT copre_destinazione OR destinazione_outlet_id IS NOT NULL)
);

COMMENT ON TABLE public.employee_trasferte IS
  'Trasferte: ore di lavoro fuori dal negozio di riferimento (outlet_id). Valgono come lavoro, non come presenza nel negozio di riferimento; con copre_destinazione coprono il negozio di destinazione.';

CREATE INDEX IF NOT EXISTS employee_trasferte_company_data_idx ON public.employee_trasferte (company_id, data);
CREATE INDEX IF NOT EXISTS employee_trasferte_employee_data_idx ON public.employee_trasferte (employee_id, data);

ALTER TABLE public.employee_trasferte ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_trasferte_select ON public.employee_trasferte FOR SELECT
  USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY employee_trasferte_write ON public.employee_trasferte FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()) AND ((SELECT public.organico_puo_scrivere()) OR (SELECT public.organico_e_hr())))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) AND ((SELECT public.organico_puo_scrivere()) OR (SELECT public.organico_e_hr())));
CREATE POLICY cash_operator_block ON public.employee_trasferte AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
CREATE POLICY dipendente_block ON public.employee_trasferte AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_trasferte TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_trasferte TO service_role;
-- Nota: sui 3 tenant e' stata applicata in due passi (329 senza il permesso di
-- cancellazione, 329b con GRANT DELETE) perche' il connettore si blocca su quella
-- parola. Il risultato e' identico a questo file.
