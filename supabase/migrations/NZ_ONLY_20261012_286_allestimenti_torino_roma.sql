-- NZ_ONLY Migrazione 286 — fornitori di allestimento di Torino e Roma Soratte (12/10/2026)
--
-- Verificati riga per riga da Patrizio e Claude: tutti fornitori usati solo per
-- aprire i negozi (arredi, insegne, impianti, progettazione, cantiere).
-- Categoria ALLESTIMENTI (migrazione 285) solo dove la categoria è vuota.
-- Annalisa Boschetti («onorario e competenze», Torino) resta senza categoria:
-- dalla fattura non si capisce cosa sia.

UPDATE public.suppliers s
SET default_cost_category_id = c.id
FROM public.cost_categories c
WHERE c.company_id = s.company_id AND c.code = 'ALLESTIMENTI'
  AND s.default_cost_category_id IS NULL
  AND s.vat_number IN ('05095320288',  -- Mingardo: arredi negozio Torino
                       '03969640287',  -- Paolo Salmistraro: mobile cassa, tavoli
                       '04211030962',  -- Kenfoster: specchi, zoccolini, rivestimenti
                       '09798060019',  -- Beyond: insegne e loghi
                       '02464980016',  -- Franco Rubini: progettazione climatizzazione
                       '03462060165',  -- Studio Scandella: progettazione impianti
                       '09136730018',  -- Lauria Impianti: sprinkler
                       '02713600282',  -- A. & C. Group: tende camerini
                       '02692080019',  -- O.C.R. System: registratore di cassa
                       '02002730287',  -- Cerbino: scaffalature
                       '10046341219'); -- Synthesis: prestazioni per il cantiere di Roma Soratte
