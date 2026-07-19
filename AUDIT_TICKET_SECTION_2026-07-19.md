# Audit sezione Ticket (/ticket) — 2026-07-19

Audit completo della sezione Ticket & Segnalazioni: pagina, componenti, hooks, edge function
`ticket-resolve-now` e oggetti DB coinvolti (tabella `tickets`, bucket storage `media`, RPC
`get_unseen_ticket_updates_count` / `mark_ticket_seen`).

**Metodo**: 16 auditor paralleli (uno per area: UI, ciclo di vita, hooks/stato, edge function,
isolamento tenant, permessi, integrità dati, notifiche, filtri, allegati/XSS, paginazione,
mobile, stati vuoti/errori, usabilità, accessibilità, coerenza) hanno prodotto 114 finding
grezzi. Ogni finding è passato da una verifica avversariale sul codice reale: i falsi positivi
sono stati scartati, le severità ricalibrate. Solo analisi: nessuna modifica al codice, nessun
accesso ai DB di produzione.

**Esito**: 1 finding critico, 2 alti, 24 medi, 21 bassi confermati. 8 finding scartati come
falsi positivi o già mitigati (elenco in fondo).

---

## 🔴 CRITICA

### 1. Escalation di privilegio: ogni utente può auto-promuoversi a `super_advisor`
**File**: `supabase/migrations/20260417_000_baseline_schema.sql:5707`

