-- ROLLBACK della migrazione 353: toglie il blocco del ruolo dipendente sui
-- file. Solo policy, nessun file toccato. Riapre ai dipendenti tutti i bucket
-- privati: usarlo solo se la 353 blocca qualcosa che l'app deve raggiungere.
DROP POLICY IF EXISTS dipendente_block ON storage.objects;
