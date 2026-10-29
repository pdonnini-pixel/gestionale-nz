-- Soglia di ingressi MODA per addetto all'ora (Patrizio, 29/10/2026).
-- Il fabbisogno dei turni diventa: ingressi attesi nell'ora / soglia, almeno
-- una persona, al massimo le persone disponibili. Due valori per negozio,
-- feriali e sabato-domenica-festivi. NULL = valore di default nel codice
-- (REGOLE_DEFAULT: 25, provvisorio, misurato su presenze e traffico di
-- settembre-ottobre 2026). Migration additiva: nessun dato toccato.
ALTER TABLE public.outlet_shift_rules
  ADD COLUMN IF NOT EXISTS soglia_ingressi_feriali numeric(6,1) CHECK (soglia_ingressi_feriali IS NULL OR soglia_ingressi_feriali >= 1),
  ADD COLUMN IF NOT EXISTS soglia_ingressi_weekend numeric(6,1) CHECK (soglia_ingressi_weekend IS NULL OR soglia_ingressi_weekend >= 1);

COMMENT ON COLUMN public.outlet_shift_rules.soglia_ingressi_feriali IS 'Ingressi MODA per addetto all''ora nei feriali; NULL = default del codice (25).';
COMMENT ON COLUMN public.outlet_shift_rules.soglia_ingressi_weekend IS 'Ingressi MODA per addetto all''ora sabato, domenica e festivi; NULL = default del codice (25).';
