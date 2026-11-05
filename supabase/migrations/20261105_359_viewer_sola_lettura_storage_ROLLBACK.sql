-- ROLLBACK della migrazione 359: il viewer torna a poter caricare, sostituire
-- e cancellare file nei bucket che controllano solo bucket_id. Solo policy,
-- nessun file toccato.
DROP POLICY IF EXISTS viewer_sola_lettura_insert ON storage.objects;
DROP POLICY IF EXISTS viewer_sola_lettura_update ON storage.objects;
DROP POLICY IF EXISTS viewer_sola_lettura_delete ON storage.objects;
