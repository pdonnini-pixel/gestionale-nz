-- NZ_ONLY 339 — Account di cassa di Roma Soratte: le sue email vanno anche
-- all'amministrazione (Patrizio, 03/11/2026). Solo NZ: l'account esiste solo lì.
UPDATE public.user_profiles
   SET email_cc = 'newzago@vicolo.com'
 WHERE lower(email) = 'roma@outletvicolo.com'
   AND email_cc IS NULL;
