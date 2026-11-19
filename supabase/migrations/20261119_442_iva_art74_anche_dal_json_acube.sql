-- =====================================================================
-- 442 — IVA art. 74 non detraibile letta anche dal JSON di A-Cube
-- =====================================================================
-- Caso verificato il 19/11/2026 su Zago contro il «Dettaglio liquidazione
-- IVA» dello Studio Poli (registro acquisti, settembre e ottobre 2026).
--
-- La 308 ha introdotto electronic_invoices.vat_non_detraibile, colonna
-- generata da iva_art74_da_xml(xml_content): somma l'imposta dei riepiloghi
-- con RiferimentoNormativo «art. 74» (telefonia prepagata, IVA gia' versata
-- dall'operatore). La funzione legge solo l'XML FatturaPA. Ma le fatture
-- scaricate da A-Cube hanno in xml_content il JSON della fattura
-- (fattura_elettronica_body[].dati_beni_servizi.dati_riepilogo[], campi
-- riferimento_normativo e imposta): li' la funzione dava sempre 0.
--   Zago: tutte le 493 fatture 2026 sono JSON (caricate il 17/11/2026),
--   10 con art. 74 (Wind Tre 22,86-23,30, Fastweb 8,80), tutte a 0.
--   Wind Tre 2026F001267117 del 21/09: IVA 55,42, lo studio detrae 32,12
--   (23,30 art. 74). Fastweb AS03018339 del 14/10: IVA 9,35, lo studio
--   detrae 0,55 (8,80 art. 74).
--   NZ: 365 fatture JSON su 1.742, 2 con art. 74 (Wind Tre 2026F000925019
--   del 21/07, 40,89; Fastweb AS02271610 del 06/08, 33,00), tutte e due di
--   competenza agosto 2026: la vista di agosto scende di 73,89. Agosto NZ e'
--   confermato a mano in vat_settlements: la pagina non cambia.
--
-- Riconciliazione Zago con questa correzione (registro acquisti dello studio):
--   ottobre 18.821,75 - 8,80 (art. 74) - 16,92 (nota Tanesini 5/349 del
--   29/09) + 20,90 (Humatics 26103016 del 30/09) = 18.816,93, uguale.
--   settembre 19.778,24 - 23,30 (art. 74) + 4.309,08 (tre GGZ del 31/08)
--   + 16,92 - 20,90 = 24.060,04, uguale.
--   Le altre differenze sono di competenza (fatture di fine mese registrate
--   nel mese dopo): su NZ le sposta la data di ricezione SDI (221/222/223),
--   su Zago acube_sdi_invoices e' vuota e sdi_id non c'e', quindi restano
--   nel mese della data fattura. Non e' un difetto della vista: manca il
--   dato, e questa migration non lo tocca.
--
-- COSA CAMBIA: iva_art74_da_xml riconosce il JSON (testo che comincia con
-- «{» o «[») e lo legge con jsonb_path; un JSON non valido o un'imposta non
-- numerica danno 0, mai un errore (la colonna e' generata: un errore
-- bloccherebbe l'inserimento della fattura). Il ramo XML e' lo stesso della
-- 308. Poi SET EXPRESSION (PostgreSQL 17) riscrive la colonna generata con
-- la stessa espressione, cosi' le righe gia' presenti si ricalcolano: solo
-- vat_non_detraibile cambia, nessun trigger, updated_at fermo.
-- vat_amount NON cambia. La vista non si tocca.
-- REGOLA #0: NZ -> Zago (Made escluso).
-- =====================================================================
BEGIN;

-- la SET EXPRESSION riscrive la tabella con un lock esclusivo: se un sync
-- delle fatture la tiene occupata, meglio fallire e riprovare che attendere
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.iva_art74_da_xml(p_xml text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $f$
DECLARE
  v numeric;
BEGIN
  IF p_xml IS NULL OR p_xml !~* 'art\.?\s*74' THEN
    RETURN 0;
  END IF;

  -- JSON di A-Cube
  IF p_xml ~ '^\s*[{\[]' THEN
    BEGIN
      SELECT COALESCE(round(sum((x #>> '{}')::numeric), 2), 0) INTO v
      FROM jsonb_path_query(
             p_xml::jsonb,
             'lax $.fattura_elettronica_body.dati_beni_servizi.dati_riepilogo ? (@.riferimento_normativo like_regex "art\\.?\\s*74" flag "i").imposta'
           ) AS x;
      RETURN v;
    EXCEPTION WHEN others THEN
      RETURN 0;
    END;
  END IF;

  -- XML FatturaPA (come nella 308)
  SELECT COALESCE(round(sum(
           substring(r.part FROM '<(?:\w+:)?Imposta>\s*(-?[0-9]+(?:\.[0-9]+)?)\s*<')::numeric
         ), 2), 0) INTO v
  FROM (
    SELECT regexp_replace(ch, '^.*<(\w+:)?DatiRiepilogo[^>]*>', '') AS part
    FROM regexp_split_to_table(p_xml, '</(\w+:)?DatiRiepilogo>') AS ch
    WHERE ch ~ '<(\w+:)?DatiRiepilogo'
  ) r
  WHERE r.part ~* 'RiferimentoNormativo>[^<]*art\.?\s*74';
  RETURN v;
END
$f$;

COMMENT ON FUNCTION public.iva_art74_da_xml(text) IS
  'IVA dei riepiloghi con riferimento normativo art. 74 (IVA assolta a monte dall''operatore, es. telefonia prepagata): esposta in fattura ma non detraibile. Legge l''XML FatturaPA e il JSON di A-Cube (migration 442).';

-- ricalcola la colonna generata sulle righe gia' presenti
ALTER TABLE public.electronic_invoices
  ALTER COLUMN vat_non_detraibile SET EXPRESSION AS (public.iva_art74_da_xml(xml_content));

COMMIT;

-- ── Verifica ────────────────────────────────────────────────────────────
-- Zago: 10 fatture con vat_non_detraibile > 0; settembre 2026
-- iva_fatture_passive 25.311,72, ottobre 22.133,51.
-- NZ: 10 fatture con vat_non_detraibile > 0 (8 XML + 2 JSON); cambia solo
-- agosto 2026 (iva_fatture_passive da 55.848,16 a 55.774,27).
-- SELECT count(*) FILTER (WHERE vat_non_detraibile > 0) FROM public.electronic_invoices;
-- SELECT year, month, iva_fatture_passive, iva_note_credito
--   FROM public.v_iva_componenti_mensili WHERE year = 2026 ORDER BY month;
