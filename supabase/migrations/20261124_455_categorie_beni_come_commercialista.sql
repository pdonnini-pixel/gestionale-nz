-- 455 (NZ e Zago) — categorie dei beni ammortizzabili come il commercialista (24/11/2026)
-- Patrizio, 24/11/2026, su proposta di Lilian: «crea le categorie dei beni come il commercialista».
-- Sei categorie, una per conto dello Studio, al posto dell'unica «Allestimenti e aperture»:
--   BENI_OPERE_TERZI       031301   Opere e migliorie su beni di terzi
--   BENI_ATTREZZATURE      050503   Attrezzature commerciali
--   BENI_MOBILI            05070101 Mobili e arredi
--   BENI_MACCHINE_UFFICIO  05070301 Macchine d'ufficio elettroniche
--   BENI_SOFTWARE          030507   Software
--   BENI_PICCOLI           610145   Beni ammortizzabili sotto 516,46 euro
-- «Allestimenti e aperture» resta, per i costi di apertura di un negozio.
-- Le nuove categorie si comportano come ALLESTIMENTI dove il sistema la riconosce per codice,
-- così i costi non cambiano negozio:
--   * fn_riparto_automatico: i codici BENI_* valgono come ALLESTIMENTI (fuori dalla sede e dalle parti uguali);
--   * v_costi_outlet_da_fatture: gruppo «allestimenti» anche per BENI_*.
-- Le due definizioni si modificano partendo da quella viva, con un controllo che il testo atteso
-- compaia una volta sola (come la 415). Idempotente. Rollback a fianco.

INSERT INTO public.cost_categories (company_id, code, name, macro_group, ce_account_code, is_active, is_fixed,
                                    is_recurring, is_system, auto_debit_card, color, sort_order, notes)
SELECT a.company_id, x.code, x.name, a.macro_group, x.conto, true, a.is_fixed,
       a.is_recurring, false, a.auto_debit_card, a.color, a.sort_order,
       'Conto del commercialista ' || x.conto || ' (24/11/2026, categorie dei beni come lo Studio).'
  FROM public.cost_categories a
 CROSS JOIN (VALUES
   ('BENI_OPERE_TERZI',      'Opere e migliorie su beni di terzi',  '031301'),
   ('BENI_ATTREZZATURE',     'Attrezzature commerciali',            '050503'),
   ('BENI_MOBILI',           'Mobili e arredi',                     '05070101'),
   ('BENI_MACCHINE_UFFICIO', 'Macchine d''ufficio elettroniche',    '05070301'),
   ('BENI_SOFTWARE',         'Software',                            '030507'),
   ('BENI_PICCOLI',          'Beni ammortizzabili sotto 516,46 €',  '610145')) x(code, name, conto)
 WHERE a.code = 'ALLESTIMENTI'
ON CONFLICT (company_id, code) DO NOTHING;

-- riparto: i BENI_* valgono come ALLESTIMENTI
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.fn_riparto_automatico(uuid, boolean)'::regprocedure);
  a text := 'cat.code AS cat_code,';
  b text := 'CASE WHEN cat.code LIKE ''BENI\_%'' THEN ''ALLESTIMENTI'' ELSE cat.code END AS cat_code, /* 455 */';
BEGIN
  IF position('/* 455 */' IN v_def) > 0 THEN
    RAISE NOTICE '455: fn_riparto_automatico già aggiornata';
  ELSIF (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION '455: fn_riparto_automatico non è quella attesa, nessuna modifica';
  ELSE
    EXECUTE replace(v_def, a, b);
  END IF;
END $$;

-- costi per negozio: gruppo «allestimenti» anche per i BENI_*
DO $$
DECLARE
  v_def text := pg_get_viewdef('public.v_costi_outlet_da_fatture'::regclass);
  a text := 'WHEN (c.code = ''ALLESTIMENTI''::text) THEN';
  b text := 'WHEN ((c.code = ''ALLESTIMENTI''::text) OR (c.code ~~ ''BENI\_%''::text)) THEN';
BEGIN
  IF position(b IN v_def) > 0 THEN
    RAISE NOTICE '455: v_costi_outlet_da_fatture già aggiornata';
  ELSIF position(a IN v_def) = 0 THEN
    RAISE EXCEPTION '455: v_costi_outlet_da_fatture non è quella attesa, nessuna modifica';
  ELSE
    EXECUTE 'CREATE OR REPLACE VIEW public.v_costi_outlet_da_fatture WITH (security_invoker = on) AS '
            || replace(v_def, a, b);
  END IF;
END $$;
ALTER VIEW public.v_costi_outlet_da_fatture SET (security_invoker = on);
