-- ROLLBACK NZ_ONLY 193: azzera codici e parole chiave impostati il 2026-09-07.
UPDATE public.outlet_payment_channels ch
   SET terminal_code = NULL, updated_at = now()
  FROM public.outlets o
 WHERE o.id = ch.outlet_id AND ch.kind IN ('pos','pos_amex','contanti') AND ch.is_active
   AND ch.terminal_code IN ('00001','00002','00003','00004','00005','00006','00007','00008','00009','00010','00011','00012','00013','00014',
                            'FOIANO','cassa contin','PALMANOVA','FRANCIACORTA|ATM 01030-2121','BRUGNATO','ATM 01030-1745','ATM 9750');
