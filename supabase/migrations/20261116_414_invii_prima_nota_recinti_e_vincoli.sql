-- =====================================================================
-- 414 — Gli invii della Prima Nota: recinti come l'archivio, e la traccia non si cancella da sola
-- =====================================================================
-- Tre cose che i revisori hanno trovato sulla 413 (16/11/2026). Nessuna è un
-- buco aperto oggi, tutte e tre sono porte chiuse prima che qualcuno ci passi.
--
-- 1. ON DELETE CASCADE verso `import_documents` → RESTRICT.
--    La riga dell'invio è l'UNICA traccia di cosa è andato allo studio, quando e
--    a chi: con il cascade, il giorno in cui qualcuno cancella il documento
--    dall'archivio quella traccia sparirebbe in silenzio, cioè proprio il dato
--    per cui la tabella esiste. Oggi nessun percorso del gestionale cancella
--    questi file (i `delete()` su `import_documents` in ImportHub lavorano sui
--    file delle proprie fonti), quindi non si perde niente. Con RESTRICT, per
--    cancellare il documento bisogna prima togliere gli invii: una scelta
--    consapevole invece di una sorpresa.
--
-- 2. Chi può scrivere un invio = chi può scrivere nell'archivio.
--    La 413 lasciava inserire e cancellare righe a ogni ruolo della stessa
--    azienda, quindi anche a `cfo`, `ceo`, `coo`, `budget_approver`, mentre
--    `import_documents` si scrive solo con `super_advisor` o `contabile`. Era
--    più larga del documento che descrive: un invio falso, o la cancellazione di
--    un invio vero, falserebbe la risposta a «cosa ha lo studio». Ora la regola
--    è la stessa dell'archivio, copiata da `import_documents_write`.
--    La LETTURA resta a tutti quelli che già vedono Banche: serve a sapere se un
--    file è partito, e non è un dato da nascondere a chi legge la Prima Nota.
--
-- 3. Due vincoli nel WITH CHECK, perché il campo di audit non sia falsificabile:
--    `registrato_da` deve essere chi sta scrivendo (il DEFAULT lo riempie già,
--    ma via REST si poteva passare un altro uid), e il documento deve essere
--    della stessa azienda della riga.
--
-- NO DATA LOSS: cambia un vincolo e due policy. Nessuna riga toccata (al
-- 16/11/2026 la tabella è appena nata e vuota su entrambi i tenant).
-- Tenant: NZ e Zago.
-- =====================================================================

BEGIN;

-- 1. La traccia dell'invio non cade col documento
ALTER TABLE public.prima_nota_invii
  DROP CONSTRAINT IF EXISTS prima_nota_invii_document_id_fkey;
ALTER TABLE public.prima_nota_invii
  ADD CONSTRAINT prima_nota_invii_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES public.import_documents(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.prima_nota_invii.document_id IS
  'Il file archiviato che è stato mandato. ON DELETE RESTRICT di proposito (414): cancellare un documento con un invio registrato butterebbe via la traccia di cosa ha ricevuto lo studio, quindi prima si toglie l''invio, consapevolmente.';

-- 2. e 3. Scrittura solo a chi scrive l'archivio, con i due vincoli di audit
DROP POLICY IF EXISTS prima_nota_invii_write ON public.prima_nota_invii;
CREATE POLICY prima_nota_invii_write ON public.prima_nota_invii FOR ALL TO authenticated
  USING (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.get_my_role()) = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])
  )
  WITH CHECK (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.get_my_role()) = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])
    -- Chi registra è chi sta scrivendo: il DEFAULT riempie il campo, questo
    -- impedisce di passarne un altro via REST.
    AND registrato_da = (SELECT auth.uid())
    -- Il documento è dell'azienda della riga: niente invii appesi a un file
    -- che non è nostro.
    AND EXISTS (
      SELECT 1 FROM public.import_documents d
       WHERE d.id = prima_nota_invii.document_id
         AND d.company_id = prima_nota_invii.company_id
    )
  );

COMMIT;

-- =====================================================================
-- Verifica (su NZ e su Zago)
-- =====================================================================
--   SELECT confdeltype FROM pg_constraint
--    WHERE conname = 'prima_nota_invii_document_id_fkey';
--   -- atteso: r  (RESTRICT; la 413 l'aveva lasciato a 'c', CASCADE)
--
--   SELECT count(*) AS policy FROM pg_policies
--    WHERE schemaname='public' AND tablename='prima_nota_invii';
--   -- atteso: 9 (come prima: la write è sostituita, non aggiunta)
-- =====================================================================
