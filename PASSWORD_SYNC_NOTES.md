# stessa password su New Zago, Made e Zago

Richiesta di Patrizio del 30/10/2026: «con un unico nome utente e password si accede ovunque».
I tre gestionali hanno archivi di accessi separati (ADR-001): senza un ponte, una password cambiata
su uno non vale sugli altri.

## cosa è stato fatto il 30/10/2026

1. **Allineamento iniziale.** Per le 5 persone dell'ufficio (Patrizio, Lilian, newzago@vicolo.com,
   amministrazione@miamor-shop.it, ds.affarieconsulenze) la password cifrata di NZ è stata copiata
   su Made e Zago, con ruoli e azienda come su NZ. newzago@vicolo.com è stato creato su Made e Zago.
   Backup prima della modifica in `auth_allineamento_bkp_20261030` (su Made e Zago).
2. **Sincronizzazione continua**, migration `20261030_333_sincronizzazione_password.sql`.

## come funziona la sincronizzazione

- Trigger `trg_password_sync` su `auth.users` (AFTER UPDATE OF encrypted_password). Copre ogni via:
  Profilo, «password dimenticata», Impostazioni → Utenti (chiave), pannello Supabase.
- Il tenant manda agli altri due, con `pg_net`, solo la **password cifrata** (bcrypt) alla RPC
  `password_sync_receive`. La password in chiaro non esce mai da Supabase Auth.
- Il ricevente applica solo se: header `x-password-sync` uguale al suo Vault `password_sync_secret`;
  l'email esiste già da lui (gli account cassa dei negozi NZ non esistono altrove, quindi restano
  fuori); il cambio è più recente dell'ultimo noto (`password_sync_state`).
- Niente rimbalzi: l'aggiornamento ricevuto imposta `app.password_sync = on` e il trigger lo salta.
- Un errore non blocca mai il cambio password né l'accesso: finisce in `password_sync_log`.

## configurazione per tenant (dati, non codice)

- `public.password_sync_peers`: gli altri due tenant, URL REST e chiave pubblica. Si scrivono con
  `execute_sql` su ogni tenant; mai nel file di migration (niente valori di un tenant nel codice).
- Vault `password_sync_secret`: **stesso valore sui 3 tenant**, almeno 32 caratteri. Lo inserisce
  Patrizio, il valore non passa da Claude. Senza segreto il trigger scrive `skipped` nel log.

## controlli

```sql
SELECT at, direction, email, peer, status, detail FROM public.password_sync_log ORDER BY at DESC LIMIT 20;
SELECT name, enabled FROM public.password_sync_peers ORDER BY name;
```
Stati: `sent` (inviata), `applied` (ricevuta e applicata), `stale` (ne avevo già una più nuova),
`no_user` (qui quella email non ha un accesso), `skipped` (manca il segreto), `error`.

## limiti noti

- Un accesso creato dopo su un tenant (stessa email) prende la password comune solo al primo cambio
  successivo: per allinearlo subito si copia la password cifrata come il 30/10.
- Spegnere senza rollback: `UPDATE public.password_sync_peers SET enabled = false;` sul tenant.
