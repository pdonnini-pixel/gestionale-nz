-- NZ_ONLY 170 — tassi INAIL stimati per PAT (New Zago).
--
-- PERCHE'. I tassi dell'autoliquidazione INAIL non sono recuperabili: Patrizio non
-- ha accesso al documento. Senza tasso la vista per outlet calcola INAIL = 0 e il
-- costo lordo resta sotto di circa 420 euro al mese su 66.000 di retribuzioni.
--
-- COME SONO STATI RICAVATI. Da gennaio ad aprile 2026 esistono a database ENTRAMBE
-- le fonti per gli stessi mesi:
--   - personnel_gross_cost.inail_pat  → imponibile per PAT (Prospetto paghe, per outlet)
--   - personnel_gross_cost_employee.inail → importo INAIL vero (Statistica costo orario, per persona)
-- Il tasso e' il rapporto fra i due, sommato sui quattro mesi ed escludendo gli
-- amministratori (is_admin), che stanno fuori dal costo outlet.
-- SEDE / MAGAZZINO ha due PAT (amministrazione e magazzino) e una sola misura di
-- INAIL: il tasso e' quello complessivo dell'outlet, applicato a entrambe. Il totale
-- dell'outlet torna per costruzione, la ripartizione fra le due PAT no.
--
-- SONO STIME, non i tassi ufficiali: la colonna note lo dice e la UI lo mostra.
-- Appena arriva l'autoliquidazione basta riscrivere il tasso a mano dalla pagina
-- Dipendenti → Costo lordo → Tassi INAIL: il salvataggio manuale cancella la nota.
--
-- NO DATA LOSS: si scrive SOLO dove rate_percent e' NULL (verificato: tutte e 9 le
-- PAT erano a NULL il 2026-09-04). Nessun tasso inserito a mano viene toccato.

BEGIN;

UPDATE inail_rates r
   SET rate_percent = v.rate,
       note = 'Stimato dai dati gennaio-aprile 2026 (INAIL della Statistica costo orario diviso imponibile PAT del Prospetto paghe). Non e'' il tasso dell''autoliquidazione INAIL: sovrascrivilo appena disponibile.',
       updated_at = now()
  FROM (VALUES
    ('BARBERINO OUTLET',           0.8416),
    ('BRUGNATO 5 TERRE',           0.8601),
    ('FRANCIACORTA VILLAGE',       0.8769),
    ('PALMANOVA OUTLED (UDINE)',   0.7209),
    ('TORINO',                     0.8671),
    ('VALDICHIANA OUTLET',         0.8047),
    ('VALMONTONE OUTLET',          0.8728),
    ('MATASSINO-AMMINISTRAZIONE',  0.1859),
    ('MATASSINO-MAGAZZINO',        0.1859)
  ) AS v(pat, rate)
 WHERE r.company_id = '00000000-0000-0000-0000-000000000001'
   AND r.pat_label = v.pat
   AND r.rate_percent IS NULL;

COMMIT;
