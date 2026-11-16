-- ROLLBACK 415 — spegne il riparto in parti uguali fra i negozi.
-- Basta spegnere la scelta: con riparto_parti_uguali NULL la funzione si comporta come prima della 415.
UPDATE public.company_settings SET riparto_parti_uguali = NULL WHERE riparto_parti_uguali IS NOT NULL;
-- Le regole già create («Automatica: parti uguali fra i negozi…») restano finché il riparto
-- notturno non le sostituisce; per tornare alla funzione originale si riesegue la sua
-- definizione da 20261012_302_categoria_dalle_fatture.sql (e precedenti).
-- La colonna resta: è innocua.
