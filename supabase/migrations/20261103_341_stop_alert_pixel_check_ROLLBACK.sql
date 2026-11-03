-- ROLLBACK della 341: rimette il controllo ogni 30 minuti.
-- Funziona solo se il repository torna pubblico, o se check_pixel_and_alert()
-- riceve un token GitHub di sola lettura.
SELECT cron.schedule('alert-pixel-check-rosso', '*/30 * * * *', 'SELECT public.check_pixel_and_alert();');
