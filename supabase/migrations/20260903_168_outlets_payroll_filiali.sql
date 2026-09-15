-- 168 — Alias di FILIALE del software paghe → outlet.
--
-- Problema: l'elenco netti nomina la filiale come la conosce il consulente del
-- lavoro, e quel nome non e' sempre deducibile dall'anagrafica. Su NZ la sede
-- compare con DUE nomi diversi nello stesso file di giugno 2026:
--   «MATASSINO - FIGLINE E INCISA VALDARNO»  → si aggancia via mall_name «Matassino»
--   «LOC PIAN DI RONA - REGGELLO»            → non si aggancia a niente
-- Le 9 persone della seconda filiale restavano senza punto vendita sul cedolino.
--
-- Soluzione: una lista di alias per outlet, che il parser prova PRIMA di
-- name/mall_name/city/cost_center_key. Si popola a mano quando il consulente
-- introduce un nome nuovo: sono casi rari e vanno decisi da chi conosce
-- l'azienda, non indovinati.
--
-- ADDITIVA: solo ADD COLUMN IF NOT EXISTS. Nessun dato toccato, nessun default,
-- NULL = si comporta esattamente come prima.
-- Da applicare IDENTICA sui 3 tenant: NZ -> Made -> Zago.

BEGIN;

ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS payroll_filiali text[];

COMMENT ON COLUMN public.outlets.payroll_filiali IS
  'Nomi di filiale usati dal software paghe che corrispondono a questo outlet, quando non sono deducibili da name/mall_name/city. Confronto senza maiuscole, per contenimento.';

COMMIT;

-- VERIFICA (su ogni tenant):
--   select name, payroll_filiali from public.outlets order by name;
-- Atteso subito dopo la migration: colonna presente, tutti NULL.
