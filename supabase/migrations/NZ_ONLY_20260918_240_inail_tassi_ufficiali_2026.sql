-- NZ_ONLY 240 — tassi INAIL UFFICIALI 2026 per i negozi (New Zago).
--
-- Sostituiscono le aliquote stimate scritte con la NZ_ONLY 172, quando
-- l'autoliquidazione non era recuperabile. Fonte: «Basi di calcolo premi» INAIL
-- per NEW ZAGO SRL (codice ditta 21301651), rata anno 2026, trasmessa dalla
-- consulente del lavoro il 18/09/2026.
--
-- Tutte le posizioni dei punti vendita sono gestione Terziario, voce di tariffa
-- 0111, tasso medio di tariffa 7,31 per mille, senza oscillazione: tasso medio,
-- applicabile e applicato coincidono a 7,31. In percentuale: 0,7310.
--
-- TORINO non compare nel documento perche' la sua PAT e' stata aperta nel corso
-- del 2026, ma e' la stessa voce 0111 della stessa ditta, che non ha oscillazione:
-- il tasso e' lo stesso. Resta da confermare con la PEC di iscrizione INAIL.
--
-- NON TOCCATE le quattro PAT della sede (MATASSINO e PIAN DI RONA, amministrazione
-- e magazzino). Stanno tutte sulla posizione 97211090, che porta DUE voci con
-- tassi molto diversi, 0722 a 4,00 per mille e 9300 a 16,28, e dal documento non
-- si ricava quale voce copra il magazzino e quale l'amministrazione. Gli imponibili
-- sono molto diversi fra loro (a giugno 4.151 contro 9.858), quindi l'abbinamento
-- sbagliato varrebbe circa 70 euro al mese. Restano con la stima finche' la
-- consulente non conferma, e la scheda continua a marcarli «stimato».
--
-- NO DATA LOSS: solo UPDATE delle sette righe dei negozi. Backup letto prima:
-- BARBERINO 0,8416 · BRUGNATO 0,8601 · FRANCIACORTA 0,8769 · PALMANOVA 0,7209
-- TORINO 0,8671 · VALDICHIANA 0,8047 · VALMONTONE 0,8728 (tutte stimate).

BEGIN;

UPDATE inail_rates
   SET rate_percent = 0.7310,
       note = NULL,
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label IN (
     'BARBERINO OUTLET', 'BRUGNATO 5 TERRE', 'FRANCIACORTA VILLAGE',
     'PALMANOVA OUTLED (UDINE)', 'VALDICHIANA OUTLET', 'VALMONTONE OUTLET'
   );

-- Torino: stesso tasso, ma la fonte e' un'inferenza sulla ditta, non il documento.
UPDATE inail_rates
   SET rate_percent = 0.7310,
       note = 'Tasso ufficiale della ditta per la voce 0111 (7,31 per mille). La PAT di Torino e'' stata aperta nel 2026 e non compare nelle basi di calcolo 2025/26: da confermare con la PEC di iscrizione INAIL.',
       updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label = 'TORINO';

COMMIT;
