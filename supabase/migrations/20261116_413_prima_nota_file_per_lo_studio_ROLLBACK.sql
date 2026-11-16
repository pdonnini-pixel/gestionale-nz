-- Rollback della 413: via la tabella degli invii del file della Prima Nota.
-- ATTENZIONE: cancella le righe degli invii registrati (chi, quando, a chi).
-- I file restano in archivio: quelli stanno in `import_documents` e non si toccano.
DROP TABLE IF EXISTS public.prima_nota_invii;