La policy RLS `profiles_own_update` su `user_profiles` è:
```sql
CREATE POLICY "profiles_own_update" ON user_profiles AS PERMISSIVE FOR UPDATE
  USING ((id = auth.uid()));
```
Nessuna `WITH CHECK`, nessuna restrizione di colonna, nessun trigger di protezione nel repo
(l'unico trigger è `trg_user_profiles_updated` per `updated_at`). Un utente autenticato
qualsiasi può quindi aggiornare la **propria riga intera**, incluso `role` (e `company_id`),
con una semplice chiamata PostgREST. Le conseguenze investono direttamente la sezione Ticket:

- `TicketAdmin.tsx:87` gate admin con `profile?.role === 'super_advisor'` (letto da `user_profiles`);
- la edge function `ticket-resolve-now/index.ts:338-346` autorizza leggendo `user_profiles.role`;
- `get_my_role()` (baseline `:3514`) legge `role FROM user_profiles` ed è usata da decine di
  policy RLS in tutta l'app → l'escalation apre anche dati finanziari, non solo i ticket.

**Fix proposto**: migration (da applicare a mano sui 3 tenant) che aggiunge `WITH CHECK` alla
policy impedendo la modifica di `role` e `company_id` (es. confronto con i valori correnti via
subselect), oppure trigger `BEFORE UPDATE` che rigetta cambi di `role`/`company_id` se
`auth.uid()` non è super_advisor. In alternativa, limitare la policy alle sole colonne di
profilo (nome, telefono) tramite colonna-level grant + policy.

> Nota: verificato sullo schema versionato nel repo. Se in produzione esistono protezioni non
> versionate, il finding resta valido come schema drift da sanare.

---

## 🟠 ALTA

### 2. Selezione bulk admin mai azzerata al cambio filtri: azioni distruttive su ticket non visibili
**File**: `src/pages/Ticket.tsx:654` (stato `selectedIds`), `:783` (bulk bar), `TicketAdmin.tsx:533-543` (Cancella)

`selectedIds` in `TicketList` non viene mai svuotato quando cambiano `filtroStato` /
`filtroTipo` / `filtroModulo` né quando la lista viene ricaricata. Scenario: l'admin seleziona
ticket con filtro "Chiuso", torna a "Da lavorare", seleziona altri ticket e clicca **Cancella**:
la conferma mostra solo il conteggio ("Stai per CANCELLARE N ticket") e l'operazione — DELETE
irreversibile, con rimozione allegati dallo storage — colpisce anche i ticket selezionati prima
e non più visibili. Vale per tutte le azioni bulk (Prendi in carico, Risolvi con AI, Chiudi
senza lavorare, Riapri, Cancella).

**Fix**: `useEffect` che chiama `clearSelection()` al cambio di uno qualsiasi dei tre filtri e
al reload di `tickets`; nel modal di conferma Cancella elencare i titoli dei ticket coinvolti.

### 3. Bucket `media`: INSERT/UPDATE/DELETE aperti a qualunque utente autenticato su tutti i file
**File**: `supabase/migrations/20260526_048_create_media_bucket.sql:33-40` (non toccate dalla 108)

```sql
CREATE POLICY "auth_del_media" ON storage.objects FOR DELETE
  USING (bucket_id = 'media' AND auth.role() = 'authenticated');
```
La migration 108 ha reso privato il bucket in **lettura**, ma scrittura, sovrascrittura
(`upsert: true` è usato dal client) e cancellazione restano aperte a ogni autenticato su
**qualsiasi path** del bucket: chiunque (Sabrina, Veronica, un account compromesso) può
cancellare o sovrascrivere gli allegati di tutti i ticket. In un sistema live è perdita dati
possibile con una singola chiamata storage.

**Fix**: migration sui 3 tenant che vincola le policy al prefisso del proprietario (es.
`(storage.foldername(name))[1] = 'tickets'` + check su `owner = auth.uid()` per
UPDATE/DELETE, o DELETE riservato a super_advisor via `get_my_role()`).

---

## 🟡 MEDIA

### 4. Cambio stato senza guardia sullo stato corrente (race con AutoFix)
**File**: `src/pages/Ticket.tsx:1052-1074` — *(confermato da verificatore, severità ricalibrata da alta a media)*
`aggiornaStato` fa `update({stato...}).eq('id', ...)` senza `.eq('stato', statoAtteso)`;
`azioniDisponibili` (`:1222-1239`) usa lo stato locale, che può essere stantio (nessun
realtime/refresh). Se l'AutoFix orario risolve il ticket mentre Sabrina ha il dettaglio aperto,
un click su "Prendi in carico" regredisce il ticket a `in_corso` e la riga `:1057` azzera
`risolto_il` appena scritto dall'AI. Nessun vincolo di transizione lato DB.
**Fix**: guardia ottimistica `.eq('stato', ticket.stato)` + toast "aggiornato da qualcun altro"
se 0 righe; in prospettiva una RPC `change_ticket_stato(p_id, p_from, p_to)` usata ovunque.

### 5. Bulk admin "Prendi in carico"/"Riapri" applicabili a ticket in qualsiasi stato
**File**: `src/pages/TicketAdmin.tsx:139-159` — *(confermato da verificatore)*
`bulkUpdateStato` non filtra per stato di partenza: selezionando ticket risolti/chiusi (filtri
"Risolto"/"Chiuso"/"Tutti"), "Prendi in carico" produce transizioni `chiuso→in_corso` /
`risolto→in_corso` mai offerte dal dettaglio e azzera `risolto_il` in blocco, senza conferma.
**Fix**: filtrare gli id per stato compatibile prima dell'update e segnalare nel toast quanti
ticket sono stati saltati.

### 6. La edge function non verifica lo stato del ticket: i chiusi possono essere "ri-risolti"
**File**: `supabase/functions/ticket-resolve-now/index.ts:354-360`, `TicketAdmin.tsx:166-206` — *(confermato da verificatore)*
Il handler non controlla mai `ticket.stato`: un ticket "chiuso senza lavorare" può essere
processato e forzato a `risolto` (`:445-452`), in contraddizione con la promessa del modal di
chiusura ("Le segnalazioni chiuse non vengono più processate da AutoFix", `Ticket.tsx:1294`).
Raggiungibile dalla UI: `bulkResolveViaAI` non filtra per stato.
**Fix**: rifiuto esplicito per stati `chiuso`/`risolto` a inizio handler + filtro client in
`bulkResolveViaAI` (solo `aperto`/`in_corso`).

### 7. Lost update sui commenti: read-modify-write dell'intero array JSONB (client e server)
**File**: `src/pages/Ticket.tsx:1088-1094`, `TicketAdmin.tsx:216-247`, `ticket-resolve-now/index.ts:427-452, 468-476` — *(confermato da verificatore)*
Tutti i percorsi che aggiungono un commento riscrivono l'intero array `commenti` a partire da
uno snapshot: due scritture concorrenti (utente + AutoFix, o due admin) si sovrascrivono a
vicenda e i commenti spariscono in silenzio. Corollario: qualunque utente può di fatto
alterare/cancellare commenti altrui (inclusi quelli AI) riscrivendo l'array.
**Fix**: RPC `append_ticket_comment(p_ticket_id, p_commento)` che fa
`SET commenti = commenti || p_commento` atomicamente, usata da client e edge function.

### 8. Schema e RLS della tabella `tickets` assenti dal repo (schema drift)
**File**: `supabase/migrations/20260526_047_tickets_allegati_multipli.sql:6` (solo ALTER; nessun CREATE TABLE nel repo), `src/types/ticket.ts:3` — *(confermato da verificatore)*
La tabella `tickets` non è versionata: default, vincoli, FK (`autore_id`?), trigger
`aggiornato_il` e soprattutto le **policy RLS** (chi può UPDATE/DELETE?) non sono verificabili
né riproducibili su un tenant nuovo. Conseguenza frontend: `tickets` manca dai tipi generati e
tutta la sezione usa cast `as never` (`from('tickets' as never)`), azzerando la type-safety.
Il gate admin sul DELETE è verificabile solo lato client (`profile?.role === 'super_advisor'`).
**Fix**: migration di consolidamento con `CREATE TABLE IF NOT EXISTS tickets` completo di RLS
esplicite (DELETE solo super_advisor) + rigenerazione tipi TS eliminando gli `as never`.

### 9. Riapertura + nuova risoluzione AI: riuso silenzioso del branch autofix stantio
**File**: `supabase/functions/ticket-resolve-now/index.ts:171-182, 414-416` — *(confermato da verificatore)*
`branchName = autofix-ticket-<shortId>` è deterministico e `createBranch` tratta il 422
"already exists" come successo: alla seconda risoluzione dello stesso ticket il branch vecchio
(basato su un main stantio) viene riusato, con commit/PR che falliscono o portano diff sporchi.
**Fix**: suffisso timestamp nel nome branch, oppure delete+ricreazione del ref se già esistente.

### 10. Cooldown "Risolvi con AI" congelato: bottone disabilitato oltre i 60s
**File**: `src/pages/Ticket.tsx:1109-1116, 1319-1327`
`lastAiCommentAgeSec` è un `useMemo` su `[ticket.commenti]` che legge `Date.now()`: il valore
non viene mai ricalcolato col passare del tempo (nel dettaglio non c'è alcun interval). Dopo un
commento AI il bottone resta "Attendi Xs" e disabilitato indefinitamente finché non cambia
`commenti` o si ricarica la pagina.
**Fix**: stato `now` aggiornato con `setInterval` da 1s attivo solo quando `aiOnCooldown`,
oppure calcolo dell'età al momento del click.

### 11. Bulk "Risolvi con AI": gli errori reali del server sono invisibili
**File**: `src/pages/TicketAdmin.tsx:176-186`, `ticket-resolve-now/index.ts:484-490`
Il bulk usa `functions.invoke` mentre il dettaglio usa `fetch` raw proprio perché invoke
nasconde il body d'errore (commento a `Ticket.tsx:1126-1128`). In più `jsonError` risponde
sempre HTTP 200 con `ok:false`: nel bulk `data.action` è undefined e ogni errore (429 cooldown,
403, 500) diventa un anonimo "risposta inattesa", col messaggio reale (`data.error`) mai letto.
**Fix**: nel bulk leggere `data.ok === false` e mostrare `data.error`; uniformare l'invocazione
a quella del dettaglio.

### 12. Dettaglio in crash se `commenti` è NULL nel DB
**File**: `src/pages/Ticket.tsx:1425-1434`
`ticket.commenti.length` e `.map` senza null-guard, in contrasto col resto del modulo che usa
sempre `ticket.commenti ?? []` (es. `:1088`, `TicketAdmin.tsx:119`) e col tipo della edge
function che dichiara `commenti: ... | null`. Una riga con `commenti` NULL (schema non
verificabile, vedi finding 8) manda in crash la pagina dettaglio.
**Fix**: `const commenti = ticket.commenti ?? []` a inizio render.

### 13. AutoFixCountdown hardcoda il cron NZ (":07") su tutti i tenant, con messaggio per admin mostrato a tutti
**File**: `src/pages/Ticket.tsx:885-921`
Il countdown assume "ogni ora al minuto :07" per tutti e 3 i tenant (frontend condiviso): su
Made/Zago l'orario mostrato può essere falso. Il testo include "Admin: usa 'Risolvi con AI'
per non aspettare", visibile anche a Sabrina/Veronica che non hanno quel bottone. Viola lo
spirito del divieto di valori hardcoded tenant-specifici.
**Fix**: leggere il minuto del cron da configurazione (es. `system_deploy_config`) e mostrare
il suggerimento admin solo se `profile.role === 'super_advisor'`.

### 14. Nessuna notifica agli admin alla creazione di un ticket
**File**: `src/pages/Ticket.tsx:389-456`
La creazione non genera alcuna notifica (campanella, badge, email): gli admin scoprono i nuovi
ticket solo visitando la pagina. Il badge sidebar esiste solo per l'**autore** (ticket
aggiornati non visti). Un ticket urgente di Sabrina può restare invisibile per ore.
**Fix**: badge conteggio "aperti" per i super_advisor sulla voce Admin Segnalazioni, o
inserimento in `NotificationBell`.

### 15. Nessun realtime né polling sulle liste
**File**: `src/pages/Ticket.tsx:1506-1522`
La lista si aggiorna solo con "Aggiorna" manuale o remount. Aggiornamenti di altri utenti o
dell'AutoFix non compaiono; lo stato stantio alimenta le race dei finding 4/5/7.
**Fix**: subscription Supabase Realtime su `tickets` (o polling leggero 60s) che aggiorna lo
stato locale.

### 16. Lista senza `.limit()`/paginazione: tetto implicito di 1000 righe non gestito (e il dettaglio carica tutta la tabella)
**File**: `src/pages/Ticket.tsx:1509-1514, 1536`, `TicketAdmin.tsx:93-98`
`select('*')` senza range: PostgREST tronca a 1000 righe in silenzio — stat card, filtri
client-side e "Esporta CSV" lavorerebbero su un dataset parziale spacciato per completo (tema
del commit #315). Inoltre la vista dettaglio (`/ticket/:id`) carica l'intera tabella per poi
fare `find(t => t.id === ticketId)`: un ticket oltre il tetto risulterebbe "non trovato".
**Fix**: nel dettaglio fetch singolo per id; in lista `.range()` con paginazione o almeno
gestione esplicita del tetto (avviso quando `data.length === 1000`).

### 17. Errore di rete indistinguibile da "nessun ticket" / "segnalazione cancellata"
**File**: `src/pages/Ticket.tsx:792-796, 1549-1567`
Se `load()` fallisce, il toast è transitorio e la UI persiste in stato vuoto: la lista mostra
"Nessun ticket corrisponde ai filtri" e il dettaglio "La segnalazione richiesta non esiste o è
stata cancellata" — falso e allarmante per un utente non tecnico, su un semplice errore di
rete. Nessun bottone Riprova.
**Fix**: stato `error` distinto da `empty` con messaggio in italiano e bottone "Riprova"
(pattern del commit #316, qui non applicato).

### 18. Errore ignorato sull'UPDATE che collega gli allegati: allegati persi con toast di successo
**File**: `src/pages/Ticket.tsx:432-439`
Dopo l'upload, `const { data: updated } = await supabase...update({ allegati })` non controlla
`error`: se l'update fallisce, i file restano orfani nello storage, il ticket risulta senza
allegati e l'utente vede "Segnalazione aperta correttamente".
**Fix**: controllare `error` e avvisare ("segnalazione creata ma allegati non collegati"),
eventualmente ritentare.

### 19. Filtri persi aprendo il dettaglio o ricaricando
**File**: `src/pages/Ticket.tsx:651-653`, `src/App.tsx:179-181`
I filtri vivono nello state di `TicketList`; lista e dettaglio sono route separate, quindi
aprire un ticket e tornare indietro resetta sempre a "Da lavorare". Flusso frequente (scorrere
i risolti uno a uno) molto penalizzato.
**Fix**: filtri in query string (`useSearchParams`) o in un piccolo store/sessionStorage.

### 20. Filtro Modulo inefficace sui ticket importati
**File**: `src/pages/TicketAdmin.tsx:319, 328`
L'import accetta `modulo` come testo libero (fallback "Altro" solo se vuoto, nessuna
validazione contro `TICKET_MODULI`, match case-sensitive): un ticket importato con "banche" o
"Banca" non compare mai nel filtro Modulo e non è mappato da `MODULE_TO_PATH` nella edge
function.
**Fix**: normalizzare/validare `modulo` contro `TICKET_MODULI` in import (case-insensitive,
fallback "Altro" con warning in anteprima).

### 21. `TICKET_MODULI` hardcoda "Outlet"/"Confronto Outlet" ignorando le etichette dinamiche del tenant
**File**: `src/types/ticket.ts:82-106`
Il dropdown Modulo mostra la nomenclatura NZ su tutti i tenant, mentre la sidebar usa
`useCompanyLabels` (es. "Negozi" su altri tenant): incoerenza terminologica per Sabrina e
Veronica. Attenzione: `MODULE_TO_PATH` nella edge function è chiavato sugli stessi nomi, quindi
la label visuale va disaccoppiata dal valore salvato.
**Fix**: mostrare label dinamiche nel dropdown mantenendo come valore la chiave canonica.

### 22. Errori tecnici raw di Supabase (in inglese) nei toast
**File**: `src/types/business.ts:113-119` (usato in tutta la sezione)
`errorMessage` passa il messaggio originale (es. "new row violates row-level security policy")
direttamente al toast: incomprensibile per utenti non tecnici.
**Fix**: mappa dei codici errore comuni → messaggi italiani, fallback generico + dettaglio in
console.

### 23. Prompt injection e regola NO DATA LOSS affidata solo al prompt
**File**: `supabase/functions/ticket-resolve-now/index.ts:255-270, 228-253`
Titolo/descrizione del ticket sono interpolati verbatim nel prompt del modello che genera il
**contenuto completo del file** poi committato e aperto come PR. Un ticket ostile può istruire
il modello a inserire codice indesiderato; la regola NO DATA LOSS (niente `.delete()` ecc.) è
imposta solo via prompt, senza alcuna validazione programmatica dell'output. Mitigazioni reali:
PR con review umana prima del merge, e invocazione riservata a super_advisor — ma l'AutoFix
orario processa i ticket automaticamente.
**Fix**: delimitare il testo utente nel prompt come dato non fidato + check programmatico
sull'output (rifiuto se il diff introduce `.delete(`, `DROP`, `TRUNCATE`, fetch verso host
nuovi, ecc.).

### 24. Risposta Claude non validata: `stop_reason` e `action` fuori enum non gestiti; file grandi irrisolvibili
**File**: `supabase/functions/ticket-resolve-now/index.ts:294-314`
Nessun controllo su `stop_reason` (`max_tokens` = output troncato) né validazione che `action`
sia davvero "fix"/"cant_fix": con `action` mancante il codice salta il ramo `cant_fix` e
procede al fix con `new_file_content` undefined (fallendo poi su GitHub con errori opachi).
Con `max_tokens: 16000` i file più grandi del gestionale non possono comunque essere restituiti
interi.
**Fix**: validare `stop_reason === 'tool_use'|'end_turn'` e l'enum di `action`; rifiutare con
messaggio chiaro i file oltre soglia.

### 25. Modal "Nuova segnalazione" con parte alta tagliata su schermi bassi
**File**: `src/pages/Ticket.tsx:459-460`
Contenitore `fixed inset-0 flex items-center justify-center ... overflow-y-auto` con figlio
`my-8`: quando il contenuto supera l'altezza del viewport (form + lista allegati, o tastiera
mobile aperta), il flexbox centrato taglia la parte alta e la rende irraggiungibile allo
scroll (bug CSS noto).
**Fix**: `m-auto` sul figlio (al posto di `my-8`) oppure `items-start` + `max-h` con scroll interno.

