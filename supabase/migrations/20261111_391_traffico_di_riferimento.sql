-- 391 · Traffico di riferimento per i negozi senza MODA (Patrizio, 11/11/2026)
--
-- Roma Soratte non ha ancora traffico MODA suo: il piano dei turni usava la
-- «forma media degli altri negozi», ma il codice sommava gli ingressi di tutti
-- i negozi (88,8 ingressi alle 11 di un feriale invece di 10-25), e il
-- fabbisogno veniva 4 persone tutto il giorno. Patrizio: «MODA per Roma
-- Soratte al momento è uguale al MODA di Valmontone».
--
-- Nuova colonna, solo aggiunta: il negozio da cui prendere il traffico MODA
-- quando il negozio non ne ha di suo. Vuota = come prima (media degli altri,
-- ora calcolata davvero come media). Si sceglie in «Regole dei turni».
-- Tenant: NZ e Zago (regola #0 aggiornata al 03/11/2026).

BEGIN;

ALTER TABLE public.outlet_shift_rules
  ADD COLUMN IF NOT EXISTS traffico_da_outlet_id uuid REFERENCES public.outlets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.outlet_shift_rules.traffico_da_outlet_id IS
  'Negozio da cui prendere il traffico MODA se questo non ne ha (negozio nuovo). NULL = media degli altri negozi.';

COMMIT;
