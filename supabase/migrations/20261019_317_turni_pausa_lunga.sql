-- 317 — Turni: seconda soglia di pausa (Patrizio, 19/10/2026)
--
-- Regola aziendale: chi lavora 6 ore ha 30 minuti di pausa, chi lavora
-- 8 ore ha un'ora. Le soglie si contano sulle ore lavorate e valgono
-- «da» (6 ore esatte = 30 minuti, 8 ore esatte = un'ora).
--
-- Solo colonne nuove con default: la tabella oggi e' vuota sui 3 tenant,
-- e una riga gia' salvata prenderebbe comunque i valori aziendali.
-- Niente DROP (il connettore va in timeout), vedi ORGANICO_TURNI_NOTES.md.

ALTER TABLE public.outlet_shift_rules
  ADD COLUMN IF NOT EXISTS pausa_lunga_oltre_ore numeric(4,2) NOT NULL DEFAULT 8
    CHECK (pausa_lunga_oltre_ore BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS pausa_lunga_minuti smallint NOT NULL DEFAULT 60
    CHECK (pausa_lunga_minuti BETWEEN 0 AND 120);

COMMENT ON COLUMN public.outlet_shift_rules.pausa_oltre_ore IS
  'Da quante ore lavorate scatta la pausa (default 6).';
COMMENT ON COLUMN public.outlet_shift_rules.pausa_lunga_oltre_ore IS
  'Da quante ore lavorate la pausa diventa lunga (default 8).';
COMMENT ON COLUMN public.outlet_shift_rules.pausa_lunga_minuti IS
  'Durata della pausa lunga in minuti (default 60).';
COMMENT ON TABLE public.outlet_shift_rules IS
  'Regole per proporre i turni di un negozio. Senza riga valgono i valori di default (4-8 ore, 30 minuti di pausa da 6 ore lavorate, un''ora da 8, al massimo 6 giorni su 7).';
