-- NZ_ONLY 300 — categorie di cinque fornitori decise da Patrizio (12/10/2026)
--
-- Fornitori trovati per partita IVA, solo dove la categoria è vuota.
-- Le regole di riparto restano quelle che ci sono (simulazione: nessuna cambia).
--   Fastweb (12878470157)                → TELEFON      linee telefoniche (sede)
--   GLS Enterprise (04102770965)         → SPEDIZ       spedizioni (sede)
--   Blustudio Immobiliare (02878330733)  → CONS_LEG     fatture: «consulenza ed assistenza
--                                           contrattuale» per le unità locali di Valmontone
--                                           (FPR 3/26) e Torino (FPR 21/26)
--   Caccia Agnese (17910331002)          → ALLESTIMENTI costo di inizio attività di Roma Soratte
--   Annalisa Boschetti (12262010155)     → ALLESTIMENTI fattura 652 del 14/04/2026: onorario per
--                                           l'affitto di ramo d'azienda Torino Fashion Village /
--                                           New Zago, costo di avvio di Torino (come Caccia Agnese)
-- Ogni fornitore riceve una nota datata.
-- Rollback: UPDATE suppliers SET default_cost_category_id = NULL WHERE company_id = <NZ>
--           AND partita_iva IN ('12878470157','04102770965','02878330733','17910331002','12262010155');

WITH scelte(piva, code, nota) AS (VALUES
  ('12878470157', 'TELEFON',      'categoria Linee telefoniche'),
  ('04102770965', 'SPEDIZ',       'categoria Spedizioni'),
  ('02878330733', 'CONS_LEG',     'categoria Consulenze legali e notarili: assistenza contrattuale per le unità di Valmontone e Torino'),
  ('17910331002', 'ALLESTIMENTI', 'categoria Allestimenti e aperture: costo di inizio attività di Roma Soratte'),
  ('12262010155', 'ALLESTIMENTI', 'categoria Allestimenti e aperture: onorario per l''affitto di ramo d''azienda di Torino, costo di avvio')
)
UPDATE public.suppliers s
   SET default_cost_category_id = c.id,
       note = concat_ws(E'\n', nullif(s.note, ''), '12/10/2026: ' || x.nota || ' (deciso da Patrizio).')
  FROM scelte x
  JOIN public.cost_categories c ON c.code = x.code AND c.company_id = '00000000-0000-0000-0000-000000000001'
 WHERE s.company_id = '00000000-0000-0000-0000-000000000001'
   AND s.partita_iva = x.piva
   AND s.default_cost_category_id IS NULL;
