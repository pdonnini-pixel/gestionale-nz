-- =============================================================================
-- Il gate di identità confermava il fornitore sbagliato
-- Applicato su NZ + Made + Zago il 04/09/2026.
-- =============================================================================
--
-- LA DIAGNOSI, MISURATA. Al primo giro completo del cron dopo 28 giorni di fermo
-- il motore ha applicato 8 agganci: 4 giusti, 4 sbagliati. Misurando le tre vie
-- che danno identità (P.IVA o nome in causale, numero fattura citato, presenza in
-- distinta) si è visto che il numero fattura NON c'entrava: in tutti e quattro i
-- casi nessuna chiave del numero era presente nella causale. A cedere è stata
-- `supplier_confirmed_in_text`, per due difetti distinti.
--
-- 1) CERCAVA SOTTOSTRINGHE, NON PAROLE. `position(w in p_text)` trova la parola
--    anche dentro un'altra:
--
--      «RICA GEST S.R.L.»  confermata da  «...A FAVORE AMERICAN EXPRESS...»
--                                              perché «rica» sta in «ameRICAn»
--
-- 2) NON ESCLUDEVA IL LESSICO BANCARIO. Ogni causale contiene «CODICE MANDATO»,
--    «IMPORTO BONIFICI», «A FAVORE», «ADDEBITO SDD»:
--
--      «ANTICO CODICE ONLUS»  confermata da  «...CODICE MANDATO 07362100484...»
--                                              perché «codice» è una sua parola
--
--    Così una fattura di ANTICO CODICE ONLUS si è agganciata a un pagamento
--    destinato a LIGNANO BANDA LARGA.
--
-- IL RIMEDIO tiene fermo il principio (il nome del fornitore deve comparire nella
-- causale) e ne rende seria la verifica: confronto per PAROLA INTERA con confini
-- non alfanumerici, e stoplist allargata al lessico delle causali bancarie oltre
-- alle forme societarie che c'erano già.
--
-- Un nome fatto solo di parole generiche non identifica nessuno, ed è giusto che
-- non passi: per quelle posizioni serve la conferma di una persona.
--
-- I TEST (rigirati in transazione annullata, quindi senza toccare i dati)
--
--   a) I quattro agganci sbagliati: tre non vengono più applicati. Il quarto
--      (SPM INVESTIGAZIONI, 110,00) si riaggancia, ed è corretto: causale anonima
--      ma importo netto esatto, candidato unico e scadenza a undici giorni. È il
--      caso d'uso di try_match_amount_bank_transaction, non un errore.
--
--   b) 60 agganci storici sganciati e ricalcolati:
--        34 riagganciati alla STESSA fattura
--         0 riagganciati a una fattura DIVERSA   <-- il numero che conta
--        26 non riapplicati (il motore ora propone invece di decidere)
--
--   c) Confronto della vecchia e della nuova logica su tutti i 241 agganci
--      storici: 179 confermati da entrambe, 1 solo perso, 0 guadagnati.
--      L'unico perso (UNICOOP FIRENZE) aveva un'identità spuria anch'esso: la
--      causale è «a favore di n.d.», non nomina nessuno.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.supplier_confirmed_in_text(p_name text, p_vat text, p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp', 'extensions'
AS $function$
  SELECT
    (p_vat IS NOT NULL AND p_vat <> '' AND position(lower(p_vat) in lower(coalesce(p_text, ''))) > 0)
    OR EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(coalesce(p_name, '')), '[^a-z0-9]+') w
      WHERE length(w) >= 4
        AND w NOT IN (
          -- forme societarie e parole di contorno (c'erano già)
          'srl','srls','spa','snc','sas','sapa','scarl','scrl','propco','group','gruppo',
          'holding','italia','italy','italiana','societa','coop','cooperativa',
          'unipersonale','socio','unico','associati','associato','servizi','service','services',
          -- lessico delle causali bancarie: compare in QUALUNQUE movimento e
          -- perciò non può valere come conferma dell'identità del fornitore
          'codice','mandato','importo','importi','bonifico','bonifici','commissioni',
          'spese','favore','disposizione','disposizioni','banca','banco','banking',
          'carta','carte','credito','debito','diretto','diretta','addebito','addebiti',
          'pagamento','pagamenti','fattura','fatture','fatt','saldo','incasso','incassi',
          'sepa','core','flusso','filiale','ordinante','beneficiario','riferimento',
          'numero','data','scadenza','effetti','ritirati','causale','descrizione',
          'vostra','nostra','vostro','nostro','tramite','internet','corporate',
          'richiesta','totale','operazione','operazioni','conto','corrente','giroconto',
          'valuta','anticipo','rata','rate','mese','anno'
        )
        -- PAROLA INTERA: il confine impedisce che «rica» corrisponda dentro «americana».
        -- w viene da uno split su [^a-z0-9]+, quindi contiene solo a-z0-9: nessun
        -- carattere da escapare nella regex.
        AND lower(coalesce(p_text, '')) ~ ('(^|[^a-z0-9])' || w || '([^a-z0-9]|$)')
    );
$function$;

COMMENT ON FUNCTION public.supplier_confirmed_in_text(text, text, text) IS
  'Dice se la causale di un movimento conferma davvero l''identita'' del fornitore: P.IVA presente, oppure almeno una parola distintiva del nome (>= 4 lettere, non una forma societaria ne'' una parola del lessico bancario) presente COME PAROLA INTERA.';

-- --- Verifica ---------------------------------------------------------------
-- select
--   public.supplier_confirmed_in_text('ANTICO CODICE ONLUS ASSOCIAZIONE A TUTELA', null,
--     lower('ADDEBITO SDD A FAVORE LIGNANO BANDA LARGA CODICE MANDATO 07362100484')) as deve_essere_false,
--   public.supplier_confirmed_in_text('CNH INDUSTRIAL CAPITAL EUROPE', null,
--     lower('SDD Core CNH INDUSTRIAL CAPITAL EUROPE SIEN3600074641')) as deve_essere_true;
