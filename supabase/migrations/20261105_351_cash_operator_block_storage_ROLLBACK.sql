-- ROLLBACK della migrazione 351: toglie il blocco dell'account di cassa sui
-- file. Solo policy, nessun file toccato. Riapre all'operatore di cassa tutti
-- i bucket privati: usarlo solo se la 351 blocca qualcosa che la chiusura di
-- cassa deve raggiungere.
DROP POLICY IF EXISTS cash_operator_block ON storage.objects;
