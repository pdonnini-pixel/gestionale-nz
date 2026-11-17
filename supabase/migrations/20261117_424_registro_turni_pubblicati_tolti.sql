-- 424: registro dei turni pubblicati tolti (Patrizio, 17/11/2026: «solo per i turni che sono stati
-- pubblicati, non le prove»).
--
-- Un turno pubblicato non si cancella (trg_shifts_no_hard_delete): si annulla, oppure si ritira la
-- pubblicazione (torna in bozza) e da li' si puo' cancellare con il piano. Fino a oggi nessuna di
-- queste strade lasciava traccia. Da qui ogni volta che un turno PUBBLICATO viene annullato, torna in
-- bozza o (se mai passasse) viene cancellato, resta una riga con il turno com'era, chi e quando.
-- Le bozze e le simulazioni non si registrano.
--
-- Il registro non si modifica e non si cancella. Lo legge chi vede i turni del negozio (stessi recinti
-- di shifts). Additiva: nessun dato esistente cambia. Solo NZ e Zago.

CREATE TABLE IF NOT EXISTS public.turni_pubblicati_tolti (
  id           bigserial PRIMARY KEY,
  company_id   uuid NOT NULL REFERENCES public.companies(id),
  shift_id     uuid NOT NULL,
  outlet_id    uuid,
  employee_id  uuid,
  data         date NOT NULL,
  inizio       time,
  fine         time,
  azione       text NOT NULL CHECK (azione IN ('annullato', 'ritirato', 'cancellato')),
  motivo       text,
  turno        jsonb NOT NULL,
  utente_id    uuid,
  utente_nome  text,
  creato_il    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS turni_pubblicati_tolti_negozio_idx ON public.turni_pubblicati_tolti (outlet_id, data);
CREATE INDEX IF NOT EXISTS turni_pubblicati_tolti_company_idx ON public.turni_pubblicati_tolti (company_id, creato_il DESC);

COMMENT ON TABLE public.turni_pubblicati_tolti IS
  'Turni pubblicati annullati, tornati in bozza o cancellati: il turno com''era, chi e quando. Non si modifica e non si cancella (migration 424).';

-- Il registro e' fermo
CREATE OR REPLACE FUNCTION public.turni_pubblicati_tolti_fermo() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Il registro dei turni pubblicati tolti non si modifica e non si cancella.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.turni_pubblicati_tolti_fermo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_turni_pubblicati_tolti_fermo ON public.turni_pubblicati_tolti;
CREATE TRIGGER trg_turni_pubblicati_tolti_fermo BEFORE UPDATE OR DELETE ON public.turni_pubblicati_tolti
  FOR EACH ROW EXECUTE FUNCTION public.turni_pubblicati_tolti_fermo();

-- Scrive il registro quando un turno pubblicato smette di esserlo
CREATE OR REPLACE FUNCTION public.shifts_registra_pubblicato_tolto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_azione text;
  v_nome   text;
BEGIN
  IF OLD.stato IS DISTINCT FROM 'pubblicato' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_azione := 'cancellato';
  ELSIF NEW.stato = 'annullato' THEN
    v_azione := 'annullato';
  ELSIF NEW.stato IS DISTINCT FROM 'pubblicato' THEN
    v_azione := 'ritirato';
  ELSE
    RETURN NULL;
  END IF;
  SELECT NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') INTO v_nome
    FROM public.user_profiles u WHERE u.id = (SELECT auth.uid());
  INSERT INTO public.turni_pubblicati_tolti
    (company_id, shift_id, outlet_id, employee_id, data, inizio, fine, azione, motivo, turno, utente_id, utente_nome)
  VALUES (OLD.company_id, OLD.id, OLD.outlet_id, OLD.employee_id, OLD.data, OLD.inizio, OLD.fine, v_azione,
          CASE WHEN TG_OP = 'UPDATE' THEN NEW.annullato_motivo END, to_jsonb(OLD), (SELECT auth.uid()), v_nome);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.shifts_registra_pubblicato_tolto() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shifts_registra_pubblicato_tolto ON public.shifts;
CREATE TRIGGER trg_shifts_registra_pubblicato_tolto AFTER UPDATE OF stato OR DELETE ON public.shifts
  FOR EACH ROW WHEN (OLD.stato = 'pubblicato') EXECUTE FUNCTION public.shifts_registra_pubblicato_tolto();

-- RLS: stessi recinti di shifts
ALTER TABLE public.turni_pubblicati_tolti ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_operator_block ON public.turni_pubblicati_tolti;
CREATE POLICY cash_operator_block ON public.turni_pubblicati_tolti AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'operatore_cassa');
DROP POLICY IF EXISTS dipendente_block ON public.turni_pubblicati_tolti;
CREATE POLICY dipendente_block ON public.turni_pubblicati_tolti AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'dipendente');
DROP POLICY IF EXISTS responsabile_block ON public.turni_pubblicati_tolti;
CREATE POLICY responsabile_block ON public.turni_pubblicati_tolti AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile')
  WITH CHECK (COALESCE((SELECT public.get_my_role())::text, '') <> 'responsabile');
DROP POLICY IF EXISTS solo_con_profilo ON public.turni_pubblicati_tolti;
CREATE POLICY solo_con_profilo ON public.turni_pubblicati_tolti AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.get_my_role()) IS NOT NULL)
  WITH CHECK ((SELECT public.get_my_role()) IS NOT NULL);
-- il dipendente di prova resta nascosto come in shifts (migration 368)
DROP POLICY IF EXISTS demo_nascosto ON public.turni_pubblicati_tolti;
CREATE POLICY demo_nascosto ON public.turni_pubblicati_tolti AS RESTRICTIVE FOR ALL TO authenticated
  USING (employee_id IS NULL OR employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]))
  WITH CHECK (employee_id IS NULL OR employee_id <> ALL ((SELECT public.dipendenti_demo_ids())::uuid[]));
DROP POLICY IF EXISTS turni_pubblicati_tolti_select ON public.turni_pubblicati_tolti;
CREATE POLICY turni_pubblicati_tolti_select ON public.turni_pubblicati_tolti FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()));

-- Si legge soltanto: scrive solo il trigger
REVOKE ALL ON public.turni_pubblicati_tolti FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.turni_pubblicati_tolti TO authenticated;
GRANT SELECT, INSERT ON public.turni_pubblicati_tolti TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.turni_pubblicati_tolti_id_seq TO service_role;