### 26. Modali senza semantica dialog, senza focus management e senza Esc
**File**: `src/pages/Ticket.tsx:135-167, 458-593`, `TicketAdmin.tsx:581-730`
Tutti i modali sono `div` plain: niente `role="dialog"`/`aria-modal`, nessun focus trap, il
focus non viene spostato all'apertura né restituito alla chiusura, Esc non chiude (solo il
Lightbox lo gestisce). Le label dei form non sono associate ai campi (nessun `htmlFor`/`id`) e
la textarea commento non ha nome accessibile.
**Fix**: estrarre un componente Modal condiviso con `role="dialog"`, `aria-modal`,
focus trap + Esc; associare le label con `htmlFor`/`id`.

### 27. Tabella e DropZone inutilizzabili da tastiera
**File**: `src/pages/Ticket.tsx:830-837, 251-265`
Le righe della tabella aprono il dettaglio solo via `onClick` su `<tr>` (nessun elemento
focusabile, nessun Enter/Space); la DropZone è un `div` con `onClick` e input file nascosto,
non raggiungibile da tastiera.
**Fix**: rendere il titolo un link/bottone alla riga; sulla DropZone `role="button"`,
`tabIndex=0` e handler tastiera (o un vero `<button>`).

---

## 🟢 BASSA

