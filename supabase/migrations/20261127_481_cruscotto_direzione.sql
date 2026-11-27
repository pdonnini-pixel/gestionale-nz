-- 481 — Cruscotto direzione: tutti i numeri della nuova Dashboard in una chiamata
--
-- Patrizio, 27/11/2026: la Dashboard viene sostituita dal «cruscotto direzione» (mockup approvato
-- nella sessione del 26-27/11). La pagina chiede una volta sola i dati dell'anno scelto e fa i conti
-- nel browser (src/lib/cruscotto.ts). Qui solo letture aggregate, niente scritture.
--
-- SECURITY INVOKER: gira con i permessi di chi apre la pagina, quindi valgono le RLS di ogni tabella
-- (un profilo che non legge i fornitori riceve lo scaduto vuoto, non i dati di altri). Filtro esplicito
-- sull'azienda di chi chiama, come nelle altre letture.
--
-- Contenuto (anno p_anno e, per i confronti, p_anno - 1):
--   negozi      outlets (codice, nome, centro di costo, tipo, apertura, chiusura)
--   ricavi      daily_revenue netto e lordo per negozio e mese, anno e anno prima; ultimo giorno caricato
--   budget      budget_confronto rev_monthly per centro di costo e mese
--   moda        outlet_traffic_hourly per negozio, anno e mese (ingressi, scontrini, vendite, costo, listino)
--   personale   v_personnel_gross_cost per negozio e mese (costo lordo dipendenti, amministratori)
--   costi       v_costi_outlet_da_fatture per centro di costo, mese e gruppo, personale escluso
--   liquidita   bank_accounts attivi
--   scaduto     fatture fornitori aperte per fascia di scadenza, con la STESSA regola dello Scadenzario
--               (calculatePayableStatus in src/pages/scadenzario/helpers.ts): fuori le chiuse in via
--               provvisoria, gli stati pagato / nota_credito / sospeso / rimandato / annullato / parziale,
--               le pagate (payment_date) e gli addebiti automatici. Chi cambia l'una cambia l'altra.
--               Giorni contati in ora di Roma.
--
-- Applicata su NZ → Zago (Made fuori dal 03/11/2026). Niente di distruttivo.
-- Rollback: 20261127_481_cruscotto_direzione_ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.cruscotto_direzione(p_anno integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH az AS (SELECT (SELECT public.get_my_company_id()) AS cid, (now() AT TIME ZONE 'Europe/Rome')::date AS oggi),
pay AS (
  SELECT v.supplier_id, v.supplier_name, v.due_date, v.amount_remaining
  FROM public.v_payables_operative v
  JOIN public.payables pa ON pa.id = v.id
  JOIN az ON pa.company_id = az.cid
  WHERE NOT coalesce(pa.is_provisional_paid, false)
    AND coalesce(v.status::text, '') NOT IN ('pagato', 'nota_credito', 'sospeso', 'rimandato', 'annullato', 'parziale')
    AND pa.payment_date IS NULL
    AND NOT coalesce(pa.is_auto_debit, false)
    AND coalesce(v.amount_remaining, 0) > 0
)
SELECT jsonb_build_object(
  'anno', p_anno,
  'oggi', (SELECT oggi FROM az),
  'negozi', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'name', o.name, 'cc', o.cost_center_key,
             'tipo', o.outlet_type, 'attivo', o.is_active, 'apertura', o.opening_date, 'chiusura', o.closing_date) ORDER BY o.name)
    FROM public.outlets o, az WHERE o.company_id = az.cid), '[]'::jsonb),
  'ricavi', coalesce((
    SELECT jsonb_agg(jsonb_build_object('o', x.outlet_id, 'y', x.y, 'm', x.m, 'netto', x.netto, 'lordo', x.lordo, 'ultimo', x.ultimo))
    FROM (SELECT d.outlet_id, extract(year FROM d.date)::int y, extract(month FROM d.date)::int m,
                 round(sum(d.net_revenue), 2) netto, round(sum(d.gross_revenue), 2) lordo, max(d.date) ultimo
          FROM public.daily_revenue d, az
          WHERE d.company_id = az.cid AND d.date >= make_date(p_anno - 1, 1, 1) AND d.date < make_date(p_anno + 1, 1, 1)
          GROUP BY 1, 2, 3) x), '[]'::jsonb),
  'budget', coalesce((
    SELECT jsonb_agg(jsonb_build_object('cc', x.cost_center, 'm', x.month, 'v', x.v))
    FROM (SELECT b.cost_center, b.month, round(sum(b.amount), 2) v
          FROM public.budget_confronto b, az
          WHERE b.company_id = az.cid AND b.year = p_anno AND b.entry_type = 'rev_monthly' AND b.month BETWEEN 1 AND 12
          GROUP BY 1, 2) x), '[]'::jsonb),
  'moda', coalesce((
    SELECT jsonb_agg(jsonb_build_object('o', x.outlet_id, 'y', x.y, 'm', x.m, 'ingressi', x.ingressi, 'scontrini', x.scontrini,
             'vendite', x.vendite, 'costo', x.costo, 'listino', x.listino))
    FROM (SELECT t.outlet_id, extract(year FROM t.data)::int y, extract(month FROM t.data)::int m,
                 sum(t.ingressi) ingressi, sum(t.scontrini) scontrini, round(sum(t.vendite), 2) vendite,
                 round(sum(t.costo_acquisto), 2) costo, round(sum(t.valore_teorico), 2) listino
          FROM public.outlet_traffic_hourly t, az
          WHERE t.company_id = az.cid AND t.data >= make_date(p_anno - 1, 1, 1) AND t.data < make_date(p_anno + 1, 1, 1)
          GROUP BY 1, 2, 3) x), '[]'::jsonb),
  'personale', coalesce((
    SELECT jsonb_agg(jsonb_build_object('o', x.outlet_id, 'f', x.filiale_code, 'm', x.month, 'costo', x.costo, 'amm', x.amm, 'dip', x.dip))
    FROM (SELECT g.outlet_id, g.filiale_code, g.month, round(sum(g.costo_lordo_outlet), 2) costo,
                 round(sum(g.amministratori_totale), 2) amm, sum(g.numero_dipendenti) dip
          FROM public.v_personnel_gross_cost g, az
          WHERE g.company_id = az.cid AND g.year = p_anno
          GROUP BY 1, 2, 3) x), '[]'::jsonb),
  'costi', coalesce((
    SELECT jsonb_agg(jsonb_build_object('cc', x.cost_center_key, 'o', x.outlet_id, 'm', x.mese, 'g', x.gruppo, 'v', x.v))
    FROM (SELECT c.cost_center_key, c.outlet_id, c.mese, c.gruppo, round(sum(c.importo), 2) v
          FROM public.v_costi_outlet_da_fatture c, az
          WHERE c.company_id = az.cid AND c.anno = p_anno AND c.gruppo NOT IN ('personale', 'amministratori')
          GROUP BY 1, 2, 3, 4) x), '[]'::jsonb),
  'liquidita', (
    SELECT jsonb_build_object('saldo', round(coalesce(sum(b.current_balance), 0), 2), 'conti', count(*), 'aggiornato', max(b.balance_updated_at))
    FROM public.bank_accounts b, az WHERE b.company_id = az.cid AND b.is_active),
  'scaduto', (
    SELECT jsonb_build_object(
      'oltre30', round(coalesce(sum(p.amount_remaining) FILTER (WHERE p.due_date < az.oggi - 30), 0), 2),
      'ultimi30', round(coalesce(sum(p.amount_remaining) FILTER (WHERE p.due_date < az.oggi AND p.due_date >= az.oggi - 30), 0), 2),
      'entro30', round(coalesce(sum(p.amount_remaining) FILTER (WHERE p.due_date >= az.oggi AND p.due_date <= az.oggi + 30), 0), 2),
      'da31a60', round(coalesce(sum(p.amount_remaining) FILTER (WHERE p.due_date > az.oggi + 30 AND p.due_date <= az.oggi + 60), 0), 2),
      'oltre60', round(coalesce(sum(p.amount_remaining) FILTER (WHERE p.due_date > az.oggi + 60), 0), 2),
      'fatture_scadute', count(*) FILTER (WHERE p.due_date < az.oggi),
      'primo_fornitore', (
        SELECT jsonb_build_object('nome', f.nome, 'importo', f.importo, 'fatture', f.n, 'dal', f.dal)
        FROM (SELECT coalesce(s.ragione_sociale, s.name, q.supplier_name, 'Senza nome') nome,
                     round(sum(q.amount_remaining), 2) importo, count(*) n, min(q.due_date) dal
              FROM pay q LEFT JOIN public.suppliers s ON s.id = q.supplier_id, az a2
              WHERE q.due_date < a2.oggi
              GROUP BY 1 ORDER BY sum(q.amount_remaining) DESC LIMIT 1) f))
    FROM pay p, az)
);
$$;

COMMENT ON FUNCTION public.cruscotto_direzione(integer) IS
  'Dati della Dashboard (cruscotto direzione) per l''anno scelto e l''anno prima: ricavi, budget ricavi, MODA, personale, costi dalle fatture, liquidità, scaduto fornitori con la regola dello Scadenzario. SECURITY INVOKER: valgono le RLS. Migration 481.';

REVOKE ALL ON FUNCTION public.cruscotto_direzione(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cruscotto_direzione(integer) TO authenticated, service_role;
