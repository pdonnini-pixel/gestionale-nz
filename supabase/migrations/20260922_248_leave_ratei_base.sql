-- =====================================================================
-- Migrazione 248 — Fase 1 del piano ferie: i ratei letti dalle paghe
-- =====================================================================
-- COSA MANCA OGGI: nel gestionale non esiste nessun dato di ferie e
-- permessi. Zero tabelle, zero saldi. Il residuo di ogni persona vive
-- soltanto nel file Excel che Veronica aggiorna a mano.
--
-- COSA INTRODUCE: il posto dove atterra la stampa "Situazione ratei di
-- ferie e permessi" che lo studio paghe (Signorini, Paghe Infinity)
-- pubblica ogni mese per le tre societa'. Il gestionale NON calcola la
-- maturazione: la legge da quel documento, che e' l'unica fonte che sa
-- davvero quante ore ha in tasca ciascuno.
--
--   1. leave_accrual_imports — un documento letto (azienda, periodo,
--      file archiviato, totali ditta dichiarati, esito della quadratura).
--      Reimportare lo stesso mese NON cancella niente: il vecchio import
--      resta con attivo = false (REGOLA GRANITICA NO DATA LOSS).
--   2. leave_accrual_rows — una riga per persona e per voce, come
--      stampata (F01 ferie, F02 permessi ex festivita', F03 ROL), con
--      tutte le colonne del tabulato e l'aggancio al dipendente.
--      L'aggancio porta sempre con se' il METODO con cui e' stato fatto,
--      cosi' un abbinamento dedotto si distingue da uno confermato a mano.
--   3. v_leave_balances — il saldo corrente di ogni dipendente, cioe'
--      le righe dell'ultimo import attivo. security_invoker = on.
--   4. employees.ore_settimanali_paghe — l'orario settimanale ricavato
--      dal rateo annuo. Colonna NUOVA e separata: la ore_settimanali
--      esistente (40 per tutti e 58, valore di riempimento) non viene
--      toccata ne' sovrascritta.
--
-- PERCHE' UNA COLONNA IN PIU' E NON UNA CORREZIONE: sui 40 dipendenti
-- presenti nella stampa di agosto 2026, l'orario del gestionale e' giusto
-- in 7 casi su 40. Correggerlo in automatico significherebbe sovrascrivere
-- un dato inserito da una persona. Il dato delle paghe si affianca, e
-- l'interfaccia mostra la differenza.
--
-- NOTA SUL COEFFICIENTE: nel tabulato il rateo annuo di ferie e' l'orario
-- settimanale per 4,325 (40 ore danno 173,00, 30 ore danno 129,75, 8 ore
-- danno 34,60; verificato su tutti e 12 i valori distinti del documento).
-- La funzione leave_ore_settimanali_da_rateo() tiene quel coefficiente in
-- UN SOLO POSTO: se lo studio paghe conferma un criterio diverso, si
-- cambia li'. Finche' non arriva la conferma, il valore e' DEDOTTO e
-- l'interfaccia lo dichiara.
--
-- NO DATA LOSS: solo CREATE TABLE / CREATE VIEW / ADD COLUMN. Nessuna
-- riga esistente viene letta, modificata o cancellata.
-- REGOLA #0: da applicare su NZ + Made + Zago.
-- Rollback: 20260922_248_leave_ratei_base_ROLLBACK.sql
-- Applicata su NZ, Made e Zago il 22/09/2026 con il nome
-- 20260922_245_leave_ratei_base: rinumerata qui a 248 perche' la 245 e la
-- 246 del 21/09 erano gia' prese. Il contenuto e' lo stesso, riga per riga.
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Il documento letto
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_accrual_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id),
  -- Periodo di elaborazione stampato in testa al documento ("Agosto 2026").
  periodo_anno    int  NOT NULL CHECK (periodo_anno BETWEEN 2020 AND 2100),
  periodo_mese    int  NOT NULL CHECK (periodo_mese BETWEEN 1 AND 12),
  -- Intestazione del tabulato: "071041 NEW ZAGO SRL".
  azienda_codice  text,
  azienda_nome    text,
  -- Il file, archiviato in "Paghe e personale" come gli altri documenti.
  file_name       text,
  storage_bucket  text,
  storage_path    text,
  documento_id    uuid,
  -- Esito della lettura.
  persone         int  NOT NULL DEFAULT 0,
  righe_lette     int  NOT NULL DEFAULT 0,
  righe_agganciate int NOT NULL DEFAULT 0,
  -- Blocco "Totali ditta" del documento, voce per voce: serve a dimostrare
  -- che la lettura e' completa senza fidarsi del parser.
  totali_ditta    jsonb,
  -- true quando la somma delle righe lette coincide con i totali ditta.
  quadratura_ok   boolean,
  scarti          jsonb,
  -- Un reimport dello stesso mese spegne il precedente invece di cancellarlo.
  attivo          boolean NOT NULL DEFAULT true,
  sostituito_da   uuid REFERENCES public.leave_accrual_imports(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid
);

