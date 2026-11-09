-- =====================================================================
-- Migrazione 371 — Saldi di ferie e permessi inventati per il dipendente di prova
-- =====================================================================
-- PERCHE': nella prova del 09/11/2026 la scheda Ferie dell'app mostrava
-- «Le tue ore arrivano con il prossimo cedolino»: il Dipendente Demo non
-- ha righe dello studio paghe. Per provare l'app (e per la revisione degli
-- store) servono saldi da vedere.
--
-- COSA FA: app_saldi_demo(uuid) costruisce saldi fissi (Ferie 120 ore,
-- permessi ex festivita' 32 e ROL 40, al 31/10/2026, giornata di 8 ore) e
-- toglie le ore gia' chieste o approvate dopo quella data, come fa
-- v_leave_disponibilita per i dipendenti veri. app_dipendente_ferie la usa
-- SOLO se il dipendente e' di prova e non ha saldi veri.
-- Nessun dato scritto. Tenant: NZ e Zago.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.app_saldi_demo(p_emp uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH base(voce, voce_label, residuo, matura) AS (
    VALUES ('F01', 'Ferie', 120::numeric, 16::numeric),
           ('F02', 'Ex festività', 32::numeric, 0::numeric),
           ('F03', 'ROL', 40::numeric, 8::numeric)
  ), chieste AS (
    SELECT d.voce,
           sum(d.ore) FILTER (WHERE q.stato = 'inviata' AND d.stato = 'richiesto') AS attesa,
           sum(d.ore) FILTER (WHERE q.stato IN ('approvata', 'approvata_parziale', 'chiusa') AND d.stato = 'approvato') AS approvate
      FROM public.leave_request_days d JOIN public.leave_requests q ON q.id = d.request_id
     WHERE q.employee_id = p_emp AND q.stato NOT IN ('ritirata', 'respinta', 'bozza')
       AND d.data > DATE '2026-10-31'
     GROUP BY d.voce
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'voce', b.voce,
           'voce_label', b.voce_label,
           'residuo', b.residuo,
           'residuo_disponibile', b.residuo - COALESCE(c.attesa, 0) - COALESCE(c.approvate, 0),
           'da_fruire', b.residuo + b.matura,
           'da_fruire_disponibile', b.residuo + b.matura - COALESCE(c.attesa, 0) - COALESCE(c.approvate, 0),
           'ore_in_attesa', COALESCE(c.attesa, 0),
           'ore_approvate', COALESCE(c.approvate, 0),
           'ore_in_bozza', 0,
           'saldo_alla_data', DATE '2026-10-31',
           'ore_giornata_dedotte', 8,
           'ore_settimanali_dedotte', 40) ORDER BY b.voce), '[]'::jsonb)
    FROM base b LEFT JOIN chieste c ON c.voce = b.voce;
$$;
REVOKE ALL ON FUNCTION public.app_saldi_demo(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_saldi_demo(uuid) TO service_role;

DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.app_dipendente_ferie()'::regprocedure);
  n := replace(d,
    $x$FROM public.v_leave_disponibilita d WHERE d.employee_id = v_emp), '[]'::jsonb),$x$,
    $x$FROM public.v_leave_disponibilita d WHERE d.employee_id = v_emp),
      CASE WHEN e.is_demo THEN public.app_saldi_demo(v_emp) ELSE '[]'::jsonb END),$x$);
  IF n = d THEN
    RAISE EXCEPTION 'app_dipendente_ferie: testo atteso non trovato';
  END IF;
  EXECUTE n;
END;
$$;

COMMIT;

-- Verifica: SELECT pg_get_functiondef('public.app_dipendente_ferie()'::regprocedure) ~ 'app_saldi_demo';  -- true