### 28. `jsonError` risponde sempre HTTP 200 — *(confermato da verificatore)*
`ticket-resolve-now/index.ts:481-490`. I rami client su `resp.ok`/429 (`Ticket.tsx:1148-1156`)
sono codice morto; monitoraggio HTTP cieco sugli errori. Fix: ripristinare gli status reali ora
che il client dettaglio legge il body via fetch raw (aggiornando anche il bulk, finding 11).

### 29. Chiusura incoerente su `risolto_il`: "Chiudi" lo conserva, "Chiudi senza lavorare" lo azzera — *(confermato da verificatore)*
`TicketAdmin.tsx:240-242` vs `Ticket.tsx:1055-1057`. Su ticket già risolti la chiusura bulk
cancella il timestamp storico di risoluzione. Fix: non toccare `risolto_il` alla chiusura.

### 30. Mobile (360–430px): tabella a 8-9 colonne solo scrollabile, touch target sotto i 44px, zoom iOS
`Ticket.tsx:798-877` (tabella con `overflow-x-auto`, nessun layout a card), pillole filtro e
bulk bar `py-1.5 text-xs` (~30px), checkbox selezione ~20px dentro righe cliccabili
(mitigate da `data-select-cell`), input `text-sm` (14px) che causano auto-zoom su iOS Safari,
modali secondari (`TicketAdmin.tsx:660-701`) senza scroll interno con tastiera aperta, badge
countdown in pillola `rounded-full` che degrada su 360px. Fix: layout a card sotto `sm:`,
target minimi 44px, `text-base` sugli input, `max-h`+`overflow-y-auto` nei modali.

