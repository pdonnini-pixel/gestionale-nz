-- =====================================================================
-- 444 — Se la causale dice a chi è andato il soldo, quello è il fornitore. NZ + Zago.
-- =====================================================================
-- Da applicare DOPO la 443 (la controlla da sé e si ferma se non c'è).
--
-- Il fatto (NZ, 23/11/2026). L'addebito del 06/03/2026 da 251,22 dice:
--
--   «ADDEBITO SDD N. 619648592 A FAVORE GLOBAL BLUE ITALIA SRL CODICE MANDATO
--    ITA145205C IMPORTO 251,22 ... 50129 FIRENZE Incl. VAT 0.00»
--
-- e il motore l'ha agganciato alla fattura di UNICOOP FIRENZE da 250,00. La
-- conferma del fornitore era arrivata da `supplier_confirmed_in_text`, che
-- accetta QUALSIASI parola del nome lunga almeno 4 lettere e fuori dalla lista
-- delle parole di contorno. Delle nove parole del nome UNICOOP, l'unica che
-- compare nella causale è «FIRENZE», e ci compare perché è la città scritta
-- sul documento tax free. Una città non dice chi è il fornitore.
--
-- La correzione NON è allungare la lista delle parole da ignorare: ci sono
-- fornitori che SI CHIAMANO con un luogo (Torino Fashion Village, Valdichiana
-- Propco, dove «propco» è già fra le parole di contorno e resterebbe solo
-- «valdichiana»), e metterli nella lista li renderebbe irriconoscibili.
--
-- La correzione è leggere il documento: quando la causale nomina un
-- beneficiario esplicito («A FAVORE …»), quello è chi ha preso i soldi, e deve
-- essere il fornitore della fattura. Vale solo nel ramo debole
-- `rerun_bijective_reconciliation` (stesso importo, date vicine, fornitore
-- nominato), non nei rami che hanno una prova nel documento: se la causale cita
-- il numero di QUESTA fattura, passa comunque, perché il numero è una prova più
-- forte del nome.
--
-- MISURA sullo storico di NZ, tutte le righe `applied` della tabella di log,
-- con la regola scritta per intero (numero citato, oppure beneficiario che
-- conferma, oppure P.IVA in causale):
--  * nel ramo «abbinamento per data», il solo dove la regola vive, resta
--    rifiutata UNA riga, l'errore UNICOOP del 20/11. Nient'altro.
--  * gli altri due casi del ramo che a prima vista sembravano rifiutati passano,
--    e per un motivo che vale la pena scrivere: il bonifico A. & C. GROUP del
--    23/07 ha il numero di fattura in causale (primo ramo), e il bonifico
--    GABRIEL IOSUB del 25/07 ha «A FAVORE DI N.D.», cioè la banca NON ha
--    dichiarato il beneficiario. Confondere «non dichiarato» con «un altro»
--    avrebbe rotto tutti gli agganci del flusso CBI anonimo di MPS: da qui il
--    riconoscimento di N.D. dentro `beneficiario_in_causale`.
--  * i 45 cumulativi, le 17 distinte, i raggruppati e i bonifici anonimi che
--    hanno un beneficiario «diverso» per costruzione (un agente di pagamento,
--    una persona che ha anticipato di tasca propria) non passano da questo ramo
--    e non vengono toccati.
-- Quindi la regola nuova toglie l'aggancio sbagliato e non ne toglie di giusti.
--
-- NO DATA LOSS: aggiunge una funzione e riscrive un ramo del motore. Nessuna
-- riga toccata, nessun aggancio esistente disfatto.
-- =====================================================================

BEGIN;

-- Il beneficiario scritto in causale, se c'è. Testo in chiaro, al massimo 60
-- caratteri, tagliato alla prima parola che nei flussi MPS e CBI viene dopo il
-- nome. Se la causale non lo dice, torna NULL e nessuno si pronuncia. Non lo
-- dice nemmeno quando la banca scrive «A FAVORE DI N.D.» (flusso CBI anonimo di
-- MPS): lì il beneficiario manca, non è «un altro», e il motore deve poter
-- continuare con gli altri suoi criteri.
CREATE OR REPLACE FUNCTION public.beneficiario_in_causale(p_causale text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  -- In due passi, non con una regex sola: in PostgreSQL la preferenza di tutta
  -- l'espressione la decide il PRIMO quantificatore, quindi un «(?:DI[: ]*)?»
  -- davanti rende greedy anche un «.{3,60}?» che segue, e il taglio arriva
  -- troppo in là (provato: prendeva «GLOBAL BLUE ITALIA SRL CODICE MANDATO
  -- ITA145205C»). Prima si prende quello che viene dopo «A FAVORE», poi si
  -- taglia alla prima parola che nei flussi MPS e CBI viene dopo il nome.
  SELECT CASE
    WHEN n ~ '^(N\.?D\.?([^A-Z0-9]|$)|NOTPROVIDED|NOT PROVIDED|NON DISPONIBILE)' THEN NULL
    ELSE n
  END
  FROM (
    SELECT NULLIF(btrim(left(regexp_replace(
      btrim(regexp_replace(
        substring(upper(coalesce(p_causale, '')) from 'A FAVORE (.*)$'), '^DI[: ]+', '')),
      '(CODICE MANDATO|CODICE|IMPORTO|IBAN|MANDATO|SALDO FATTURA|COMMISSIONI).*$', ''), 60)), '') AS n
  ) q;
$function$;

-- Il beneficiario della causale è il fornitore della fattura?
--   * nessun beneficiario scritto  -> true, la causale non dice niente e non si
--     toglie niente a chi decideva prima;
--   * la P.IVA del fornitore in causale -> true, è la prova più forte che c'è;
--   * altrimenti vale la conferma del nome, ma SOLO sul pezzo del beneficiario,
--     non su tutta la causale: è lì che sta scritto chi ha preso i soldi.
CREATE OR REPLACE FUNCTION public.beneficiario_coerente(p_causale text, p_name text, p_vat text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  SELECT CASE
    WHEN public.beneficiario_in_causale(p_causale) IS NULL THEN true
    WHEN p_vat IS NOT NULL AND p_vat <> ''
         AND position(lower(p_vat) in lower(coalesce(p_causale, ''))) > 0 THEN true
    ELSE public.supplier_confirmed_in_text(p_name, p_vat, public.beneficiario_in_causale(p_causale))
  END;
$function$;

-- Come nella 443: PostgreSQL concede le funzioni nuove a PUBLIC, quindi anche
-- alla chiave pubblica del sito. Si revoca e si concede a chi serve.
REVOKE ALL ON FUNCTION public.beneficiario_in_causale(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.beneficiario_coerente(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.beneficiario_in_causale(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.beneficiario_coerente(text, text, text) TO authenticated, service_role;

COMMIT;

BEGIN;

-- Il ramo debole legge il beneficiario. Il testo della funzione non si
-- riscrive: si innesta nel testo vivo (vedi la nota nella 443).
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.rerun_bijective_reconciliation()'::regprocedure) INTO v_def;

  IF v_def !~ 'coppia_esclusa' THEN
    RAISE EXCEPTION 'rerun_bijective_reconciliation: qui manca la 443. Applica prima quella.';
  END IF;
  IF v_def ~ 'beneficiario_coerente' THEN
    RAISE NOTICE 'rerun_bijective_reconciliation: la regola del beneficiario c''è già, non faccio niente';
    RETURN;
  END IF;

  v_new := replace(v_def,
$o$      AND public.supplier_confirmed_in_text(
            v_pay.supplier_name, v_pay.supplier_vat,
            coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' '
            || coalesce(bt.merchant_name, '') || ' ' || coalesce(bt.statement_description, ''))$o$,
$n$      AND public.supplier_confirmed_in_text(
            v_pay.supplier_name, v_pay.supplier_vat,
            coalesce(bt.description, '') || ' ' || coalesce(bt.counterpart, '') || ' '
            || coalesce(bt.merchant_name, '') || ' ' || coalesce(bt.statement_description, ''))
      -- 444: se la causale nomina un beneficiario, quello deve essere il
      -- fornitore. Salta il controllo solo chi ha la prova più forte, il numero
      -- di questa fattura citato in causale. Nata dall'addebito Global Blue
      -- agganciato a UNICOOP Firenze perché in causale c'era la parola FIRENZE.
      AND (public.invoice_cited_in_text(coalesce(v_pay.invoice_number, ''),
                                        public.causale_per_numeri(bt.description), 2)
           OR public.beneficiario_coerente(
                coalesce(bt.statement_description, '') || ' ' || coalesce(bt.description, ''),
                v_pay.supplier_name, v_pay.supplier_vat))$n$);

  IF v_new !~ 'beneficiario_coerente' THEN
    RAISE EXCEPTION 'rerun_bijective_reconciliation: il punto di innesto non c''è, non eseguo';
  END IF;
  EXECUTE v_new;
END
$patch$;

COMMIT;

-- =====================================================================
-- Verifica (su NZ e su Zago)
-- =====================================================================
--   SELECT public.beneficiario_in_causale(
--     'PAGAMENTI DIVERSI ADDEBITO DIRETTO ADDEBITO SDD N. 619648592 A FAVORE GLOBAL BLUE ITALIA SRL CODICE MANDATO ITA145205C IMPORTO 251,22 COMMISSIONI 0,00 SPESE 0,00 145205/ 4257758 50129 FIRENZE');
--   -- atteso: GLOBAL BLUE ITALIA SRL
--
--   SELECT public.beneficiario_coerente(
--     'ADDEBITO SDD N. 619648592 A FAVORE GLOBAL BLUE ITALIA SRL CODICE MANDATO ITA145205C IMPORTO 251,22 50129 FIRENZE',
--     'UNICOOP FIRENZE SOC.COOP.A MUTUAL. PREV.ISCR.ALBO A104272(CAT.CONSUMO)', '00407780485');
--   -- atteso: false  (prima dava true per via della parola FIRENZE)
--
--   SELECT public.beneficiario_coerente(
--     'Causale: ADDEBITO DIRETTO - Descrizione: ADDEBITO SDD N. 666949407 A FAVORE TORINO FASHION VILLAGE S R L CODICE MANDATO E10.07362100484 IMPORTO 451,81',
--     'TORINO FASHION VILLAGE S.r.l.', '07362100484');
--   -- atteso: true  (l'aggancio buono del 21/11 resta buono)
--
--   SELECT public.beneficiario_coerente('BONIFICO SENZA BENEFICIARIO SCRITTO', 'QUALUNQUE SRL', '12345678901');
--   -- atteso: true  (nessun beneficiario in causale: non si pronuncia)
--
--   SELECT public.beneficiario_in_causale('BON.SEPA TELEMATICO A FAVORE DI N.D. BON. IST. A1022592175') IS NULL;
--   -- atteso: true  (flusso CBI anonimo: la banca non dichiara il beneficiario)
-- =====================================================================
