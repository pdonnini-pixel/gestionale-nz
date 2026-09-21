-- ROLLBACK di NZ_ONLY 241 — rimette la stima sulle quattro PAT della sede e la
-- nota «da confermare» su Torino.
BEGIN;

UPDATE inail_rates
   SET rate_percent = 0.1859,
       note = 'Stimato dai dati gennaio-aprile 2026 (INAIL della Statistica costo orario diviso imponibile PAT del Prospetto paghe). Non e'' il tasso dell''autoliquidazione INAIL: sovrascrivilo appena disponibile.',
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label IN ('MATASSINO-MAGAZZINO', 'MATASSINO-AMMINISTRAZIONE',
                     'PIAN DI RONA - MAGAZZINO', 'PIAN DI RONA - AMMINISTRAZIONE');

UPDATE inail_rates
   SET note = 'Tasso ufficiale della ditta per la voce 0111 (7,31 per mille). La PAT di Torino e'' stata aperta nel 2026 e non compare nelle basi di calcolo 2025/26: da confermare con la PEC di iscrizione INAIL.',
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label = 'TORINO';

COMMIT;
