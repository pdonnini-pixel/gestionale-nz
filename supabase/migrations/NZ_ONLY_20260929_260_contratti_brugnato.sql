-- =====================================================================
-- NZ_ONLY 260 — Contratti di Brugnato e orari allineati allo studio paghe
-- =====================================================================
-- SOLO NEW ZAGO: dati, non schema. GIA' APPLICATA il 29/09/2026 via MCP;
-- il file resta come traccia. Ogni UPDATE e' condizionato al valore
-- vecchio, quindi rieseguirlo non cambia niente.
--
-- FONTE: mail «Contratti Brugnato» dello studio paghe del 29/09/2026 con
-- 11 PDF (10 diversi: «contratto» e «proroga» di Rossini erano lo stesso
-- file). Regola di Patrizio: il documento dello studio vale come dato
-- corretto e sostituisce l'anagrafica (vedi CLAUDE.md).
--
--   KACORRI  indeterminato 3° liv. dal 25/06/2025; full time 40 h dalla
--            mail (lettera di trasformazione ancora da ricevere); in
--            maternita'. part_time 90 -> full time.
--   BURATTA  full time 40 h dal 01/07/2026 (lettera 30/06/2026),
--            indeterminato dal 26/09/2026. part_time 75 -> full time.
--   ROSSINI  30 h dal 01/09/2026 (accordo 28/08/2026); proroga al
--            31/01/2027 (lettera 27/07/2026). part_time 62,5 -> 75,
--            durata 12,83 -> 18,8 mesi, mesi con causale 11,17 -> 5,2.
--   RUGGERI  TD 05/08-04/11/2026, 30 h, 4° liv., commessa (contratto
--            03/08/2026): aggiunti CF, livello, qualifica, dati TD.
--   FALCHI   non nella mail ma contratto in corso: proroghe al 15/09
--            (lettera 04/09) e al 15/10/2026 (lettera 15/09). Resta
--            attiva. Scadenza 05/09 -> 15/10, proroghe 0 -> 2 su 4.
--
-- In piu', stessa regola: la % part time di Guerra (90 -> 85), Landino
-- (75 -> 80) e Lorenzini (full time -> 87,5) allineata alle ore del
-- tabulato ferie dello studio; ore_settimanali (40 per tutti, valore di
-- partenza) = ore del tabulato per le 25 persone che differivano.
--
-- I 10 PDF sono in employee_documents (bucket employee-documents,
-- employee-documents/{employee_id}/{data}_{tipo}.pdf), caricati con una
-- funzione temporanea poi dismessa (tmp-employee-docs-upload -> 410).
-- =====================================================================
BEGIN;

UPDATE employees SET part_time_pct = NULL, ore_settimanali = 40
WHERE id = 'de91040c-2fc0-4c3e-9a6a-2c00e11df088' AND part_time_pct = 90;

UPDATE employees SET part_time_pct = NULL, ore_settimanali = 40
WHERE id = '84c841ed-b7f3-47f7-9767-71628b1d469d' AND part_time_pct = 75;

UPDATE employees SET part_time_pct = 75, ore_settimanali = 30, durata_mesi = 18.8, mesi_disp_con_causale = 5.2
WHERE id = 'b0423593-2f17-45cb-8296-1541bc1d9b45' AND part_time_pct = 62.5;

UPDATE employees SET codice_fiscale = 'RGGCLD82A70E463Q', fiscal_code = 'RGGCLD82A70E463Q',
  livello = '4 Livello', level = '4 Livello', qualifica = 'Impiegato', role_description = 'Impiegato',
  filiale = 'BRUGNATO', ore_settimanali = 30, durata_mesi = 3, proroghe = 0, proroghe_disponibili = 4,
  mesi_disp_senza_causale = 9, mesi_disp_con_causale = 21, stato_td = 'Prorogabile/Riassumibile'
WHERE id = 'b1134b6f-e58e-4704-9d7b-841a6e574281' AND codice_fiscale IS NULL;

UPDATE employees SET scadenza_td = '2026-10-15', proroghe = 2, proroghe_disponibili = 2, durata_mesi = 4.33,
  mesi_disp_senza_causale = 7.67, mesi_disp_con_causale = 19.67, ore_settimanali = 8
WHERE id = '1fac560e-2c18-4065-85be-be640214a03a' AND scadenza_td = '2026-09-05';

-- % part time = ore del tabulato / 40 (Guerra, Landino, Lorenzini)
UPDATE employees SET part_time_pct = round(ore_settimanali_paghe / 40 * 100, 1)
WHERE id IN ('a7ff2af8-4dc3-4556-a7c3-6b241b086d09', '5a490aae-5633-45ae-aece-98bebc86f87c', '828f179b-fb36-443c-a17c-9609c16b65a2')
  AND coalesce(part_time_pct, 100) <> round(ore_settimanali_paghe / 40 * 100, 1);

-- ore_settimanali = ore del tabulato, dove ancora al valore di partenza
UPDATE employees SET ore_settimanali = ore_settimanali_paghe
WHERE is_active AND ore_settimanali_paghe IS NOT NULL AND ore_settimanali IS DISTINCT FROM ore_settimanali_paghe;

COMMIT;

-- Verifica (29/09/2026: 0 righe)
-- SELECT cognome FROM employees WHERE is_active AND ore_settimanali_paghe IS NOT NULL
--   AND coalesce(part_time_pct, 100) <> round(ore_settimanali_paghe / 40 * 100, 1);