### 31. Il paste da clipboard bypassa la validazione client degli allegati
`Ticket.tsx:354-379`: `handlePaste` aggiunge i file direttamente senza passare da
`validateAndAdd` (tipo/10MB). Mitigato lato server dai limiti del bucket (10MB + whitelist
MIME), ma l'errore arriva tardi e in forma generica. Fix: riusare `validateAndAdd`.

### 32. `URL.createObjectURL` chiamato nel render della DropZone, mai revocato
`Ticket.tsx:297`: nuovi blob URL a ogni re-render (ogni keystroke del form) per ogni immagine,
mai `revokeObjectURL`. Leak contenuto alla vita del modal. Fix: memoizzare gli URL per file e
revocarli su unmount/rimozione.

### 33. Codice morto: `FilterChip` + import inutilizzati
`Ticket.tsx:950-975` (`FilterChip` mai usato), `:27` (`ImageIcon`), `:37` (`TICKET_TIPO_LABEL`)
importati e mai usati. Fix: rimuovere.

### 34. Duplicazioni interne: ConfirmModal reimplementato inline, `PageShell` e `formatDate` copiati
`TicketAdmin.tsx:705-730, 735-741, 39-49` duplicano `Ticket.tsx:135-167, 1603-1609, 44-55`.
Fix: esportare le utility da un modulo condiviso della sezione.

