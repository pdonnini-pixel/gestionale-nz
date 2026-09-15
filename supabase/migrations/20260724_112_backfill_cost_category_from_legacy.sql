-- 20260724_112_backfill_cost_category_from_legacy.sql
-- Backfill di cash_movements.cost_category_id a partire dal campo legacy `category`
-- (tassonomia storica a slug), così che i report per categoria (Conto Economico
-- vista cassa, Margini per Categoria) tornino a ricevere dati.
--
-- MODALITÀ: conferma diretta (scrive cost_category_id + ai_method='manual' +
-- ai_confidence=1.0). Riempie SOLO le righe con cost_category_id IS NULL (additivo,
-- non sovrascrive nulla). Risoluzione della categoria PER NOME e per company_id →
-- lo stesso script funziona su NZ/Made/Zago (UUID diversi).
--
-- ⚠️ PRIMA DI APPLICARE: eseguire su OGNI tenant la query di ricognizione (vedi
-- AI_CATEGORIE_BACKFILL_NOTES.md) per confermare che gli slug legacy e i nomi
-- categoria coincidano. Su NZ verificato il 2026-07-24.
--
-- ⚠️ DIPENDENZA: eseguire PRIMA 20260724_111 (categoria "Imposte e tasse").
--
-- COSA NON TOCCA (Fase 3, gestione manuale separata):
--   - giroconti  → trasferimenti tra conti, NON sono costi (esclusi per scelta)
--   - spese_banca con descrizione "bonifico%" / "causale: disposizione%" → sono
--     pagamenti in uscita a controparti mascherati, NON oneri bancari (~255k su NZ)
--   - financials, storage, loans (uscita) → composizione incerta, revisione manuale
--   - tutte le ENTRATE → i ricavi hanno già la loro fonte (daily_revenue)

BEGIN;

-- ── Backup fail-safe (NO DATA LOSS): stato pre-modifica di tutte le uscite con slug legacy.
-- Consente il rollback puntuale. Va rimossa dopo la verifica (vedi ROLLBACK / NOTES).
CREATE TABLE IF NOT EXISTS _backup_cash_movements_cat_20260724 AS
SELECT id, company_id, category, cost_category_id, ai_method, ai_confidence, ai_categorized_at
FROM cash_movements
WHERE category IS NOT NULL AND type = 'uscita';

-- Helper: macro dell'UPDATE per-nome, solo su righe non ancora categorizzate.
-- (ripetuto inline per ogni mapping perché SQL puro non ha funzioni al volo)

-- 1. stipendi → Personale dipendente
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Personale dipendente'
  AND cm.category = 'stipendi' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL;

-- 2. carte → Commissioni carte e varie
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Commissioni carte e varie'
  AND cm.category = 'carte' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL;

-- 3. fees → Commissioni carte e varie
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Commissioni carte e varie'
  AND cm.category = 'fees' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL;

-- 4. tasse → Imposte e tasse (categoria creata in 111)
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Imposte e tasse'
  AND cm.category = 'tasse' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL;

-- 5. utilities → Energia elettrica e gas
--    (NB: potrebbe includere qualche linea telefonica; ricontrollare a mano se serve)
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Energia elettrica e gas'
  AND cm.category = 'utilities' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL;

-- 6. real_estate → Locazione outlet
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Locazione outlet'
  AND cm.category = 'real_estate' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL;

-- 7. transport → mezzi e carburante
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'mezzi e carburante'
  AND cm.category = 'transport' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL;

-- 8. contractors → Consulenze tecniche
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Consulenze tecniche'
  AND cm.category = 'contractors' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL;

-- ── Split di spese_banca (calderone): solo la parte "vere spese bancarie".
--    I bonifici in uscita ("bonifico%" / "causale: disposizione%") NON vengono toccati.
--    Ordine: prima i pattern specifici (bollo, interessi), poi le commissioni.

-- 9a. spese_banca: imposta di bollo → Imposte e tasse
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Imposte e tasse'
  AND cm.category = 'spese_banca' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL
  AND (lower(cm.description) LIKE '%imposta di bollo%' OR lower(cm.description) LIKE '%imp. bollo%');

-- 9b. spese_banca: interessi e competenze → Interessi passivi
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Interessi passivi'
  AND cm.category = 'spese_banca' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL
  AND lower(cm.description) LIKE '%interessi e competenze%';

-- 9c. spese_banca: commissioni/POS/transato/bollettini → Commissioni carte e varie
UPDATE cash_movements cm
SET cost_category_id = cc.id, ai_method = 'manual', ai_confidence = 1.0, ai_categorized_at = now()
FROM cost_categories cc
WHERE cc.company_id = cm.company_id AND cc.name = 'Commissioni carte e varie'
  AND cm.category = 'spese_banca' AND cm.type = 'uscita' AND cm.cost_category_id IS NULL
  AND (
    lower(cm.description) LIKE 'commissioni%'
    OR lower(cm.description) LIKE '%pagobancomat%'
    OR lower(cm.description) LIKE '%transato%'
    OR lower(cm.description) LIKE '%oneri e commissioni%'
    OR lower(cm.description) LIKE '%pagamento bolletti%'
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICHE POST-BACKFILL (eseguire e confrontare):
--
-- Copertura: quante uscite ora categorizzate vs residue
--   SELECT count(*) FILTER (WHERE cost_category_id IS NOT NULL) AS categorizzati,
--          count(*) FILTER (WHERE cost_category_id IS NULL)     AS residui
--   FROM cash_movements WHERE type = 'uscita' AND category IS NOT NULL;
--
-- Totali per categoria (devono comparire in Conto Economico → vista cassa):
--   SELECT cc.name, count(*) n, round(sum(abs(cm.amount))) tot
--   FROM cash_movements cm JOIN cost_categories cc ON cc.id = cm.cost_category_id
--   WHERE cm.type = 'uscita' GROUP BY cc.name ORDER BY tot DESC;
--
-- Residui da gestire a mano (Fase 3): giroconti, spese_banca-bonifici, financials, storage, loans
--   SELECT category, count(*) FROM cash_movements
--   WHERE type='uscita' AND category IS NOT NULL AND cost_category_id IS NULL
--   GROUP BY category ORDER BY 2 DESC;
--
-- Dopo aver verificato tutto: DROP TABLE _backup_cash_movements_cat_20260724;
-- ═══════════════════════════════════════════════════════════════════════════