COMMENT ON TABLE public.leave_accrual_imports IS
  'Stampa "Situazione ratei di ferie e permessi" delle paghe, letta e archiviata. Un import per mese e per azienda; i precedenti restano con attivo=false.';

-- Un solo import ATTIVO per azienda e mese. I vecchi restano in tabella.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_imports_periodo_attivo
  ON public.leave_accrual_imports (company_id, periodo_anno, periodo_mese)
  WHERE attivo;

CREATE INDEX IF NOT EXISTS idx_leave_imports_company
  ON public.leave_accrual_imports (company_id, periodo_anno DESC, periodo_mese DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Le righe del tabulato
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_accrual_rows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id),
  import_id       uuid NOT NULL REFERENCES public.leave_accrual_imports(id) ON DELETE CASCADE,

  -- Come stampato, senza interpretazioni.
  matricola       text,
  nominativo      text NOT NULL,
  data_assunzione date,
  data_cessazione date,
  voce            text NOT NULL CHECK (voce IN ('F01', 'F02', 'F03')),
  voce_label      text,
  unita           text,

  -- Colonne del tabulato, tutte in ore.
  rateo_annuo         numeric(12,5),
  mesi                int,
  residuo_prec        numeric(12,5),
  goduto_prec         numeric(12,5),
  saldo_prec          numeric(12,5),
  maturato            numeric(12,5),
  goduto              numeric(12,5),
  saldo_corso         numeric(12,5),
  residuo             numeric(12,5),
  da_maturare         numeric(12,5),
  da_fruire           numeric(12,5),
  non_indennizzabile  numeric(12,5),
  da_godere_anno      numeric(12,5),

  -- Aggancio alla persona. Nullo finche' nessuno lo conferma: una riga
  -- non agganciata resta visibile e segnalata, non sparisce.
  employee_id     uuid REFERENCES public.employees(id),
  match_metodo    text CHECK (match_metodo IN (
                    'matricola_e_nome',   -- matricola e nome coincidono
                    'nome_e_assunzione',  -- nome e data di assunzione coincidono
                    'nome',               -- solo il nome
                    'matricola',          -- solo la matricola
                    'manuale'             -- confermato da una persona
                  )),
  match_note      text,
  match_confermato_da uuid,
  match_confermato_il timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.leave_accrual_rows IS
  'Una riga per persona e per voce (F01 ferie, F02 permessi ex festivita, F03 ROL) come stampata dalle paghe, con l''aggancio al dipendente e il metodo con cui e'' stato fatto.';
COMMENT ON COLUMN public.leave_accrual_rows.match_metodo IS
  'Come e'' stato agganciato il dipendente. La matricola da sola non basta: differisce fra gestionale e paghe su 5 persone su 40 (agosto 2026).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_rows_import_persona_voce
  ON public.leave_accrual_rows (import_id, COALESCE(matricola, ''), nominativo, voce);