### 35. Componenti condivisi non riusati e CSV senza BOM
Esistono `src/components/EmptyState.tsx`, `PageHeader.tsx`, `ExportMenu.tsx` e
`src/hooks/useTableSort.ts` ma la sezione reimplementa stati vuoti, header, export
(`TicketAdmin.tsx:384-404`, CSV senza BOM UTF-8 → accenti corrotti aprendo in Excel) e non
offre ordinamento per colonna. Fix: adottare i componenti standard; aggiungere `﻿` al CSV.

### 36. `key={i}` instabile nella timeline "Ultimi commenti AutoFix"
`TicketAdmin.tsx:563-565`. Lista derivata e ri-ordinata: usare `key` composta
(ticketId+creato_il). Impatto pratico minimo.

### 37. "Apri ticket" dalla vista admin non apre il modal di creazione
`TicketAdmin.tsx:461`: `onCreate={() => navigate('/ticket')}` porta alla lista e basta;
l'admin deve cliccare di nuovo. Fix: navigare con state che apra il modal.

### 38. Badge "ticket-unseen" con falsi positivi sulle azioni dell'utente stesso
`20260526_049_tickets_resolution_tracking.sql:31-42` + `Ticket.tsx:1004-1011`: commentare il
proprio ticket aggiorna `aggiornato_il` dopo il `mark_ticket_seen` di apertura → il badge si
accende per la propria azione. Fix: richiamare `mark_ticket_seen` (o dispatch `ticket-seen`)
anche dopo l'invio di un commento proprio.

