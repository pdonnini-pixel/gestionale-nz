-- 468b · Su NZ i permessi di default del progetto davano qualcosa ad anon sulle tabelle della 468
-- (la RLS non gli faceva vedere niente: policy solo per authenticated). Si toglie, come la 464b.
-- Su Zago la 468 e' stata applicata gia' con il REVOKE dentro; questa resta innocua se rilanciata.
REVOKE ALL ON public.outlet_servizi FROM anon;
REVOKE ALL ON public.outlet_consegne FROM anon;
