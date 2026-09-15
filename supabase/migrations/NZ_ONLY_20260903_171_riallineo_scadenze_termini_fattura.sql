-- NZ_ONLY_20260903_171_riallineo_scadenze_termini_fattura.sql
--
-- Riallinea ai TERMINI SCRITTI IN FATTURA le scadenze NZ ancora aperte che il
-- bridge aveva generato dal piano fornitore (difetto corretto dalla 170).
-- Autorizzato da Patrizio il 03/09/2026 («pubblica e riallinea le righe aperte
-- con backup»). Solo NZ: Made e Zago non hanno righe generate dal piano.
--
-- Perimetro (una riga per fattura, mai toccate le pagate):
--   * payables con nota «Auto-generata da piano fornitore»
--   * stato non pagato/parziale/annullato/NC, amount_paid = 0, nessun movimento
--     bancario agganciato, non in chiusura provvisoria
--   * fattura con codice MP in fattura e al massimo una scadenza
--   * non presenti in distinte di pagamento ne' in distinte RI.BA
-- Cosa cambia: due_date/original_due_date = data in fattura (se presente),
-- payment_method mappato dal codice MP (variante del fornitore conservata),
-- payment_method_code/label, nota con i valori precedenti. Il trigger
-- fn_payable_auto_debit porta da solo le MP08 in addebito automatico carta.
-- Inoltre electronic_invoices.payment_method/payment_terms vengono riempiti
-- (solo dove NULL) con MP/TP letti dalla fattura.
--
-- BACKUP: public._bkp_riallineo_termini_20260903 (copia integrale delle righe
-- prima della modifica, RLS attiva, nessuna policy = solo service role).

DO $$
DECLARE v_n int; v_e int;
BEGIN
  create table if not exists public._bkp_riallineo_termini_20260903 as select * from public.payables where false;
  alter table public._bkp_riallineo_termini_20260903 enable row level security;

  create temp table _scope on commit drop as
  with inv as (
    select e.id,
      case when left(ltrim(e.xml_content),1)='{' then e.xml_content::jsonb else null end as j,
      case when left(ltrim(e.xml_content, chr(65279)||E' \t\r\n'),1)='<' then ltrim(e.xml_content, chr(65279)||E' \t\r\n') else null end as x
    from public.electronic_invoices e where e.source='api_acube_sdi' and e.invoice_date >= '2026-07-31'
  ), terms as (
    select inv.id,
      coalesce((select array_agg(f.due_date order by f.installment) from public.fn_parse_invoice_payments(inv.x) f where f.due_date is not null and f.amount is not null),
               (select array_agg(f.due_date order by f.installment) from public.fn_parse_invoice_payments_json(inv.j) f where f.due_date is not null and f.amount is not null)) as scad,
      coalesce((select array_agg(f.method order by f.installment) from public.fn_parse_invoice_payments(inv.x) f where f.method is not null),
               (select array_agg(f.method order by f.installment) from public.fn_parse_invoice_payments_json(inv.j) f where f.method is not null)) as mp,
      coalesce(public.fn_parse_invoice_condizioni(inv.x), public.fn_parse_invoice_condizioni_json(inv.j)) as tp
    from inv
  )
  select p.id, t.scad[1] as due_new, t.mp[1] as mp_new,
         public.fn_sdi_mp_to_payment_method(t.mp[1], s.default_payment_method::text) as met_new, t.tp
  from public.payables p join terms t on t.id = p.electronic_invoice_id left join public.suppliers s on s.id = p.supplier_id
  where p.notes ilike 'Auto-generata da piano fornitore%'
    and p.status not in ('pagato','annullato','nota_credito','parziale')
    and coalesce(p.amount_paid,0) = 0 and p.bank_transaction_id is null
    and coalesce(p.is_provisional_paid,false) = false
    and t.mp is not null and t.mp[1] is not null
    and coalesce(cardinality(t.scad),0) <= 1
    and (select count(*) from public.payables q where q.electronic_invoice_id = p.electronic_invoice_id) = 1
    and not exists (select 1 from public.payment_batch_items i where i.payable_id = p.id)
    and not exists (select 1 from public.riba_distinta_lines l where l.matched_payable_id = p.id or p.id = any(coalesce(l.matched_payable_ids, '{}')));

  insert into public._bkp_riallineo_termini_20260903 select p.* from public.payables p where p.id in (select id from _scope);
  get diagnostics v_n = row_count;

  update public.payables p set
    due_date = coalesce(s.due_new, p.due_date),
    original_due_date = coalesce(s.due_new, p.original_due_date),
    payment_method = s.met_new,
    payment_method_code = s.mp_new,
    payment_method_label = public.fn_sdi_mp_label(s.mp_new),
    notes = coalesce(p.notes,'') || ' | riallineata ai termini in fattura il 03/09/2026 (dal piano: ' || p.due_date::text || ' ' || p.payment_method::text || ')',
    updated_at = now()
  from _scope s where p.id = s.id;

  update public.electronic_invoices e set
    payment_method = coalesce(e.payment_method, x.mp),
    payment_terms = coalesce(e.payment_terms, x.tp)
  from (
    select e2.id,
      coalesce((select f.method from public.fn_parse_invoice_payments(case when left(ltrim(e2.xml_content, chr(65279)||E' \t\r\n'),1)='<' then ltrim(e2.xml_content, chr(65279)||E' \t\r\n') end) f where f.method is not null order by f.installment limit 1),
               (select f.method from public.fn_parse_invoice_payments_json(case when left(ltrim(e2.xml_content),1)='{' then e2.xml_content::jsonb end) f where f.method is not null order by f.installment limit 1)) as mp,
      coalesce(public.fn_parse_invoice_condizioni(case when left(ltrim(e2.xml_content, chr(65279)||E' \t\r\n'),1)='<' then ltrim(e2.xml_content, chr(65279)||E' \t\r\n') end),
               public.fn_parse_invoice_condizioni_json(case when left(ltrim(e2.xml_content),1)='{' then e2.xml_content::jsonb end)) as tp
    from public.electronic_invoices e2 where e2.source='api_acube_sdi' and e2.invoice_date >= '2026-07-31' and (e2.payment_method is null or e2.payment_terms is null)
  ) x where x.id = e.id and (x.mp is not null or x.tp is not null);
  get diagnostics v_e = row_count;

  RAISE NOTICE 'backup+update payables: %, electronic_invoices aggiornate: %', v_n, v_e;
END $$;