### 39. Nessuna ricerca testuale; la guida promette "cercare"
`Ticket.tsx:745-780` (solo filtri), `src/data/pageGuides.ts` voce `/ticket` sezione "Filtrare e
cercare le segnalazioni". Fix: campo di ricerca client-side su titolo/descrizione o correzione
del titolo della sezione guida.

### 40. `initialStato`: meccanismo orfano
`Ticket.tsx:633, 651-659, 1500`: nessun chiamante nel codebase passa `location.state.initialStato`;
il tipo accetta `'tutti'` ma non `'da_lavorare'`. Fix: rimuovere o collegare a un banner reale.

### 41. Doppia fonte di verità per i ruoli
`src/hooks/useRole.tsx:21-33` legge dal JWT (`app_metadata.role`, noto come rotto su NZ per
encoding, vedi commento in `ticket-resolve-now/index.ts:334-337`), mentre la sezione Ticket usa
`profile.role` da `user_profiles`. Rischio di gate incoerenti tra sezioni. Fix: standardizzare
su `user_profiles.role` (e sanare il dato JWT su NZ).

### 42. Chiudere il modal di creazione scarta il testo digitato senza conferma
`Ticket.tsx:345-350`: il reset su close cancella titolo/descrizione/allegati con un click su X
o Annulla (il backdrop non chiude, il che limita gli incidenti). Fix: conferma se il form è
"sporco".

### 43. Stat card "Aperti" contraddice l'etichetta ufficiale "In attesa"
`Ticket.tsx:736` vs `src/types/ticket.ts:58-65` (che vieta esplicitamente "Aperto" come label
visiva). Fix: rinominare la card "In attesa".

### 44. Refusi e gergo in UI admin
`TicketAdmin.tsx:451` ("esport CSV"), `:414` ("riservato ai super_advisor" — nome ruolo tecnico
esposto). Fix: "export CSV" / "riservato agli amministratori".

### 45. Errori best-effort ingoiati lato server e client
`ticket-resolve-now/index.ts:468-476` (`appendCommentToTicket` ignora l'errore dell'UPDATE:
commento AI perso in silenzio), `:105-130` (`pickFilePathViaClaude` maschera guasti Anthropic
da "file non identificabile"), `Ticket.tsx:1173-1178` (refresh post-AI senza gestione errore),
`:1202-1205` (pulizia storage solo console). Fix: loggare strutturato + propagare dove l'esito
cambia il messaggio all'utente.

### 46. Nessun timeout/AbortSignal sulle fetch verso Anthropic e GitHub
`ticket-resolve-now/index.ts:106, 141-152, 294-302`: una fetch appesa consuma l'intero timeout
della edge function. Fix: `AbortSignal.timeout(30_000)` sulle chiamate esterne.

### 47. Stato dei toggle non esposto, contrasto e icone senza testo
`Ticket.tsx:924-944` (PillButton senza `aria-pressed`), `:841-850` (checkbox custom senza
`role="checkbox"`/`aria-checked`), `:270-274` (testi informativi `text-slate-400` a 10px,
contrasto ~3:1 < 4.5:1), `:853-856` (tipo Bug/Funzione comunicato solo dall'icona, senza testo
accessibile in tabella). Fix: attributi ARIA, `text-slate-500`+, `sr-only` col tipo.

### 48. URL firmati rigenerati a ogni update del ticket; fallimento firma = spinner infinito
`Ticket.tsx:1016-1045`: le dipendenze non stabili rifirmano tutti gli allegati a ogni
`onUpdated`; se `createSignedUrl` fallisce e non c'è `url` legacy, la thumbnail resta uno
spinner permanente senza messaggio né retry. Fix: cache per path + stato d'errore visibile.

