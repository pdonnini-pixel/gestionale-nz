-- 20260715_098_NZ_ONLY_supplier_payment_block1.sql
--
-- ⚠️⚠️ SOLO NEW ZAGO (NZ) — NON applicare a Made / Zago ⚠️⚠️
-- Sono DATI specifici dei fornitori di New Zago (file scadenze di Sabrina).
-- La parità-tenant (Regola #0) vale per codice/schema, NON per questi valori-dato.
--
-- BLOCCO 1: imposta modalità di pagamento + piano scadenze su 45 fornitori
-- agganciati per RAGIONE SOCIALE ESATTA (dal pre-check verificato).
--
-- Regole applicate:
--   * Base = 'fine_mese' per tutti (bonifico / Ri.Ba. / bollettino), anche dove
--     il file diceva "DF" (= data fattura fine mese).
--   * ECCEZIONE: ADD (addebito permanente) = 'data_fattura' (data automatica da
--     fattura), mappato su metodo 'rid', con banca (obbligatoria).
--   * Banca assegnata SOLO a Ri.Ba. e ADD (per bonifico la banca NON è certa).
--   * Già pagate (bancomat / carta prepagata) = metodo 'carta_debito', base
--     'data_fattura' a vista (0 gg, 1 rata), con la banca della carta -> restano
--     fuori dagli avvisi. (contanti non presenti in questo blocco)
--
-- SICUREZZA (Regola granitica no-data-loss):
--   * Crea PRIMA una tabella di BACKUP con i valori attuali delle righe toccate
--     (suppliers_payment_backup_block1_20260715) -> rollback sempre possibile.
--   * Solo UPDATE dei 6 campi piano pagamento, nessuna cancellazione.
--   * Tutto in un'unica transazione.
--
-- Banche NZ (bank_accounts):
--   MPS    = e351d628-a150-4769-b965-9514deab48a3
--   BCC    = e3e82fb2-2661-4525-a25e-8960fc1123dc
--   Intesa = 549a983d-3fe1-4f9a-aed8-d5d5ed14f123  (non usata qui: righe Intesa = bonifico)

BEGIN;

-- 1) Mappa nome_esatto -> configurazione
CREATE TEMP TABLE _b1(nome text, metodo text, base text, prima int, rate int, banca uuid) ON COMMIT DROP;
INSERT INTO _b1(nome, metodo, base, prima, rate, banca) VALUES
  -- ── RI.BA (MPS, fine mese) ─────────────────────────────────────
  ('GRUPPO FB SRL','riba_60','fine_mese',60,3,'e351d628-a150-4769-b965-9514deab48a3'),
  ('MIAN SRL','riba_60','fine_mese',60,3,'e351d628-a150-4769-b965-9514deab48a3'),
  ('SHINE SRL','riba_60','fine_mese',60,3,'e351d628-a150-4769-b965-9514deab48a3'),
  ('S.B.A. srl','riba_60','fine_mese',60,2,'e351d628-a150-4769-b965-9514deab48a3'),
  ('TANESINI S.R.L.','riba_60','fine_mese',60,2,'e351d628-a150-4769-b965-9514deab48a3'),
  ('faliero grafica snc','riba_60','fine_mese',60,2,'e351d628-a150-4769-b965-9514deab48a3'),
  ('GLADIOTEX IDEAZIONI SRL','riba_60','fine_mese',60,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('S.R.T. S.R.L.','riba_60','fine_mese',60,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('HUMATICS S.r.l. - Società Unipersonale','riba_30','fine_mese',30,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('EGO COMMUNICATION SRL','riba_30','fine_mese',30,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('REALCART S.R.L. UNIPERSONALE','riba_90','fine_mese',90,1,'e351d628-a150-4769-b965-9514deab48a3'),

  -- ── ADD -> rid (data fattura, con banca) ───────────────────────
  ('HERA COMM S.p.A.','rid','data_fattura',20,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('ENEGAN SPA','rid','data_fattura',20,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('Enel Energia S.p.A.','rid','data_fattura',15,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('BMG BARBERINO SRL','rid','data_fattura',10,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('UnipolTech S.p.A.','rid','data_fattura',10,1,'e3e82fb2-2661-4525-a25e-8960fc1123dc'),
  -- FASTWEB: ADD ma senza giorni nel file -> prima_scadenza_gg lasciato NULL
  -- (comparirà nell'estrazione finale "manca tempistica").
  ('Fastweb S.p.A.','rid','data_fattura',NULL,1,'e351d628-a150-4769-b965-9514deab48a3'),

  -- ── BONIFICO (fine mese, NESSUNA banca) ────────────────────────
  ('999 SRL','bonifico_ordinario','fine_mese',30,2,NULL),
  ('GGZ SRL','bonifico_ordinario','fine_mese',30,1,NULL),
  ('Unica Piu'' srl','bonifico_ordinario','fine_mese',30,1,NULL),
  ('SIGNORINI ASSOCIATI','bonifico_ordinario','fine_mese',30,1,NULL),
  ('SP CONTABILE DI BERTELLI STEFANIA, GARBIN MONICA E C. SAS','bonifico_ordinario','fine_mese',30,1,NULL),
  ('Amazon Business EU S.a.r.l, Sede Secondaria','bonifico_ordinario','fine_mese',30,1,NULL),
  ('COLORGIS DI FRANCINI SABRINA','bonifico_ordinario','fine_mese',30,1,NULL),
  ('VISIONAREA SRL','bonifico_ordinario','fine_mese',30,1,NULL),
  ('C.A.E P. GHETTI SPA','bonifico_ordinario','fine_mese',30,1,NULL),
  ('T&T ANTINCENDIO DI ANTONIO TANCREDI','bonifico_ordinario','fine_mese',30,1,NULL),
  ('SFORAZZINI SRL','bonifico_ordinario','fine_mese',30,1,NULL),
  ('CORPO VIGILI GIURATI S.P.A. - FIRENZE','bonifico_ordinario','fine_mese',30,1,NULL),
  ('L UNDICESIMO DI GIUSTI LUIGI & GENNY S.A.S','bonifico_ordinario','fine_mese',30,1,NULL),
  ('RISTORANTE COSIMO DE MEDICI SRL','bonifico_ordinario','fine_mese',30,1,NULL),
  ('EPPI S.R.L.','bonifico_ordinario','fine_mese',30,1,NULL),
  ('F&B Florence Srl','bonifico_ordinario','fine_mese',30,1,NULL),

  -- ── BOLLETTINO (fine mese) ─────────────────────────────────────
  ('PLURES S.p.A.','bollettino_postale','fine_mese',30,1,NULL),

  -- ── GIÀ PAGATE: carta_debito a vista, banca della carta ────────
  ('I PIACERI DELLA PASTA DI VALLETTI BEATRICE E C. - S.A.S.','carta_debito','data_fattura',0,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('INDIPENDENCE S.R.L.','carta_debito','data_fattura',0,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('GIFET S.R.L.','carta_debito','data_fattura',0,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('BONAPARTE S.R.L.','carta_debito','data_fattura',0,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('ESERCIZIO INDUSTRIA ALBERGHIERA E.I.A. SAS','carta_debito','data_fattura',0,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('GUTEN S.R.L.','carta_debito','data_fattura',0,1,'e351d628-a150-4769-b965-9514deab48a3'),
  ('LA CONCHIGLIA DEL RAG. LUCA FOCARDI E C SAS','carta_debito','data_fattura',0,1,'e3e82fb2-2661-4525-a25e-8960fc1123dc'),
  ('MUGELLO FUEL STATION DI BUCCINO PASQUALE & C. SAS','carta_debito','data_fattura',0,1,'e3e82fb2-2661-4525-a25e-8960fc1123dc'),
  ('EniMoov S.p.A.','carta_debito','data_fattura',0,1,'e3e82fb2-2661-4525-a25e-8960fc1123dc'),
  ('CANTAGALLO OVEST SRL','carta_debito','data_fattura',0,1,'e3e82fb2-2661-4525-a25e-8960fc1123dc'),
  ('C.C.S. DI CANONICI GIOVANNI & C. S.N.C.','carta_debito','data_fattura',0,1,'e3e82fb2-2661-4525-a25e-8960fc1123dc');

-- 2) BACKUP dei valori attuali delle righe che sto per modificare
CREATE TABLE IF NOT EXISTS public.suppliers_payment_backup_block1_20260715 (
  id uuid, ragione_sociale text, name text,
  payment_method text, default_payment_method text,
  payment_base text, prima_scadenza_gg int, numero_rate int,
  payment_bank_account_id uuid, backed_up_at timestamptz
);
INSERT INTO public.suppliers_payment_backup_block1_20260715
SELECT s.id, s.ragione_sociale, s.name, s.payment_method, s.default_payment_method::text,
       s.payment_base, s.prima_scadenza_gg, s.numero_rate, s.payment_bank_account_id, now()
FROM public.suppliers s
JOIN _b1 b ON COALESCE(s.ragione_sociale, s.name) = b.nome;

-- 3) UPDATE (solo i 6 campi piano; per bonifico banca NULL -> mantiene l'esistente)
UPDATE public.suppliers s SET
  payment_method          = b.metodo,
  default_payment_method  = b.metodo::payment_method,
  payment_base            = b.base,
  prima_scadenza_gg       = b.prima,
  numero_rate             = b.rate,
  payment_bank_account_id = COALESCE(b.banca, s.payment_bank_account_id),
  updated_at              = now()
FROM _b1 b
WHERE COALESCE(s.ragione_sociale, s.name) = b.nome;

COMMIT;

-- =====================================================================
-- VERIFICA (sola lettura, da lanciare dopo)
-- =====================================================================
-- 1) Quante righe aggiornate rispetto ai 45 attesi:
--    SELECT count(*) FROM public.suppliers_payment_backup_block1_20260715;   -- atteso 45
-- 2) Controllo a campione dei valori scritti:
--    SELECT ragione_sociale, payment_method, payment_base, prima_scadenza_gg, numero_rate, payment_bank_account_id
--      FROM public.suppliers
--     WHERE ragione_sociale IN ('GRUPPO FB SRL','HERA COMM S.p.A.','999 SRL','GUTEN S.R.L.')
--     ORDER BY ragione_sociale;
-- 3) ROLLBACK (se serve tornare indietro):
--    UPDATE public.suppliers s SET
--      payment_method=bk.payment_method,
--      default_payment_method=bk.default_payment_method::payment_method,
--      payment_base=bk.payment_base, prima_scadenza_gg=bk.prima_scadenza_gg,
--      numero_rate=bk.numero_rate, payment_bank_account_id=bk.payment_bank_account_id
--    FROM public.suppliers_payment_backup_block1_20260715 bk WHERE bk.id=s.id;
