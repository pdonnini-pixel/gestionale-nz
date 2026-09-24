-- =====================================================================
-- NZ_ONLY 256 — Anagrafica allineata all'elenco dipendenti dello studio
-- =====================================================================
-- SOLO NEW ZAGO: sono dati di persone, non una modifica di schema.
--
-- DA DOVE ARRIVA: allegato "Elenco_dipendenti 03_09_2026.xlsx" alla mail
-- di Francesca Signorini del 23/09/2026 (thread "Contratti dei dipendenti
-- in digitale e alcune domande sulle stampe dei ratei"). E' la stampa del
-- programma delle paghe: matricola, codice fiscale, natura del rapporto,
-- filiale, scadenza del determinato, proroghe. 41 persone in forza al
-- 03/09/2026.
--
-- IL CONFRONTO, RIGA PER RIGA:
--   - tutte e 41 le persone dell'elenco sono gia' attive nel gestionale:
--     non ne manca nessuna;
--   - il gestionale ne ha 54 attive, quindi 13 in piu';
--   - le 13 in piu' NON sono nell'elenco dello studio al 03/09.
--
-- PERCHE' LE 13 NON SONO "A CHIAMATA NON CHIAMATE": nell'elenco l'unico
-- contratto a chiamata e' Focardi, che infatti c'e'. Le altre non ci sono
-- proprio, e il loro ultimo cedolino sta fra gennaio e luglio 2026.
--
-- NIENTE DATA DI CESSAZIONE INVENTATA. L'elenco dice che non sono in
-- forza, non dice da quando. Quindi si mette is_active = false e si
-- scrive nelle note da dove viene la decisione. La data vera si aggiunge
-- quando arriva (Francesca manda il prospetto nuovo ai primi di ottobre).
--
-- NO DATA LOSS: nessuna riga cancellata, solo UPDATE e un flag. Le
-- persone restano in archivio fra le cessate con tutta la loro storia e
-- si riattivano dall'interfaccia. Il valore precedente di ogni campo e'
-- nei commenti, sotto ogni blocco.
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. LE 13 CHE NON SONO NELL'ELENCO DELLO STUDIO
--    Com'erano prima: is_active = true, data_cessazione = NULL.
--    Fra parentesi l'ultimo cedolino che risulta nel gestionale.
--      ARCHETTI IARA CAMILLA (gen 2026)   BERLINCIONI LORENZO (giu)
--      BRINI CAMILLA (giu)                COLLETTI ELEONORA (lug)
--      D'ALESSANDRO NICOLA (giu)          GAMBERI NOEMI (giu)
--      LAUTO CHIARA (apr)                 MEUCCI LUDOVICA (giu)
--      PASQUALETTI ALESSANDRO (mag)       RIPOLI ELISA (mag)
--      SPANGARO EMMA (feb)                TAVANTI SARA (lug)
--      TONDON SARA (feb)
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.employees e
   SET is_active = false,
       note = concat_ws(' ', e.note,
         '[24/09/2026] Non presente nell''elenco dipendenti in forza dello studio paghe al 03/09/2026. Data di cessazione da confermare.')
 WHERE e.is_active
   AND upper(btrim(e.cognome)) || '|' || upper(btrim(e.nome)) IN (
     'ARCHETTI|IARA CAMILLA', 'BERLINCIONI|LORENZO', 'BRINI|CAMILLA',
     'COLLETTI|ELEONORA', 'D''ALESSANDRO|NICOLA', 'GAMBERI|NOEMI',
     'LAUTO|CHIARA', 'MEUCCI|LUDOVICA', 'PASQUALETTI|ALESSANDRO',
     'RIPOLI|ELISA', 'SPANGARO|EMMA', 'TAVANTI|SARA', 'TONDON|SARA'
   );

-- ─────────────────────────────────────────────────────────────────────
-- 2. LE CINQUE SENZA SEDE CHE LA SEDE CE L'HANNO
--    Erano tutte con outlet_id, contratto_tipo, data_assunzione e
--    scadenza_td a NULL: schede nate dall'import dei cedolini.
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.employees e
   SET outlet_id      = o.id,
       contratto_tipo = 'determinato',
       data_assunzione = v.assunzione,
       hire_date       = v.assunzione,
       scadenza_td     = v.scadenza,
       part_time_pct   = v.pt,
       note = concat_ws(' ', e.note,
         '[24/09/2026] Sede, contratto e date dall''elenco dipendenti dello studio paghe al 03/09/2026.')
  FROM (VALUES
    ('BALADA',    'ANNALAURA', 'FRANCIACORTA',     DATE '2026-07-27', DATE '2027-01-26', 75.0),
    ('FRAPPA',    'ANNALISA',  'VALDICHIANA',      DATE '2026-07-16', DATE '2027-01-16', 75.0),
    ('PAMPALONI', 'DARIA',     'BARBERINO',        DATE '2026-07-01', DATE '2026-09-30', 75.0),
    ('RUGGERI',   'CLAUDIA',   'BRUGNATO',         DATE '2026-08-05', DATE '2026-11-04', 75.0),
    ('SUZZI',     'SILVIA',    'BARBERINO',        DATE '2026-07-13', DATE '2026-10-12', 87.5)
  ) AS v(cognome, nome, sede, assunzione, scadenza, pt)
  JOIN public.outlets o ON upper(btrim(o.name)) = v.sede
 WHERE e.is_active
   AND upper(btrim(e.cognome)) = v.cognome
   AND upper(btrim(e.nome))    = v.nome
   AND e.outlet_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3. LE QUATTRO MATRICOLE SBAGLIATE
--    Come da regola gia' applicata all'import del tabulato: la matricola
--    buona e' quella dello studio, che non puo' cambiarla.
--      BALADA  0000095 -> 0000097     CENI    0000064 -> 0000080
--      DROZINA 0000072 -> 0000075     FALCHI  0000086 -> 0000088
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.employee_matricole m
   SET is_current = false,
       note = concat_ws(' ', m.note, 'Sostituita il 24/09/2026 dalla matricola dello studio paghe.')
  FROM public.employees e
 WHERE m.employee_id = e.id AND m.is_current
   AND upper(btrim(e.cognome)) IN ('BALADA', 'CENI', 'DROZINA', 'FALCHI')
   AND e.matricola IN ('0000095', '0000064', '0000072', '0000086');

UPDATE public.employees e
   SET matricola = v.nuova,
       note = concat_ws(' ', e.note,
         concat('[24/09/2026] Matricola allineata allo studio paghe: ', e.matricola, ' -> ', v.nuova, '.'))
  FROM (VALUES ('BALADA','0000095','0000097'), ('CENI','0000064','0000080'),
               ('DROZINA','0000072','0000075'), ('FALCHI','0000086','0000088')
  ) AS v(cognome, vecchia, nuova)
 WHERE upper(btrim(e.cognome)) = v.cognome AND e.matricola = v.vecchia;

INSERT INTO public.employee_matricole (company_id, employee_id, matricola, is_current, valid_from, note)
SELECT e.company_id, e.id, e.matricola, true, DATE '2026-09-24',
       'Matricola dall''elenco dipendenti dello studio paghe al 03/09/2026.'
  FROM public.employees e
 WHERE e.matricola IN ('0000097', '0000080', '0000075', '0000088')
   AND NOT EXISTS (SELECT 1 FROM public.employee_matricole m
                    WHERE m.employee_id = e.id AND m.matricola = e.matricola);

-- ─────────────────────────────────────────────────────────────────────
-- 4. LE SCADENZE DEL DETERMINATO RIMASTE INDIETRO
--    Solo dove l'elenco e' PIU' RECENTE del nostro dato. Restano
--    intoccate Guerra, Langella e Sestini, dove siamo noi ad essere
--    avanti: le loro proroghe sono del 23/09, l'elenco e' del 03/09.
--    Intoccata anche Buratta, passata a indeterminato il 26/09.
--      ASTUTI      2026-07-31 -> 2027-01-31
--      BELLAPIANTA 2026-06-23 -> 2026-09-23
--      BUSE'       2026-08-10 -> 2027-02-10
--      CLEMENTI    2026-07-31 -> 2027-01-31
--      FOCARDI     2026-06-19 -> 2026-09-30
--      LANDINO     2026-08-10 -> 2027-02-10
--      NANDESI     2026-07-31 -> 2027-01-31
--      RACHELE     2026-08-31 -> 2026-11-30
--      ROSSINI     2026-07-31 -> 2027-01-31
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.employees e
   SET scadenza_td = v.scadenza,
       note = concat_ws(' ', e.note,
         concat('[24/09/2026] Scadenza del determinato aggiornata dall''elenco dello studio paghe: ', e.scadenza_td, ' -> ', v.scadenza, '.'))
  FROM (VALUES
    ('ASTUTI',      'MARINA',            DATE '2027-01-31'),
    ('BELLAPIANTA', 'FRANCESCA',         DATE '2026-09-23'),
    ('BUSE''',      'SARA',              DATE '2027-02-10'),
    ('CLEMENTI',    'CLAUDIA',           DATE '2027-01-31'),
    ('FOCARDI',     'NICCOLO''',         DATE '2026-09-30'),
    ('LANDINO',     'GIULIA',            DATE '2027-02-10'),
    ('NANDESI',     'IRENE',             DATE '2027-01-31'),
    ('RACHELE',     'MIRIAM',            DATE '2026-11-30'),
    ('ROSSINI',     'SERENA',            DATE '2027-01-31')
  ) AS v(cognome, nome, scadenza)
 WHERE e.is_active
   AND upper(btrim(e.cognome)) = v.cognome
   AND upper(btrim(e.nome))    = v.nome
   AND e.scadenza_td IS DISTINCT FROM v.scadenza;

COMMIT;

-- VERIFICA:
--   SELECT count(*) FILTER (WHERE is_active) AS in_forza,          -- atteso 41
--          count(*) FILTER (WHERE is_active AND outlet_id IS NULL) -- atteso 0
--     FROM public.employees;