### 49. Export CSV vulnerabile a formula injection
`TicketAdmin.tsx:55-60`: `csvEscape` non neutralizza `= + - @` a inizio cella; titoli/descrizioni
utente aperti in Excel dall'admin possono eseguire formule. Rischio contenuto (soli utenti
interni). Fix: prefissare `'` alle celle che iniziano con caratteri formula.

### 50. Allegati nuovi arrivano all'AI come "undefined"
`ticket-resolve-now/index.ts:78, 262`: il tipo `TicketRow` non ha `path` e il prompt mappa
`a.url`, che per gli allegati nuovi (solo `path`, bucket privato) è undefined → riga
"**Allegati**: undefined" nel prompt. Fix: mappare `a.path ?? a.url ?? a.name`.

### 51. `tickets` senza `company_id`: isolamento affidato al 100% all'architettura 1 progetto = 1 azienda
L'isolamento tra NZ/Made/Zago è strutturale (3 DB separati) quindi oggi non c'è leak, ma la
tabella è l'unica del dominio senza `company_id`+RLS a filtro, in controtendenza con tutto il
resto dell'app e fragile rispetto a futuri consolidamenti. Fix: allineare al pattern standard
alla prossima migration di consolidamento (vedi finding 8).

### 52. Reload completi e update seriali dove basterebbe meno
`TicketAdmin.tsx:153, 202, 253, 291` (`await load()` completo dopo ogni operazione),
`:237-247` (N+1 update sequenziali in "Chiudi senza lavorare"), `App.tsx:179-181` (route
lista/dettaglio separate → remount e refetch a ogni navigazione). Accettabile col dataset
attuale; da rivedere insieme alla paginazione (finding 16).

---

## Finding scartati dalla verifica avversariale (falsi positivi / già mitigati)

| Finding proposto | Motivo dello scarto |
|---|---|
| "Risolvi con AI usa `VITE_SUPABASE_URL` → tenant sbagliato su Made/Zago" | Falso: ogni tenant è un deploy Netlify distinto con il proprio `VITE_SUPABASE_URL`; è lo stesso env usato dal client Supabase di tutta l'app. |
| "CORS `Access-Control-Allow-Origin: *` su endpoint amministrativo" | Pattern standard delle edge function Supabase; l'endpoint richiede JWT + ruolo super_advisor, il CORS non è la barriera di sicurezza. |
| "URL allegato dal DB usato in href/src senza validazione schema (XSS via `javascript:`)" | Richiederebbe già accesso in scrittura al DB; a quel punto l'attaccante ha capacità ben maggiori. Edge case irrilevante. |
| "`autore_id` nullable → ticket orfani e badge rotto" | `autore_id` proviene sempre dalla sessione autenticata nel flusso reale; l'aspetto schema è già coperto dal finding 8. |
| "Nessun indice su `creato_il`/`stato`" | La lista carica comunque l'intera tabella senza WHERE; con il dataset attuale l'indice non cambia nulla. Da rivalutare solo con la paginazione. |
| "TOCTOU in bulkCloseWithoutWork come finding autonomo" | Stessa causa radice del lost update sui commenti (finding 7); accorpato. |
| "Repo GitHub condiviso tra tenant → collisione branch AutoFix" | Gli id ticket sono UUID (collisione cross-tenant impossibile); l'aspetto reale (riuso branch stantio) è il finding 9. |
| "Bulk 'Riapri' come transizione invalida" (parte del finding 5) | Il dettaglio offre Riapri sia da risolto sia da chiuso con la stessa logica: comportamento coerente con il singolo. Resta valida solo la parte su "Prendi in carico". |

---

## Nota sul processo

I 16 auditor hanno completato tutti l'analisi (114 finding grezzi). La fase di verifica
avversariale automatica si è interrotta dopo 8 verdetti per raggiungimento del limite di spesa
mensile dell'account; i restanti 106 finding sono stati verificati manualmente uno per uno
leggendo il codice (stessi criteri: conferma solo se riscontrabile nel codice, scarto dei falsi
positivi, ricalibrazione severità). Tutti i finding nel report sono quindi verificati sul
codice reale del repo alla data odierna.
