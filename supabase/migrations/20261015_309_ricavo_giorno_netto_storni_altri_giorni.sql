-- =====================================================================
-- 309 — Ricavo del giorno: si tolgono annulli e resi di scontrini di ALTRI giorni
-- =====================================================================
-- Caso: Torino, 16/09/2026. Lo scontrino di chiusura RT riporta vendite
-- 85,90, annulli 261,50 e corrispettivo trasmesso -175,60 (si e' annullato
-- uno scontrino di un altro giorno). Cassa e POS quadravano sulle vendite,
-- quindi la cassiera ha scritto 85,90 e nessun controllo si e' acceso: il
-- gestionale ha contato 85,90 di ricavo, lo studio (che legge i dati
-- trasmessi all'Agenzia) -175,60. Torino di settembre gonfiato di 261,50.
--
-- La 175/202 coprono gia' l'annullo pagato in contanti (ammanco = annulli,
-- avviso in pagina). Restava il caso in cui i soldi tornano ma il
-- corrispettivo no.
--
-- REGOLA: dalla foto della chiusura RT il lettore ora legge anche il
-- corrispettivo trasmesso (`fiscal_total`, edge function closing-photo-extract).
-- Si tolgono dal ricavo del giorno gli storni di altri giorni quando la foto
-- lo dimostra da sola:
--   * foto letta e non incerta, con fiscal_total;
--   * totale scritto in chiusura > fiscal_total;
--   * la differenza e' ESATTAMENTE annulli + resi stampati sulla stessa foto.
-- Gli annulli di scontrini rifatti nello stesso giorno (Franciacorta, quasi
-- ogni giorno) non cambiano niente: li' il corrispettivo coincide col totale.
-- Nessuna domanda all'operatrice: il dato e' sul documento (regola «niente
-- liste da compilare a mano»).
--
-- COSA INTRODUCE:
--   * storni_altri_giorni_da_foto(closing_id): l'importo da togliere (0 se la
--     foto non lo dimostra);
--   * project_cash_closing_to_daily_revenue: ricavo = corrispettivi +
--     fatture - storni di altri giorni, con traccia nelle note;
--   * trigger su outlet_daily_closing_attachments: se la foto del totale
--     viene letta (o riletta) dopo la conferma, il ricavo si riproietta.
-- Additiva, nessun dato cancellato. REGOLA #0: NZ -> Made -> Zago.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.storni_altri_giorni_da_foto(p_closing_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_total   numeric;
  v_fiscal  numeric;
  v_storni  numeric;
  v_diff    numeric;
BEGIN
  SELECT COALESCE(c.total_receipts, 0) INTO v_total
  FROM public.outlet_daily_closings c WHERE c.id = p_closing_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- ultima foto del totale letta, non incerta, con il corrispettivo trasmesso
  SELECT (a.extracted->>'fiscal_total')::numeric,
         COALESCE((a.extracted->>'cancellations_total')::numeric, 0)
           + COALESCE((a.extracted->>'returns_total')::numeric, 0)
    INTO v_fiscal, v_storni
  FROM public.outlet_daily_closing_attachments a
  WHERE a.closing_id = p_closing_id
    AND a.target = 'totale'
    AND a.extraction_status IN ('letta', 'da_rivedere')
    AND COALESCE((a.extracted->>'uncertain')::boolean, false) = false
    AND jsonb_typeof(a.extracted->'fiscal_total') = 'number'
  ORDER BY a.extracted_at DESC NULLS LAST, a.uploaded_at DESC
  LIMIT 1;

  IF v_fiscal IS NULL THEN RETURN 0; END IF;
  v_diff := round(v_total - v_fiscal, 2);
  IF v_diff <= 0.005 THEN RETURN 0; END IF;
  -- la differenza deve essere spiegata per intero da annulli e resi della foto
  IF abs(v_diff - v_storni) >= 0.01 THEN RETURN 0; END IF;
  RETURN v_diff;
END;
$$;

