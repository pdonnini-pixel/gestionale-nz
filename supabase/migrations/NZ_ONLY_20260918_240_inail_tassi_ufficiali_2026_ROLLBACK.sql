-- ROLLBACK di NZ_ONLY 240 — rimette le aliquote stimate della NZ_ONLY 172.
BEGIN;

UPDATE inail_rates r
   SET rate_percent = v.rate,
       note = 'Stimato dai dati gennaio-aprile 2026 (INAIL della Statistica costo orario diviso imponibile PAT del Prospetto paghe). Non e'' il tasso dell''autoliquidazione INAIL: sovrascrivilo appena disponibile.',
       updated_at = now()
  FROM (VALUES
    ('BARBERINO OUTLET',         0.8416),
    ('BRUGNATO 5 TERRE',         0.8601),
    ('FRANCIACORTA VILLAGE',     0.8769),
    ('PALMANOVA OUTLED (UDINE)', 0.7209),
    ('TORINO',                   0.8671),
    ('VALDICHIANA OUTLET',       0.8047),
    ('VALMONTONE OUTLET',        0.8728)
  ) AS v(pat, rate)
 WHERE r.company_id = '00000000-0000-0000-0000-000000000001'
   AND r.pat_label = v.pat;

COMMIT;
