-- 187 — «ricaricare sovrascrive»: anche in archivio.
--
-- (Applicata sui tre tenant col nome 20260904_177 prima che su main arrivasse
-- un'altra 177: rinumerata qui, contenuto identico.)
--
-- Finora ogni caricamento aggiungeva una riga a import_documents. Ricaricando lo
-- stesso mese (cosa che capita: il consulente ristampa, o il primo file era quello
-- sbagliato) i DATI venivano sostituiti ma l'ARCHIVIO teneva entrambi i file, senza
-- dire quale fosse quello buono. Chi riapriva l'archivio per capire un numero
-- rischiava di leggere la versione vecchia.
--
-- NO DATA LOSS: non si cancella niente. Il caricamento precedente resta, con la
-- data in cui e' stato sostituito e il puntatore a quello che l'ha sostituito.
-- La UI mostra di default solo la versione corrente.

BEGIN;

ALTER TABLE import_documents
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES import_documents(id) ON DELETE SET NULL;

COMMENT ON COLUMN import_documents.superseded_at IS
  'Quando questo caricamento e'' stato sostituito da uno piu'' recente dello stesso documento e periodo. NULL = versione corrente.';
COMMENT ON COLUMN import_documents.superseded_by IS
  'Il caricamento che ha sostituito questo.';

-- Elenco dell''archivio: quasi sempre filtrato sulle sole versioni correnti.
CREATE INDEX IF NOT EXISTS idx_import_documents_correnti
  ON import_documents (company_id, uploaded_at DESC)
  WHERE superseded_at IS NULL;

-- Ricerca dei precedenti dello stesso documento/periodo.
CREATE INDEX IF NOT EXISTS idx_import_documents_periodo
  ON import_documents (company_id, funzione, year, month);

COMMIT;
