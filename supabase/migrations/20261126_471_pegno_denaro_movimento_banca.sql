-- 471 · Il pegno in denaro e' un movimento della banca, non un pagamento a fornitore
--
-- Il 28/10/2026 MPS ha addebitato 44.100,00 con la causale «DISPOSIZIONE PEGNO
-- DENARO»: e' la somma vincolata a garanzia della fideiussione n. 7017101 a favore
-- di Westi Srl (affitto di Roma Soratte). La gemella SQL del filtro conosceva solo
-- «COSTITUZIONE PEGNO», quindi il motore poteva proporre l'abbinamento di quel
-- movimento a una fattura. Si aggiunge «PEGNO DENARO», come in BANK_OWN_MOVEMENT_RE
-- (src/lib/reconcileMatch.ts). Solo la regex cambia, nessun dato toccato.
-- Tenant: NZ e Zago (Made escluso dal 03/11/2026). Rollback in _ROLLBACK.sql
-- Nota: sui due database e' registrata con il nome 20261126_468_pegno_denaro_movimento_banca
-- (applicata prima di vedere che 468, 469 e 470 erano gia' presi su main).

CREATE OR REPLACE FUNCTION public.fn_bank_own_movement(p_descr text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_descr, '') ~* '(RATA DI MUTUO|RIMBORSO FINANZ|CANONE RAPPORTO|CANONE SET DI BASE|CANONE HOME BANKING|COMM/SPESE SU FIDEJUSSION|FONDO DI GARANZIA|PREL\.CONT|PRELEVAMENTO|PASSAGGIO CONTANTI|GIROCONTO|COSTITUZIONE PEGNO|PEGNO DENARO|A FAVORE NEXI PAYMENTS|A FAVORE GLOBAL BLUE|ADDEBITO DIRETTO CARTA|POSIZIONE CARTA)';
$function$;

COMMENT ON FUNCTION public.fn_bank_own_movement(text) IS
  'Vero se la causale e'' di un movimento della banca o di un giro interno (rata di mutuo, canone del rapporto, prelievo, giroconto, pegno in denaro, commissioni POS, addebito estratto carte): non ha una fattura dietro. Gemella di BANK_OWN_MOVEMENT_RE in src/lib/reconcileMatch.ts: se cambia una, cambiare l''altra.';
