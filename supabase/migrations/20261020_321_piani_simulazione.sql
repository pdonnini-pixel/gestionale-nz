-- 321 · Piani del mese di simulazione (Patrizio, 20/10/2026)
--
-- Con la responsabile HR si provano ore di contratto ipotetiche (es. «Ruggeri
-- e Rossini a 40») e straordinari ammessi, senza toccare l'organico. Il piano
-- di simulazione si salva come gli altri, in bozza, con le ipotesi nel
-- riepilogo; non si puo' mai scegliere ne' pubblicare: vale solo per
-- confrontare. Il controllo e' qui, non solo nella pagina.

ALTER TABLE public.shift_plans ADD COLUMN IF NOT EXISTS simulazione boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.shift_plans.simulazione IS
  'Piano di prova con ore di contratto ipotetiche e/o straordinari ammessi (ipotesi in riepilogo->ipotesi). Non si sceglie e non si pubblica.';

CREATE OR REPLACE FUNCTION public.shift_plans_guardia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stato = 'scelto' AND NEW.simulazione THEN
    RAISE EXCEPTION 'Una simulazione serve a confrontare: non si sceglie. Quando le ore sono decise, registra il cambio di contratto e crea il piano vero.';
  END IF;
  IF NEW.stato = 'scelto' AND (TG_OP = 'INSERT' OR OLD.stato IS DISTINCT FROM 'scelto') AND NOT public.organico_e_hr() THEN
    RAISE EXCEPTION 'Il piano che vale lo sceglie la responsabile HR.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- I turni di una simulazione restano bozze: non si pubblicano.
CREATE OR REPLACE FUNCTION public.shifts_simulazione_non_pubblica()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stato = 'pubblicato' AND NEW.plan_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.shift_plans p WHERE p.id = NEW.plan_id AND p.simulazione) THEN
    RAISE EXCEPTION 'I turni di una simulazione non si pubblicano.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_shifts_simulazione_non_pubblica
  BEFORE INSERT OR UPDATE OF stato ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_simulazione_non_pubblica();
