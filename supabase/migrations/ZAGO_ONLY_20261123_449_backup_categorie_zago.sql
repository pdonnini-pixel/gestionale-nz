-- ZAGO_ONLY 449 — backup delle fatture toccate dalle 447 e 448 (23/11/2026)
-- Solo Zago. Chiesto dalla revisione del database: i rollback devono ripristinare solo le
-- fatture davvero cambiate, per id, non per fornitore. Tabella di backup senza GRANT
-- (invisibile all'API). Conteggi al 23/11/2026: 447 = 166 fatture (prima senza categoria),
-- 448 = 230 fatture (217 GGZ CANCELL, 6 SPEDIZ, 5 VIAGGI, 1 LOC_OUTLET, 1 PULIZIA).
-- La GGZ 13607/01 (2.564,99 €) era già ACQ_MERCE prima della 448 e non è nel backup.
CREATE TABLE IF NOT EXISTS public._bkp_20261123_categorie_zago (
  payable_id uuid PRIMARY KEY,
  migration int NOT NULL,
  codice_prima text,
  codice_dopo text NOT NULL
);
ALTER TABLE public._bkp_20261123_categorie_zago ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_20261123_categorie_zago FROM anon, authenticated;

INSERT INTO public._bkp_20261123_categorie_zago (payable_id, migration, codice_prima, codice_dopo)
SELECT p.id, 448, x.vecchia, x.nuova
  FROM public.payables p
  JOIN public.suppliers s ON s.id = p.supplier_id
  JOIN (VALUES ('01767000282','CANCELL','ACQ_MERCE'),('12878470157','SPEDIZ','TELEFON'),
               ('00892860511','SPEDIZ','PUBBLICITA'),('13397910962','VIAGGI','CANCELL'),
               ('01481920468','LOC_OUTLET','CONS_TEC'),('03124500483','PULIZIA','MANUT')) x(piva,vecchia,nuova)
    ON x.piva = coalesce(s.partita_iva, s.vat_number)
 WHERE p.created_at < '2026-11-23 14:00:00+00'
   AND p.id <> '29f0f1ae-94c3-4d26-b97f-2ce57a05f37a'
ON CONFLICT DO NOTHING;

INSERT INTO public._bkp_20261123_categorie_zago (payable_id, migration, codice_prima, codice_dopo)
SELECT p.id, 447, NULL, c.code
  FROM public.payables p
  JOIN public.suppliers s ON s.id = p.supplier_id
  JOIN public.cost_categories c ON c.id = p.cost_category_id
 WHERE s.note LIKE '%23/11/2026: categoria di costo % dal file di riconciliazione Zago%'
   AND p.created_at < '2026-11-23 14:00:00+00'
ON CONFLICT DO NOTHING;
