-- =====================================================================
-- 466 — Festa del patrono del negozio (25/11/2026)
--
-- Serve all'export delle presenze per lo studio paghe (Studio Signorini,
-- mail del 18/11/2026): nel festivo si scrive «F» nelle ore ordinarie e le
-- ore lavorate vanno in «Lavoro festivo (LFS)». Oltre ai festivi nazionali
-- c'e' il patrono del comune del negozio: nel modello di novembre 2026 lo
-- studio segna festivo l'11/11 a Valdichiana (San Martino).
--
-- outlets.festa_patrono: giorno e mese, 'MM-DD'. NULL = non indicato.
-- La scrive chi puo' gia' modificare i negozi (policy outlets_update).
--
-- NO DATA LOSS: ADD COLUMN senza default, nessuna riga cambiata.
-- Tenant: NZ e Zago (Made non riceve piu' migration dal 03/11/2026).
-- =====================================================================

BEGIN;

ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS festa_patrono text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outlets_festa_patrono_formato') THEN
    ALTER TABLE public.outlets ADD CONSTRAINT outlets_festa_patrono_formato
      CHECK (festa_patrono IS NULL OR (festa_patrono ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'));
  END IF;
END $$;

COMMENT ON COLUMN public.outlets.festa_patrono IS
  'Festa del patrono del comune del negozio, ''MM-DD'' (es. ''11-11''). Per l''export delle presenze allo studio paghe: quel giorno vale come festivo. NULL = non indicata.';

COMMIT;

-- VERIFICA (su ogni tenant):
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'outlets' AND column_name = 'festa_patrono';  -- 1
