-- 20260910_213 — Se la fattura non dice come si paga lo dice la CATEGORIA, e la banca non e' un'anomalia
--
-- PERCHE' (Patrizio, 10/09/2026): «se ci sono fatture senza specifica devo collegarli alla
-- categoria che puo' far capire che modalita' di pagamento ha, poi la banca di pagamento
-- che cazzo me ne frega se non c'e'».
--
-- (A) LA CATEGORIA PORTA IL METODO. `cost_categories` aveva solo il flag `auto_debit_card`,
--     che marcava la spesa come «va a carta» ma non diceva niente al fornitore. Ora la
--     categoria ha un `default_payment_method`: quando la fattura non dichiara il codice MP
--     (due volte su tre) il profilo prende il metodo da li'. Le tre categorie gia' marcate
--     a carta (Viaggi, mezzi e carburante, Acquisti on line) nascono con 'carta_credito';
--     le altre restano vuote e si impostano dal pannello «Gestisci categorie».
--     Dedurre il metodo dallo STORICO delle scadenze non funzionava: e' inquinato dal
--     vecchio default d'ufficio, con «bonifico» prevalente in 22 categorie su 23.
--
-- (B) LA BANCA NON E' PIU' UN'ANOMALIA. `fn_supplier_config_anomaly` apriva «banca di
--     pagamento mancante» per Ri.Ba., RID, SDD e carte. Ma quel conto non entra in nessun
--     calcolo: non nel cash flow, non nel saldo impegnato. E' solo un default per la
--     scadenza e un bonus di dieci punti nel matching bancario. Erano 11 righe rosse per un
--     dato che nessuna fattura contiene e nessun conto usa. Il campo resta, compilabile a
--     mano quando serve; sparisce la segnalazione.
--
-- Esito NZ: anomalie aperte da 11 a 0.

ALTER TABLE public.cost_categories
  ADD COLUMN IF NOT EXISTS default_payment_method public.payment_method;

COMMENT ON COLUMN public.cost_categories.default_payment_method IS
  'Modalita con cui si pagano di norma le spese di questa categoria. Usata quando la fattura non dichiara il codice MP: il fornitore nuovo nasce con questo metodo invece del bonifico d''ufficio.';

UPDATE public.cost_categories
   SET default_payment_method = 'carta_credito'::public.payment_method
 WHERE coalesce(auto_debit_card, false) = true
   AND default_payment_method IS NULL;

CREATE OR REPLACE FUNCTION public.fn_supplier_config_anomaly(p_supplier_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
DECLARE
  s public.suppliers%ROWTYPE; v_method text; v_is_riba boolean;
BEGIN
  SELECT * INTO s FROM public.suppliers WHERE id = p_supplier_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_method := COALESCE(s.default_payment_method::text, s.payment_method, '');
  IF v_method = '' THEN RETURN 'metodo_mancante'; END IF;
  v_is_riba := v_method LIKE 'riba%';
  -- La banca di addebito non e' piu' un requisito (fix 213): non entra in nessun calcolo,
  -- e' solo un default per la scadenza. Il campo resta, la segnalazione no.
  IF v_is_riba AND (s.payment_base IS NULL OR s.prima_scadenza_gg IS NULL OR s.numero_rate IS NULL) THEN
    RETURN 'piano_incompleto'; END IF;
  RETURN NULL;
END; $function$;

COMMENT ON FUNCTION public.fn_supplier_config_anomaly(uuid) IS
  'Anomalie di configurazione del fornitore: metodo mancante e piano Ri.Ba. incompleto. Dal fix 213 la banca di addebito non e'' piu'' richiesta: non entra in nessun calcolo di cassa.';

UPDATE public.payment_import_anomalies
   SET stato = 'risolta'
 WHERE stato = 'aperta' AND anomaly_type = 'banca_mancante';