CREATE INDEX IF NOT EXISTS idx_leave_rows_employee
  ON public.leave_accrual_rows (employee_id) WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leave_rows_import
  ON public.leave_accrual_rows (import_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. L'orario settimanale ricavato dal rateo
-- ─────────────────────────────────────────────────────────────────────
-- Un solo posto per il coefficiente, cosi' una conferma (o una smentita)
-- dello studio paghe si applica cambiando questa funzione.
CREATE OR REPLACE FUNCTION public.leave_ore_settimanali_da_rateo(p_rateo_annuo numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_rateo_annuo IS NULL OR p_rateo_annuo <= 0 THEN NULL
    ELSE round(p_rateo_annuo / 4.325, 2)
  END;
$$;

COMMENT ON FUNCTION public.leave_ore_settimanali_da_rateo(numeric) IS
  'Orario settimanale DEDOTTO dal rateo annuo di ferie del tabulato paghe (rateo / 4,325). Verificato su 12 valori distinti: 173,00 = 40 ore, 129,75 = 30 ore, 34,60 = 8 ore. In attesa di conferma dello studio paghe.';

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS ore_settimanali_paghe numeric(6,2),
  ADD COLUMN IF NOT EXISTS ore_settimanali_paghe_at timestamptz,
  ADD COLUMN IF NOT EXISTS ore_settimanali_paghe_import_id uuid REFERENCES public.leave_accrual_imports(id);

COMMENT ON COLUMN public.employees.ore_settimanali_paghe IS
  'Orario settimanale ricavato dal tabulato ratei delle paghe. NON sovrascrive ore_settimanali (compilata a mano): le due convivono e l''interfaccia mostra la differenza.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. Il saldo corrente
-- ─────────────────────────────────────────────────────────────────────
-- Le righe dell'ultimo import attivo di ogni azienda. Niente numeri
-- duplicati in una tabella da tenere allineata: il saldo E' il documento.
CREATE OR REPLACE VIEW public.v_leave_balances
WITH (security_invoker = on) AS
WITH ultimo AS (
  SELECT DISTINCT ON (company_id)
         id, company_id, periodo_anno, periodo_mese
  FROM public.leave_accrual_imports
  WHERE attivo
  ORDER BY company_id, periodo_anno DESC, periodo_mese DESC, created_at DESC
)
SELECT
  r.company_id,
  r.employee_id,
  u.id                AS import_id,
  u.periodo_anno,
  u.periodo_mese,
  -- Ultimo giorno del mese di elaborazione: e' la data a cui il saldo si
  -- riferisce, e da cui in poi contano le richieste del gestionale.
  (make_date(u.periodo_anno, u.periodo_mese, 1) + interval '1 month - 1 day')::date AS saldo_alla_data,
  r.voce,
  r.voce_label,
  r.rateo_annuo,
  r.residuo_prec,
  r.saldo_prec,
  r.maturato,
  r.goduto,
  r.saldo_corso,
  r.residuo,
  r.da_maturare,
  r.da_fruire,
  r.non_indennizzabile,
  r.data_cessazione,
  public.leave_ore_settimanali_da_rateo(
    CASE WHEN r.voce = 'F01' THEN r.rateo_annuo END
  ) AS ore_settimanali_dedotte,
  -- Ore di una giornata piena: orario settimanale diviso cinque.
  CASE WHEN r.voce = 'F01'
       THEN round(public.leave_ore_settimanali_da_rateo(r.rateo_annuo) / 5, 2)
  END AS ore_giornata_dedotte
FROM public.leave_accrual_rows r
JOIN ultimo u ON u.id = r.import_id
WHERE r.employee_id IS NOT NULL;

COMMENT ON VIEW public.v_leave_balances IS
  'Saldo ferie, permessi ex festivita e ROL di ogni dipendente, dall''ultimo tabulato paghe importato. In ore. Il giorno vale orario settimanale diviso cinque.';

-- ─────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.leave_accrual_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_accrual_rows   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_imports_select ON public.leave_accrual_imports;
CREATE POLICY leave_imports_select ON public.leave_accrual_imports
  FOR SELECT USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS leave_imports_write ON public.leave_accrual_imports;
CREATE POLICY leave_imports_write ON public.leave_accrual_imports
  FOR ALL
  USING (company_id = public.get_my_company_id()
         AND (public.get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile', 'coo']))
  WITH CHECK (company_id = public.get_my_company_id()
         AND (public.get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile', 'coo']));

DROP POLICY IF EXISTS leave_rows_select ON public.leave_accrual_rows;
CREATE POLICY leave_rows_select ON public.leave_accrual_rows
  FOR SELECT USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS leave_rows_write ON public.leave_accrual_rows;
CREATE POLICY leave_rows_write ON public.leave_accrual_rows
  FOR ALL
  USING (company_id = public.get_my_company_id()
         AND (public.get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile', 'coo']))
  WITH CHECK (company_id = public.get_my_company_id()
         AND (public.get_my_role())::text = ANY (ARRAY['super_advisor', 'contabile', 'coo']));

-- Le tabelle nuove NON ereditano i blocchi delle migrazioni 172 e 240:
-- vanno aggiunti a mano, altrimenti l'operatore di cassa e il viewer ci
-- arriverebbero via API. I ratei sono dati sensibili del personale.
DROP POLICY IF EXISTS cash_operator_block ON public.leave_accrual_imports;
CREATE POLICY cash_operator_block ON public.leave_accrual_imports AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa');

DROP POLICY IF EXISTS cash_operator_block ON public.leave_accrual_rows;
CREATE POLICY cash_operator_block ON public.leave_accrual_rows AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa')
  WITH CHECK (COALESCE(public.get_my_role()::text, '') <> 'operatore_cassa');

-- Il viewer (sola lettura) vede ma non scrive, come su tutte le altre.
DROP POLICY IF EXISTS viewer_no_insert ON public.leave_accrual_imports;
CREATE POLICY viewer_no_insert ON public.leave_accrual_imports AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (COALESCE(public.get_my_role()::text, '') <> 'viewer');
DROP POLICY IF EXISTS viewer_no_update ON public.leave_accrual_imports;
CREATE POLICY viewer_no_update ON public.leave_accrual_imports AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'viewer');
DROP POLICY IF EXISTS viewer_no_delete ON public.leave_accrual_imports;
CREATE POLICY viewer_no_delete ON public.leave_accrual_imports AS RESTRICTIVE FOR DELETE TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'viewer');

DROP POLICY IF EXISTS viewer_no_insert ON public.leave_accrual_rows;
CREATE POLICY viewer_no_insert ON public.leave_accrual_rows AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (COALESCE(public.get_my_role()::text, '') <> 'viewer');
DROP POLICY IF EXISTS viewer_no_update ON public.leave_accrual_rows;
CREATE POLICY viewer_no_update ON public.leave_accrual_rows AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'viewer');
DROP POLICY IF EXISTS viewer_no_delete ON public.leave_accrual_rows;
CREATE POLICY viewer_no_delete ON public.leave_accrual_rows AS RESTRICTIVE FOR DELETE TO authenticated
  USING (COALESCE(public.get_my_role()::text, '') <> 'viewer');

COMMIT;

-- VERIFICA (attesi: 2 tabelle, 1 vista con security_invoker, 3 colonne nuove)
--   SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'leave_%';
--   SELECT relname, reloptions FROM pg_class WHERE relname = 'v_leave_balances';
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='employees' AND column_name LIKE 'ore_settimanali_paghe%';
--   SELECT count(*) FROM public.v_leave_balances;   -- 0 finche' non si importa
