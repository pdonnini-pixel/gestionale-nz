-- ROLLBACK della 218. Attenzione: toglie la colonna e con lei l'informazione
-- su quali liquidazioni avevano un importo scritto a mano. Gli `importo` già
-- salvati restano, ma non si distingue più se vengono dalla formula o dal
-- commercialista.
BEGIN;
ALTER TABLE public.vat_settlements DROP COLUMN IF EXISTS importo_manuale;
COMMIT;