COMMENT ON FUNCTION public.storni_altri_giorni_da_foto(uuid) IS
  'Annulli/resi di scontrini di altri giorni da togliere dal ricavo della chiusura: totale scritto - corrispettivo trasmesso (foto RT), solo se la differenza coincide con annulli + resi stampati.';

CREATE OR REPLACE FUNCTION public.project_cash_closing_to_daily_revenue(p_closing_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c        public.outlet_daily_closings%ROWTYPE;
  v_cash   numeric(14,2) := 0;
  v_card   numeric(14,2) := 0;
  v_other  numeric(14,2) := 0;
  v_gross  numeric(14,2) := 0;
  v_storni numeric(14,2) := 0;
  v_vat    numeric := 22;
BEGIN
  SELECT * INTO c FROM public.outlet_daily_closings WHERE id = p_closing_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN ch.kind = 'contanti' THEN l.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ch.kind IN ('pos', 'pos_amex') THEN l.amount ELSE 0 END), 0)
  INTO v_cash, v_card
  FROM public.outlet_daily_closing_lines l
  JOIN public.outlet_payment_channels ch ON ch.id = l.channel_id
  WHERE l.closing_id = c.id;

  -- annulli/resi di scontrini di altri giorni: tolgono corrispettivo, non soldi
  v_storni := public.storni_altri_giorni_da_foto(c.id);

  -- ricavo del giorno = corrispettivi + fatture emesse in negozio - storni di altri giorni
  v_gross := COALESCE(c.total_receipts, 0) + COALESCE(c.invoices_total, 0) - v_storni;
  v_other := GREATEST(v_gross - v_cash - v_card, 0);

  v_vat := COALESCE(
    (SELECT s.budget_vat_rate FROM public.daily_report_settings s WHERE s.company_id = c.company_id),
    (SELECT NULLIF(co.settings->>'cash_closing_vat_rate', '')::numeric FROM public.companies co WHERE co.id = c.company_id),
    22);

  INSERT INTO public.daily_revenue AS dr
    (company_id, outlet_id, date, gross_revenue, net_revenue, transactions_count,
     avg_ticket, cash_amount, card_amount, other_amount, source, notes)
  VALUES
    (c.company_id, c.outlet_id, c.closing_date, v_gross,
     ROUND(v_gross / (1 + v_vat / 100), 2), 0, 0,
     v_cash, v_card, v_other, 'manuale'::import_source,
     'Chiusura cassa ' || c.id::text
       || CASE WHEN v_storni > 0
               THEN ' - tolti ' || to_char(v_storni, 'FM999G990D00') || ' di annulli/resi di altri giorni (corrispettivo RT)'
               ELSE '' END)
  ON CONFLICT (company_id, outlet_id, date) DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    net_revenue   = EXCLUDED.net_revenue,
    cash_amount   = EXCLUDED.cash_amount,
    card_amount   = EXCLUDED.card_amount,
    other_amount  = EXCLUDED.other_amount,
    source        = EXCLUDED.source,
    notes         = EXCLUDED.notes;
END;
$function$;

-- La foto del totale letta dopo la conferma riproietta il ricavo.
CREATE OR REPLACE FUNCTION public.fn_cash_closing_attachment_reproject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.target = 'totale' AND NEW.closing_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.outlet_daily_closings c
                  WHERE c.id = NEW.closing_id
                    AND c.status IN ('confermata', 'verificata')
                    AND NOT c.is_closed_day) THEN
    PERFORM public.project_cash_closing_to_daily_revenue(NEW.closing_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_cash_closing_attachment_reproject
  AFTER INSERT OR UPDATE OF extracted ON public.outlet_daily_closing_attachments
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_closing_attachment_reproject();

COMMIT;

-- ── Verifica ────────────────────────────────────────────────────────────
-- Nessuna giornata cambia finche' una foto non porta fiscal_total:
-- SELECT count(*) FROM public.outlet_daily_closings c
--  WHERE public.storni_altri_giorni_da_foto(c.id) > 0;      -- 0 subito dopo la 309
