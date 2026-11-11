-- =====================================================================
-- Migrazione 392 — Pausa in più momenti, caso «pausa più lunga»
-- =====================================================================
-- Decisione di Patrizio dell'11/11/2026: durante il turno la pausa si può
-- fare in più momenti, ma in tutto non oltre quella scritta nel gestionale
-- (shifts.pausa_minuti). Finita la pausa del turno la timbratrice non
-- propone più «Vado in pausa» (frontend, src/lib/timbrature.ts). Se al
-- rientro le pause della giornata superano quella del turno oltre la
-- tolleranza, nasce il caso «pausa_lunga» da confermare: il responsabile
-- sceglie se scalare i minuti come permesso o lasciarli ore non lavorate.
-- Le ore lavorate tolgono già tutte le pause: il caso serve a decidere il
-- permesso, non cambia le timbrature.
-- 1. attendance_eventi.tipo accetta 'pausa_lunga'.
-- 2. timbrature_evento_da_timbratura: ramo per 'fine_pausa'.
-- 3. presenze_decidi_evento: decisione del caso (permesso o ore non lavorate).
-- Tenant: NZ e Zago. Rollback: 20261111_392_pausa_in_piu_momenti_ROLLBACK.sql
-- =====================================================================
BEGIN;

ALTER TABLE public.attendance_eventi DROP CONSTRAINT attendance_eventi_tipo_check;
ALTER TABLE public.attendance_eventi ADD CONSTRAINT attendance_eventi_tipo_check
  CHECK (tipo = ANY (ARRAY['ritardo', 'uscita_anticipata', 'straordinario', 'entrata_dichiarata', 'pausa_lunga']));

DO $do$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.timbrature_evento_da_timbratura(uuid,text)'::regprocedure);
  n := d;
  n := replace(n, $x$  v_demo   boolean;
BEGIN$x$, $x$  v_demo   boolean;
  v_pausa  integer;  -- 392
BEGIN$x$);
  n := replace(n, $x$p.tipo NOT IN ('entrata', 'uscita') THEN$x$, $x$p.tipo NOT IN ('entrata', 'uscita', 'fine_pausa') THEN$x$);
  n := replace(n, $x$  IF p.tipo = 'entrata' THEN
    IF EXISTS$x$, $x$  IF p.tipo = 'fine_pausa' THEN
    -- 392: pause della giornata fino a questo rientro, contro la pausa del turno
    SELECT sum(t.pausa_minuti) INTO v_pausa
      FROM public.timbrature_turni_ufficiali(p.company_id, v_data, v_data) t
     WHERE t.employee_id = p.employee_id;
    IF COALESCE(v_pausa, 0) > 0 THEN
      SELECT floor(COALESCE(sum(extract(epoch FROM (x.prossima - x.ora))), 0) / 60.0)::integer - v_pausa
        INTO v_min
        FROM (SELECT a.tipo, a.ora, lead(a.ora) OVER (ORDER BY a.ora) AS prossima
                FROM public.attendance_punches a
               WHERE a.employee_id = p.employee_id AND NOT a.annullata AND a.verifica IN ('ok', 'da_confermare')
                 AND (a.ora AT TIME ZONE 'Europe/Rome')::date = v_data AND a.ora <= p.ora) x
       WHERE x.tipo = 'inizio_pausa' AND x.prossima IS NOT NULL;
      -- I minuti gia' in un caso dello stesso giorno non si contano due volte
      -- (solo casi non respinti, di rientri precedenti: la coda offline puo' arrivare fuori ordine)
      v_min := v_min - COALESCE((SELECT sum(ev.minuti) FROM public.attendance_eventi ev
                                   JOIN public.attendance_punches q ON q.id = ev.punch_id
                                  WHERE ev.employee_id = p.employee_id AND ev.data = v_data
                                    AND ev.tipo = 'pausa_lunga' AND ev.stato <> 'respinto'
                                    AND ev.punch_id <> p.id AND q.ora < p.ora), 0);
      IF v_min > v_tol THEN
        INSERT INTO public.attendance_eventi
          (company_id, outlet_id, employee_id, punch_id, data, tipo, turno_inizio, turno_fine,
           minuti, minuti_proposti, tolleranza_minuti, margine_minuti)
        VALUES
          (p.company_id, p.outlet_id, p.employee_id, p.id, v_data, 'pausa_lunga', v_inizio, v_fine,
           v_min, v_min, v_tol, v_marg)
        ON CONFLICT (punch_id, tipo) DO NOTHING
        RETURNING id, tipo INTO v_id, v_tipo;
      END IF;
    END IF;
  ELSIF p.tipo = 'entrata' THEN
    IF EXISTS$x$);
  n := replace(n, $x$WHEN 'uscita_anticipata' THEN 'Uscita prima del turno: '$x$,
                  $x$WHEN 'uscita_anticipata' THEN 'Uscita prima del turno: ' WHEN 'pausa_lunga' THEN 'Pausa più lunga da confermare: '$x$);
  IF n = d OR position('pausa_lunga' in n) = 0 OR position($x$'uscita', 'fine_pausa')$x$ in n) = 0
     OR position('Pausa più lunga' in n) = 0 OR position('ELSIF p.tipo = ''entrata''' in n) = 0 THEN
    RAISE EXCEPTION 'timbrature_evento_da_timbratura: ancore non trovate';
  END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.presenze_decidi_evento(uuid,boolean,integer,boolean,text)'::regprocedure);
  n := replace(d, $x$  ELSE
    v_esito := 'straordinario';$x$, $x$  ELSIF ev.tipo = 'pausa_lunga' THEN
    -- 392: pausa oltre quella del turno, permesso o ore non lavorate
    IF p_scala_permesso IS TRUE THEN
      v_esito := 'permesso'; v_scala := true;
      v_req := public.presenze_crea_permesso(p_evento, v_min, 'Pausa più lunga del ' || v_giorno);
    ELSIF p_scala_permesso IS FALSE THEN
      v_esito := 'ore_non_lavorate';
    ELSE
      RAISE EXCEPTION 'Pausa più lunga: scegli se scalare il permesso.' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_esito := 'straordinario';$x$);
  IF n = d THEN RAISE EXCEPTION 'presenze_decidi_evento: ancora non trovata'; END IF;
  EXECUTE n;
END
$do$;

COMMIT;
