-- ============================================================================
-- ROLLBACK 20260806_145_riba_distinta_upload.sql
-- Rimuove RPC e tabelle della Fase 2 (upload distinta RiBa). NON riapre le
-- scadenze gia' confermate (usare rpc_riba_provisional_undo se serve). Il bucket
-- storage e le sue policy restano (rimozione manuale opzionale, in fondo).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_confirm_riba_distinta(uuid);
DROP FUNCTION IF EXISTS public.rpc_confirm_riba_distinta_line(uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_automatch_riba_distinta(uuid);
DROP FUNCTION IF EXISTS public.fn_payable_is_riba(uuid);

DROP TABLE IF EXISTS public.riba_distinta_lines;
DROP TABLE IF EXISTS public.riba_distinte;

COMMIT;

-- Rimozione opzionale del bucket e delle policy storage (eseguire a mano):
-- DROP POLICY IF EXISTS "riba_distinte_read" ON storage.objects;
-- DROP POLICY IF EXISTS "riba_distinte_write" ON storage.objects;
-- DROP POLICY IF EXISTS "riba_distinte_del" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'riba-distinte';
