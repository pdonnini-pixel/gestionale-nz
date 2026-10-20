-- 318 — Turni: anche a 8 ore lavorate la pausa e' di 30 minuti (Patrizio, 20/10/2026)
--
-- «Un dipendente che fa 6 o 8 ore di fatto devi gestire 6 + 30 minuti e
-- 8 + 30 minuti e non -»: la pausa si aggiunge alle ore lavorate (un turno
-- da 8 ore occupa 8 ore e mezza di negozio) ed e' di 30 minuti anche oltre
-- le 8 ore. Cambia solo il default della colonna: la tabella e' vuota sui
-- 3 tenant (verificato il 20/10/2026), nessuna riga da aggiornare.

ALTER TABLE public.outlet_shift_rules ALTER COLUMN pausa_lunga_minuti SET DEFAULT 30;

COMMENT ON COLUMN public.outlet_shift_rules.pausa_lunga_minuti IS
  'Durata della pausa da 8 ore lavorate in minuti (default 30, come da 6 ore).';
COMMENT ON TABLE public.outlet_shift_rules IS
  'Regole per proporre i turni di un negozio. Senza riga valgono i valori di default (turni fino a 8 ore, 30 minuti di pausa da 6 ore lavorate in aggiunta alle ore, al massimo 6 giorni su 7).';
