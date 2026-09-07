-- NZ_ONLY 199 — Ordine dei canali di incasso come li compila la cassiera:
-- Contanti, poi tutti i POS uno dietro l'altro, poi il resto. Solo UPDATE di sort_order.
UPDATE public.outlet_payment_channels ch
   SET sort_order = v.so, updated_at = now()
  FROM (VALUES ('Contanti',1),('POS MPS',2),('POS MPS Amex',3),('POS BCC',4),('POS BCC Amex',5),('Pay by link',6),('Fatture',7),('Bonifico',8)) AS v(label, so)
 WHERE ch.label = v.label AND ch.sort_order <> v.so;
