-- =====================================================================
-- 257 — Chi altro e' via, nello stesso punto vendita
-- =====================================================================
-- Il buco: chi compila una richiesta non sa se qualcun altro del suo
-- negozio ha gia' chiesto quei giorni, e chi approva non lo vede scritto
-- da nessuna parte. Decidere una ferie senza sapere chi manca quel giorno
-- vuol dire scoprire il buco quando il negozio e' gia' scoperto.
--
-- COSA C'E' QUI DENTRO: una vista sola, che per ogni GIORNO e ogni PUNTO
-- VENDITA dice chi e' via. Niente dato nuovo: le richieste hanno gia' i
-- giorni, le persone hanno gia' il punto vendita.
--
-- «VIA», NON «ASSENTE». Il gestionale sa chi ha ferie o permessi, non sa
-- chi e' di turno e non conosce malattie, maternita' o infortuni. Quindi
-- questa vista risponde a «chi ha gia' ferie o permessi quel giorno», che
-- e' vero, e non a «chi c'e' in negozio», che sarebbe una promessa che
-- non possiamo mantenere finche' non abbiamo i turni.
--
-- QUALI GIORNI CONTANO: gli stessi che scalano il saldo in
-- v_leave_disponibilita, cosi' i due conti non si contraddicono.
--   - la richiesta e' uscita dalla bozza e non e' stata ritirata o
--     respinta in blocco;
--   - il giorno non e' stato respinto singolarmente.
-- Le bozze non compaiono: non impegnano ore e non sono ancora una
-- richiesta di nessuno.
--
-- IL PUNTO VENDITA e' quello della persona OGGI (employees.outlet_id),
-- non quello fotografato nella richiesta: a chi deve decidere adesso
-- serve sapere chi manca adesso in quel negozio.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_leave_giorni_outlet
WITH (security_invoker = on) AS
SELECT
  d.company_id,
  d.data,
  e.outlet_id,
  o.name          AS outlet_nome,
  e.id            AS employee_id,
  btrim(concat_ws(' ', e.cognome, e.nome)) AS nominativo,
  d.voce,
  d.tipo,
  d.ore,
  d.stato         AS stato_giorno,
  r.id            AS request_id,
  r.stato         AS stato_richiesta,
  -- Una riga sola da mostrare: approvata o ancora da decidere.
  (r.stato IN ('approvata', 'approvata_parziale', 'chiusa')
     AND d.stato = 'approvato')            AS confermato
FROM public.leave_request_days d
JOIN public.leave_requests r ON r.id = d.request_id
JOIN public.employees e      ON e.id = r.employee_id
LEFT JOIN public.outlets o   ON o.id = e.outlet_id
WHERE r.stato IN ('inviata', 'approvata', 'approvata_parziale', 'chiusa')
  AND d.stato <> 'respinto';

COMMENT ON VIEW public.v_leave_giorni_outlet IS
  'Chi e'' via, giorno per giorno e punto vendita per punto vendita. Solo ferie e permessi: non sa chi e'' di turno e non conosce le altre assenze.';

REVOKE ALL ON public.v_leave_giorni_outlet FROM PUBLIC, anon;
GRANT SELECT ON public.v_leave_giorni_outlet TO authenticated, service_role;
