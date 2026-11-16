-- ROLLBACK 415 — spegne il riparto in parti uguali fra i negozi.
--
-- 1. Spegne la scelta: con riparto_parti_uguali NULL la funzione si comporta come prima della 415.
UPDATE public.company_settings SET riparto_parti_uguali = NULL WHERE riparto_parti_uguali IS NOT NULL;

-- 2. Disattiva (non cancella) le regole create dal sistema con la scelta accesa.
--    Senza questo passo resterebbero attive per sempre: con la scelta spenta il riparto
--    notturno non le sostituisce, perché per quei fornitori non trova niente di meglio
--    (revisore-database, 16/11/2026). Le regole messe a mano (created_by non NULL) non si toccano.
UPDATE public.supplier_allocation_rules
   SET is_active = false, updated_at = now()
 WHERE created_by IS NULL
   AND is_active
   AND description LIKE 'Automatica: parti uguali fra i negozi%';

-- 3. La funzione resta quella della 415: con la scelta spenta il passaggio nuovo non scatta
--    e il resto è identico a prima. Per riportarla al testo esatto di prima si rifanno al
--    contrario le tre sostituzioni della 415 (b3→a3, b2→a2, b1→a1) con la stessa tecnica replace().
-- La colonna resta: è innocua.
