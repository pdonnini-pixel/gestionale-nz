-- Due persone in negozio (Patrizio, 30/10/2026): salvo la prima ora di
-- apertura e l'ultima di chiusura, in negozio ci sono sempre almeno due
-- persone (bisogni primari, negozi di 150 mq). Regola del singolo negozio,
-- accesa o spenta in «Regole dei turni». NULL = default del codice (accesa).
-- Se le ore non bastano vince la seconda persona sul traffico MODA del
-- weekend. Migration additiva: nessun dato toccato.
ALTER TABLE public.outlet_shift_rules
  ADD COLUMN IF NOT EXISTS due_persone boolean;

COMMENT ON COLUMN public.outlet_shift_rules.due_persone IS 'Almeno due persone in negozio salvo la prima e l''ultima ora; NULL = default del codice (si).';
