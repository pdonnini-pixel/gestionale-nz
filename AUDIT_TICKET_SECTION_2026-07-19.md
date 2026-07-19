# Audit sezione Ticket (/ticket) — 2026-07-19 (rev. 2)

Audit completo della sezione Ticket & Segnalazioni: pagina, componenti, hooks, edge function
`ticket-resolve-now` e oggetti DB coinvolti (tabella `tickets`, bucket storage `media`, RPC
`get_unseen_ticket_updates_count` / `mark_ticket_seen`).

**Metodo**: 16 auditor paralleli (uno per area: UI, ciclo di vita, hooks/stato, edge function,
isolamento tenant, permessi, integrità dati, notifiche, filtri, allegati/XSS, paginazione,
mobile, stati vuoti/errori, usabilità, accessibilità, coerenza) hanno prodotto 114 finding
grezzi. Ogni finding è passato da un verificatore avversariale dedicato che ha letto il codice
reale e lo ha confermato o scartato, ricalibrando le severità. Solo analisi: nessuna modifica
al codice, nessun accesso ai DB di produzione.

**Rev. 2**: nella prima stesura la verifica avversariale automatica si era interrotta per
limite di spesa (8 verdetti su 114) ed era stata completata manualmente. I 106 verificatori
mancanti hanno poi completato il lavoro (130 agenti totali, 0 errori): questa revisione
recepisce i loro verdetti. Differenze principali rispetto alla rev. 1: il finding critico è
stato ricalibrato ad **alta** (exploit solo da insider autenticato), il finding
`VITE_SUPABASE_URL` — scartato per errore nella rev. 1 — è stato **confermato** (i verificatori
hanno prodotto l'evidenza in `src/lib/tenants.ts`), le policy del bucket `media` vanno riferite
alla migration **054** (non alla 048), e 4 finding di rev. 1 sono stati scartati con
motivazioni puntuali (elenco in fondo).

**Esito finale**: 2 finding alti, 21 medi, 27 bassi confermati (50 finding unici dopo
deduplicazione dei 107 verdetti positivi). 11 finding scartati.

---

## 🟠 ALTA

### 1. Escalation di privilegio: ogni utente può auto-promuoversi a `super_advisor`
**File**: `supabase/migrations/20260417_000_baseline_schema.sql:5707`

La policy RLS `profiles_own_update` su `user_profiles` è:
```sql
CREATE POLICY "profiles_own_update" ON user_profiles AS PERMISSIVE FOR UPDATE
  USING ((id = auth.uid()));
```
Nessuna protezione di colonna: nel repo non esistono REVOKE/GRANT per colonna su
`user_profiles` e l'unico trigger (`trg_user_profiles_updated`, `:4931`) imposta solo
`updated_at`. Un utente autenticato può quindi fare PATCH via PostgREST sulla propria riga con
`{"role":"super_advisor"}`. (Nota tecnica: l'assenza di `WITH CHECK` non è il difetto — Postgres
applica la `USING` anche alle righe nuove — il buco è la mancanza di protezione sulle colonne
`role`/`company_id`.) Impatto:

- `TicketAdmin.tsx:87` gate admin con `profile?.role === 'super_advisor'` (letto da `user_profiles`);
- la edge function `ticket-resolve-now/index.ts:334-346` autorizza leggendo `user_profiles.role`;
- `get_my_role()` (baseline `:3514`, SECURITY DEFINER) legge `role FROM user_profiles` ed è usata
  da decine di policy RLS di scrittura (suppliers, yapily, ecc.) → l'escalation bypassa l'intero
  RBAC del DB, non solo i ticket.

Severità **alta** (non critica): l'exploit richiede un insider autenticato di un tenant (2-3
utenti noti per tenant, DB separati, nessuna esposizione anonima o cross-tenant), ma resta una
privilege escalation completa su un sistema finanziario in produzione.

**Fix proposto**: migration (da applicare a mano sui 3 tenant) con trigger `BEFORE UPDATE` che
rigetta cambi di `role`/`company_id` se il chiamante non è super_advisor, oppure grant per
colonna che limiti l'UPDATE self-service alle sole colonne di profilo (nome, telefono).

### 2. Selezione bulk admin mai azzerata al cambio filtri: azioni distruttive su ticket non visibili
**File**: `src/pages/Ticket.tsx:654` (stato `selectedIds`), `:783` (bulk bar), `TicketAdmin.tsx:533-543` (Cancella)

`selectedIds` in `TicketList` non viene mai svuotato quando cambiano `filtroStato` /
`filtroTipo` / `filtroModulo` (l'unico useEffect, `:657`, reagisce solo a `initialStato`) né
quando la lista viene ricaricata. Scenario: l'admin fa "Seleziona tutti" sul filtro default,
passa al filtro "Chiuso": le righe selezionate spariscono dalla vista ma restano selezionate,
la barra bulk resta visibile e **Cancella** (DELETE definitivo con rimozione preventiva degli
allegati dallo storage, `TicketAdmin.tsx:279-282` — persi anche se la DELETE poi fallisse)
colpisce ticket che l'utente non sta vedendo. La conferma mostra solo il conteggio, che può
per caso coincidere con le righe visibili nel nuovo filtro, rafforzando l'equivoco. Anche
l'icona "seleziona tutti" (`:810`) confronta `selectedIds.size === filtered.length` e mostra
stato incoerente. Con `tickets` tra le tabelle protette dalla regola NO DATA LOSS, è il finding
più rischioso della sezione.

**Fix**: `useEffect(() => setSelectedIds(new Set()), [filtroStato, filtroTipo, filtroModulo])`
+ passare alla bulk bar solo l'intersezione `selectedIds ∩ filtered`; nel modal di conferma
elencare i titoli dei ticket coinvolti.

---

## 🟡 MEDIA

### 3. "Risolvi con AI" usa `VITE_SUPABASE_URL` grezza: bottone rotto (o tenant sbagliato) su Made/Zago
**File**: `src/pages/Ticket.tsx:1135-1136`

`risolviConAI` fa `fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ticket-resolve-now`)`
bypassando la risoluzione tenant. `src/lib/tenants.ts` (readEnv `:34-40`, buildConfig `:71-77`)
mostra che sui site Made/Zago la configurazione attesa sono le env **suffissate**
`VITE_SUPABASE_URL_MADE`/`_ZAGO`: la var legacy grezza è quindi `undefined` (bottone sempre
rotto) o, se definita, instrada verso il progetto sbagliato — nel qual caso il JWT verrebbe
comunque rifiutato con 401, senza leak cross-tenant. Il client condiviso (`src/lib/supabase.ts`)
usa correttamente `getCurrentTenant()`; questo è l'unico punto della sezione che devia, in
violazione del divieto CLAUDE.md n.5 (mai valori tenant-specifici hardcoded).
**Fix**: costruire l'URL da `getCurrentTenant().supabaseUrl` (o esporre l'URL dal modulo
`lib/supabase.ts`) mantenendo la fetch raw per leggere il body d'errore.

### 4. Bucket `media`: INSERT/UPDATE/DELETE aperti a ogni autenticato non-viewer su tutto il bucket
**File**: `supabase/migrations/20260703_054_viewer_readonly_role.sql:53-66` (policy vigenti; la 108 ha ristretto solo la SELECT)

Le policy attuali (ricreate dalla 054) aggiungono solo l'esclusione del ruolo `viewer`:
per qualunque altro utente autenticato (Sabrina e Veronica sono `contabile`) INSERT, UPDATE e
DELETE restano aperti su **tutto** il bucket, senza scoping per path (`tickets/<id>/...`) né
legame con l'owner. Una chiamata diretta `supabase.storage.from('media').remove([...])` può
cancellare irreversibilmente tutti gli allegati dei ticket; il client usa `upsert: true` su
path prevedibili (`Ticket.tsx:420-423`), quindi anche la sovrascrittura di file altrui è
possibile. La UI riserva la rimozione allegati ai percorsi admin, quindi la RLS è l'unica
barriera — ed è assente. Exploit solo da insider/account compromesso via API diretta.
**Fix**: policy con scoping per proprietario/prefisso su UPDATE/DELETE (o DELETE riservato a
super_advisor via `get_my_role()`), migration sui 3 tenant.

### 5. Bulk admin "Prendi in carico" applicabile a ticket in qualsiasi stato
**File**: `src/pages/TicketAdmin.tsx:139-159`
`bulkUpdateStato` non filtra per stato di partenza: selezionando ticket risolti/chiusi (filtri
"Risolto"/"Chiuso"/"Tutti"), "Prendi in carico" produce transizioni `chiuso→in_corso` /
`risolto→in_corso` mai offerte dal dettaglio e azzera `risolto_il` in blocco, senza conferma.
**Fix**: filtrare gli id per stato compatibile prima dell'update e segnalare nel toast quanti
ticket sono stati saltati.

### 6. La edge function non verifica lo stato del ticket: i chiusi possono essere "ri-risolti"
**File**: `supabase/functions/ticket-resolve-now/index.ts:354-360`, `TicketAdmin.tsx:166-206`
Il handler non controlla mai `ticket.stato`: un ticket "chiuso senza lavorare" può essere
processato e forzato a `risolto` (`:445-452`), in contraddizione con la promessa del modal di
chiusura ("Le segnalazioni chiuse non vengono più processate da AutoFix", `Ticket.tsx:1294`).
Raggiungibile dalla UI: `bulkResolveViaAI` non filtra per stato.
**Fix**: rifiuto esplicito per stati `chiuso`/`risolto` a inizio handler + filtro client in
`bulkResolveViaAI` (solo `aperto`/`in_corso`).

### 7. Lost update sui commenti: read-modify-write dell'intero array JSONB (client e server)
**File**: `src/pages/Ticket.tsx:1088-1094`, `TicketAdmin.tsx:216-247`, `ticket-resolve-now/index.ts:427-452, 468-476`
Tutti i percorsi che aggiungono un commento riscrivono l'intero array `commenti` a partire da
uno snapshot: due scritture concorrenti (utente + AutoFix, o due admin) si sovrascrivono a
vicenda e i commenti spariscono in silenzio. Corollario (confermato anche dal verificatore
permessi): qualunque utente può di fatto alterare/cancellare commenti altrui, inclusi quelli
AI, riscrivendo l'array. Due verificatori su cinque hanno valutato il finding "alta".
**Fix**: RPC `append_ticket_comment(p_ticket_id, p_commento)` che fa
`SET commenti = commenti || p_commento` atomicamente, usata da client e edge function.

### 8. Schema e RLS della tabella `tickets` assenti dal repo (schema drift)
**File**: `supabase/migrations/20260526_047_tickets_allegati_multipli.sql:6` (solo ALTER; nessun CREATE TABLE nel repo), `src/types/ticket.ts:3`
La tabella `tickets` non è versionata: default, vincoli, FK (`autore_id`?), trigger
`aggiornato_il` e soprattutto le **policy RLS** (chi può UPDATE/DELETE?) non sono verificabili
né riproducibili su un tenant nuovo. Conseguenza frontend: `tickets` manca dai tipi generati e
tutta la sezione usa cast `as never` (`from('tickets' as never)`), azzerando la type-safety.
Il gate admin sul DELETE è verificabile solo lato client (`profile?.role === 'super_advisor'`).
Due verificatori su cinque hanno valutato il finding "alta".
**Fix**: migration di consolidamento con `CREATE TABLE IF NOT EXISTS tickets` completo di RLS
esplicite (DELETE solo super_advisor) + rigenerazione tipi TS eliminando gli `as never`.

### 9. Riapertura + nuova risoluzione AI: riuso silenzioso del branch autofix stantio
**File**: `supabase/functions/ticket-resolve-now/index.ts:171-182, 414-416`
`branchName = autofix-ticket-<shortId>` è deterministico e `createBranch` tratta il 422
"already exists" come successo: alla seconda risoluzione dello stesso ticket il branch vecchio
(basato su un main stantio) viene riusato, con commit/PR che falliscono o portano diff sporchi.
**Fix**: suffisso timestamp nel nome branch, oppure delete+ricreazione del ref se già esistente.

### 10. Cooldown "Risolvi con AI" congelato: bottone disabilitato oltre i 60s
**File**: `src/pages/Ticket.tsx:1109-1116, 1319-1327`
`lastAiCommentAgeSec` è un `useMemo` su `[ticket.commenti]` che legge `Date.now()`: il tempo
che passa non invalida il memo e nel dettaglio non esiste alcun tick che re-renderizzi. Dopo
"Risolvi con AI" il bottone resta "Attendi Xs" e disabilitato a tempo indeterminato finché non
cambia `commenti` o si ricarica. Bug sistematico a ogni uso del flusso.
**Fix**: tick locale da 1s attivo solo in cooldown (pattern già usato in `AutoFixCountdown`,
`:889-893`) e calcolo dell'età da quello stato.

### 11. Risposta Claude non validata: `stop_reason`/`action` non controllati; moduli grandi irrisolvibili
**File**: `supabase/functions/ticket-resolve-now/index.ts:294-314`
`max_tokens: 16000` (`:273`) con richiesta del file INTERO, ma `stop_reason` non è mai
controllato e `action` non è validato contro l'enum. Le dimensioni reali dei file in
`MODULE_TO_PATH` aggravano il problema: TesoreriaManuale.tsx 3833 righe, BudgetControl 3308,
ContoEconomico 3129, Dipendenti 3001, Outlet 2355, Cashflow 2162 — la maggioranza eccede i 16k
token di output, quindi un "fix" su questi moduli satura `max_tokens` e può produrre contenuto
troncato committato su branch e proposto in PR, col ticket marcato `risolto` verso utenti non
tecnici. Mitigazione a valle: la CI esegue `npm run build` sulle PR (un file troncato fa
fallire la build) e il merge è manuale — il danno residuo è una feature AutoFix di fatto
inutilizzabile sui moduli grandi, PR rotte e ticket falsamente risolti.
**Fix**: validare `stop_reason` e l'enum di `action`; rifiutare con messaggio chiaro i file
oltre soglia.

### 12. AutoFixCountdown hardcoda il cron NZ (":07") su tutti i tenant
**File**: `src/pages/Ticket.tsx:885-921`
Il countdown assume "ogni ora al minuto :07" per tutti e 3 i tenant (frontend condiviso): su
Made/Zago l'orario mostrato può essere falso. Viola lo spirito del divieto di valori hardcoded
tenant-specifici. (Il messaggio "Admin: usa 'Risolvi con AI'" mostrato a tutti è trattato nel
finding 40.)
**Fix**: leggere il minuto del cron da configurazione (es. `system_deploy_config`).

### 13. Nessuna notifica agli admin alla creazione di un ticket
**File**: `src/pages/Ticket.tsx:389-456`
La creazione non genera alcuna notifica (campanella, badge, email): gli admin scoprono i nuovi
ticket solo visitando la pagina. Il badge sidebar esiste solo per l'**autore**. Un ticket
urgente di Sabrina può restare invisibile per ore.
**Fix**: badge conteggio "aperti" per i super_advisor sulla voce Admin Segnalazioni, o
inserimento in `NotificationBell`.

### 14. Nessun realtime né polling sulle liste
**File**: `src/pages/Ticket.tsx:1506-1522`
La lista si aggiorna solo con "Aggiorna" manuale o remount. Aggiornamenti di altri utenti o
dell'AutoFix non compaiono; lo stato stantio alimenta le race dei finding 5/7 e il finding 28.
**Fix**: subscription Supabase Realtime su `tickets` (o polling leggero 60s).

### 15. Lista senza `.limit()`/paginazione: tetto implicito di 1000 righe non gestito
**File**: `src/pages/Ticket.tsx:1509-1514`, `TicketAdmin.tsx:93-98`
`select('*')` senza range: PostgREST tronca a 1000 righe in silenzio — stat card, filtri
client-side e "Esporta CSV" lavorerebbero su un dataset parziale spacciato per completo (tema
del commit #315). Collegato: la vista dettaglio carica l'intera tabella per fare
`find(t => t.id === ticketId)` (`:1536`) — un ticket oltre il tetto risulterebbe "non trovato".
**Fix**: nel dettaglio fetch singolo per id; in lista `.range()` o gestione esplicita del tetto.

### 16. Errore di rete indistinguibile da "nessun ticket" / "segnalazione cancellata"
**File**: `src/pages/Ticket.tsx:792-796, 1549-1567`
Se `load()` fallisce, il toast è transitorio e la UI persiste in stato vuoto: la lista mostra
"Nessun ticket corrisponde ai filtri" e il dettaglio "La segnalazione richiesta non esiste o è
stata cancellata" — falso e allarmante per un utente non tecnico. Nessun bottone Riprova.
**Fix**: stato `error` distinto da `empty` con messaggio in italiano e bottone "Riprova"
(pattern del commit #316, qui non applicato).

### 17. Errore ignorato sull'UPDATE che collega gli allegati: allegati persi con toast di successo
**File**: `src/pages/Ticket.tsx:432-439`
Dopo l'upload, `const { data: updated } = await supabase...update({ allegati })` non controlla
`error`: se l'update fallisce, i file restano orfani nello storage, il ticket risulta senza
allegati e l'utente vede "Segnalazione aperta correttamente".
**Fix**: controllare `error` e avvisare, eventualmente ritentare.

### 18. Filtri persi aprendo il dettaglio o ricaricando
**File**: `src/pages/Ticket.tsx:651-653`
I filtri vivono nello state di `TicketList`: aprire un ticket e tornare indietro resetta sempre
a "Da lavorare". Flusso frequente (scorrere i risolti uno a uno) molto penalizzato.
**Fix**: filtri in query string (`useSearchParams`) o in sessionStorage.

### 19. Dropdown "Modulo" con nomi hardcoded non allineati alle etichette dinamiche del tenant
**File**: `src/types/ticket.ts:82-106`
`TICKET_MODULI` hardcoda "Outlet"/"Confronto Outlet" su tutti i tenant, mentre la sidebar usa
`useCompanyLabels`: incoerenza terminologica per gli utenti di Made/Zago. Attenzione:
`MODULE_TO_PATH` nella edge function è chiavato sugli stessi nomi, quindi la label visuale va
disaccoppiata dal valore salvato.
**Fix**: label dinamiche nel dropdown mantenendo come valore la chiave canonica.

### 20. Export CSV senza BOM UTF-8 e reimplementato a mano
**File**: `src/pages/TicketAdmin.tsx:384-404`
Il CSV è generato senza BOM: Excel lo apre come ANSI e corrompe le lettere accentate di
titoli/descrizioni italiane — proprio il caso d'uso dell'admin. Esiste `ExportMenu` condiviso
non riusato.
**Fix**: anteporre `﻿` al contenuto o riusare il componente condiviso.

### 21. Modal "Nuova segnalazione" con parte alta tagliata su schermi bassi
**File**: `src/pages/Ticket.tsx:459-460`
Contenitore `fixed inset-0 flex items-center justify-center ... overflow-y-auto` con figlio
`my-8`: quando il contenuto supera l'altezza del viewport (form + allegati, o tastiera mobile),
il flexbox centrato taglia la parte alta e la rende irraggiungibile allo scroll (bug CSS noto).
**Fix**: `m-auto` sul figlio oppure `items-start` + `max-h` con scroll interno.

### 22. Mobile: tabella a 8-9 colonne senza layout a card e input che causano lo zoom iOS
**File**: `src/pages/Ticket.tsx:798-877` (tabella), `:521-541` e select vari (input `text-sm`)
Su viewport 360-430px la tabella è solo scrollabile orizzontalmente: la colonna "Fase" e le
altre chiave sono fuori schermo, nessuna variante a card. Gli input e le select usano
`text-sm` (14px) e `text-xs` (12px): iOS Safari fa auto-zoom al focus, sballando il layout.
**Fix**: layout a card sotto `sm:`; `text-base` (16px) sugli input su mobile.

### 23. Modali senza semantica dialog, senza focus management e senza Esc
**File**: `src/pages/Ticket.tsx:135-167, 458-593`, `TicketAdmin.tsx:581-730`
Tutti i modali sono `div` plain: niente `role="dialog"`/`aria-modal`, nessun focus trap, il
focus non viene spostato all'apertura né restituito alla chiusura, Esc non chiude (solo il
Lightbox lo gestisce).
**Fix**: estrarre un componente Modal condiviso con `role="dialog"`, `aria-modal`, focus trap
ed Esc.

---

## 🟢 BASSA

### 24. Cambio stato senza guardia sullo stato corrente (race con AutoFix)
`Ticket.tsx:1052-1074`: `aggiornaStato` senza `.eq('stato', statoAtteso)`; con dettaglio aperto
durante un run AutoFix, "Prendi in carico" può regredire un ticket appena risolto e azzerare
`risolto_il` (`:1057`). Ricalibrato a bassa dal verificatore: finestra stretta, danno limitato
a metadati di workflow, reversibile, auto-evidente. Fix a costo quasi nullo: guardia ottimistica
`.eq('stato', ticket.stato)` + toast se 0 righe.

### 25. Chiusura incoerente su `risolto_il`
`TicketAdmin.tsx:240-242` vs `Ticket.tsx:1055-1057`: "Chiudi" dal dettaglio conserva il
timestamp, "Chiudi senza lavorare" bulk lo azzera anche sui ticket già risolti (perdita del
dato storico). Fix: non toccare `risolto_il` alla chiusura.

### 26. `jsonError` risponde sempre HTTP 200
`ticket-resolve-now/index.ts:481-490`. I rami client su `resp.ok`/429 (`Ticket.tsx:1148-1156`)
sono codice morto; monitoraggio HTTP cieco; il messaggio 403 rivela il ruolo del chiamante.
Fix: ripristinare gli status reali (il client dettaglio legge già il body via fetch raw).

### 27. Bulk "Risolvi con AI" usa `functions.invoke` che nasconde l'errore reale
`TicketAdmin.tsx:176`: il dettaglio usa fetch raw proprio per leggere il body d'errore
(commento a `Ticket.tsx:1126-1128`); il bulk no — ogni errore (incluso il cooldown 429) diventa
un anonimo "risposta inattesa" e il messaggio reale (`data.error`) non viene mai letto. Il bulk
inoltre non applica il controllo client dei 60s. Fix: estrarre la chiamata condivisa in un
modulo e riusarla in entrambi i percorsi.

### 28. Dettaglio in crash se `commenti` è NULL nel DB
`Ticket.tsx:1425-1434`: `ticket.commenti.length`/`.map` senza null-guard, in contrasto col
resto del modulo (`?? []` ovunque) e col tipo della edge function (`commenti: ... | null`).
Fix: `const commenti = ticket.commenti ?? []`.

### 29. Regola NO DATA LOSS affidata solo al prompt + prompt injection teorica
`ticket-resolve-now/index.ts:228-270`: titolo/descrizione interpolati verbatim nel prompt del
modello che genera il file committato in PR; la regola NO DATA LOSS è imposta solo via prompt,
senza validazione programmatica dell'output. Mitigazioni robuste verificate: invocazione solo
super_advisor, output confinato a un file su branch+PR, review umana prima del merge. Fix di
hardening a costo quasi zero: delimitare il testo utente come non fidato + check programmatico
sull'output (`.delete(`, `DROP`, ecc.).

### 30. Errori best-effort ingoiati lato server e client
`ticket-resolve-now/index.ts:468-476` (`appendCommentToTicket` ignora l'errore dell'UPDATE:
commento AI perso in silenzio), `:105-130` (`pickFilePathViaClaude` maschera guasti Anthropic
da "file non identificabile"), `Ticket.tsx:1173-1178` (refresh post-AI senza gestione errore),
`:1202-1205` (pulizia storage solo console). Fix: log strutturato + propagare dove l'esito
cambia il messaggio all'utente.

### 31. Nessun timeout/AbortSignal sulle fetch verso Anthropic e GitHub
`ticket-resolve-now/index.ts:106, 141-152, 294-302`. Fix: `AbortSignal.timeout(30_000)`.

### 32. Filtro Modulo inefficace sui ticket importati
`TicketAdmin.tsx:319, 328`: l'import accetta `modulo` come testo libero (nessuna validazione
contro `TICKET_MODULI`, match case-sensitive): un ticket importato con "banche" non compare mai
nel filtro Modulo e non è mappato da `MODULE_TO_PATH`. Fix: normalizzare/validare in import.

### 33. Nessuna ricerca testuale; la guida promette "cercare"
`Ticket.tsx:745-780`, `src/data/pageGuides.ts` voce `/ticket` ("Filtrare e cercare le
segnalazioni"). Nessun ordinamento per colonna (esiste `useTableSort` non usato); ordine
instabile a parità di `creato_il`. Fix: campo di ricerca client-side o correzione della guida.

### 34. `initialStato`: meccanismo orfano
`Ticket.tsx:633, 651-659, 1500`: nessun chiamante passa `location.state.initialStato`; tipi
incoerenti. Fix: rimuovere o collegare a un banner reale.

### 35. Badge "ticket-unseen" con falsi positivi sulle azioni dell'utente stesso
`20260526_049_tickets_resolution_tracking.sql:31-42` + `Ticket.tsx:1004-1011`: commentare il
proprio ticket accende il badge per la propria azione. Fix: `mark_ticket_seen` anche dopo
l'invio di un commento proprio.

### 36. Il paste da clipboard bypassa la validazione client degli allegati
`Ticket.tsx:354-379`: `handlePaste` non passa da `validateAndAdd` (tipo/10MB). Mitigato lato
server dai limiti del bucket, ma l'errore arriva tardi e in forma generica. Fix: riusare
`validateAndAdd`.

### 37. `URL.createObjectURL` chiamato nel render della DropZone, mai revocato
`Ticket.tsx:297`: nuovi blob URL a ogni re-render per ogni immagine, mai revocati. Leak
contenuto alla vita del modal. Fix: memoizzare per file e revocare su unmount/rimozione.

### 38. URL firmati rigenerati a ogni update; fallimento firma = spinner infinito
`Ticket.tsx:1016-1045`: dipendenze non stabili rifirmano tutti gli allegati a ogni `onUpdated`;
se `createSignedUrl` fallisce senza `url` legacy, la thumbnail resta uno spinner permanente
senza messaggio né retry. Fix: cache per path + stato d'errore visibile.

### 39. Errori tecnici raw di Supabase (in inglese) nei toast
`src/types/business.ts:113-119`: `errorMessage` passa il messaggio originale al toast,
incomprensibile per utenti non tecnici. Fix: mappa dei codici comuni → messaggi italiani.

### 40. Messaggio per admin mostrato a tutti + refusi e gergo in UI
`Ticket.tsx:917` ("Admin: usa 'Risolvi con AI'" visibile anche a Sabrina/Veronica),
`TicketAdmin.tsx:451` ("esport CSV"), `:414` ("riservato ai super_advisor" — ruolo tecnico
esposto). Fix: testo condizionale al ruolo; "export CSV"; "riservato agli amministratori".

### 41. Chiudere il modal di creazione scarta il testo digitato senza conferma
`Ticket.tsx:345-350`: X o Annulla cancellano titolo/descrizione/allegati senza conferma (il
backdrop non chiude, il che limita gli incidenti). Fix: conferma se il form è "sporco".

### 42. Stat card "Aperti" contraddice l'etichetta ufficiale "In attesa"
`Ticket.tsx:736` vs `src/types/ticket.ts:58-65` (che vieta "Aperto" come label visiva).
Fix: rinominare la card "In attesa".

### 43. Tastiera: righe tabella e DropZone inaccessibili
`Ticket.tsx:830-837` (dettaglio apribile solo via `onClick` su `<tr>`), `:251-265` (DropZone
`div` con `onClick` e input nascosto). Fix: titolo come link/bottone; `role="button"` +
`tabIndex` + handler tastiera sulla DropZone.

### 44. Attributi ARIA, contrasto e icone senza testo
`Ticket.tsx:924-944` (PillButton senza `aria-pressed`), `:841-850` (checkbox custom senza
`role`/`aria-checked`), `:270-274` (testi `text-slate-400` a 10px, contrasto ~3:1), `:853-856`
(tipo Bug/Funzione solo icona in tabella), `:521-541` (label senza `htmlFor`/`id`, textarea
commento senza nome accessibile). Fix: attributi ARIA, `text-slate-500`+, `sr-only`.

### 45. Mobile: touch target sotto i 44px e modali secondari senza scroll
Pillole filtro e bulk bar `py-1.5 text-xs` (~30px), checkbox selezione ~20px dentro righe
cliccabili (mitigata da `data-select-cell`), modali secondari (`TicketAdmin.tsx:660-701`) senza
`max-h`/scroll con tastiera aperta, badge countdown in pillola che degrada su 360px.
Fix: target minimi 44px, `max-h`+`overflow-y-auto` nei modali.

### 46. Doppia fonte di verità per i ruoli
`src/hooks/useRole.tsx:21-33` legge dal JWT (noto come rotto su NZ per encoding, vedi commento
in `ticket-resolve-now/index.ts:334-337`), la sezione Ticket usa `profile.role` da
`user_profiles`. Fix: standardizzare su `user_profiles.role`.

### 47. `autore_id` nullable senza FK verificabile e autore denormalizzato
`src/types/ticket.ts:47`, `Ticket.tsx:387, 402`: `autore_id` può essere NULL e la FK non è
verificabile (schema non versionato, vedi finding 8); `autore` è una stringa denormalizzata.
Ticket senza `autore_id` sono esclusi da badge e `mark_ticket_seen`. Fix: nella migration di
consolidamento, FK verso `auth.users` e backfill.

### 48. URL allegato letto dal DB usato come fallback diretto in `href`/`src`
`Ticket.tsx:1037, 1040, 1396`: gli `url` legacy dal DB finiscono in `href`/`src` senza
validazione dello schema. Sfruttabile solo con accesso in scrittura al DB; hardening a costo
minimo: accettare solo `https:`.

### 49. Tipo `TicketRow` della edge function divergente: allegati nuovi come "undefined" nel prompt
`ticket-resolve-now/index.ts:78, 262`: il tipo non ha `path` e il prompt mappa `a.url`, che per
gli allegati nuovi è undefined → "**Allegati**: undefined". Fix: `a.path ?? a.url ?? a.name`.

### 50. Nessun indice su `stato`/`creato_il` e `select('*')` che scarica i JSONB di tutti i ticket
`20260526_049_...sql` (solo `idx_tickets_autore_aggiornato`), `Ticket.tsx:1509-1514`
(`select('*')` porta commenti/allegati/note_fix di tutta la tabella in lista). Irrilevante alla
scala attuale; da sistemare insieme alla paginazione (finding 15) selezionando colonne e
aggiungendo indici sulle colonne filtrate.

### 51. Codice morto e duplicazioni interne
`Ticket.tsx:950-975` (`FilterChip` mai usato), `:27, :37` (import `ImageIcon`,
`TICKET_TIPO_LABEL` inutilizzati); `TicketAdmin.tsx:705-730, 735-741, 39-49` duplicano
ConfirmModal, `PageShell` e `formatDate` di `Ticket.tsx`; componenti condivisi esistenti
(`EmptyState`, `PageHeader`) reinventati localmente. Fix: pulizia + modulo condiviso di sezione.

### 52. "Apri ticket" dalla vista admin non apre il modal di creazione
`TicketAdmin.tsx:461`: `onCreate={() => navigate('/ticket')}` porta alla lista e basta.
Fix: navigare con state che apra il modal.

### 53. Repo GitHub condiviso fra i tenant: branch AutoFix senza indicazione del tenant
`ticket-resolve-now/index.ts:413-414`: i branch `autofix-ticket-<shortId>` dei 3 tenant
convivono nello stesso repo senza distinguere l'origine (gli UUID rendono la collisione
impossibile; il problema operativo reale è il riuso stantio, finding 9). Fix: prefisso tenant
nel nome branch per tracciabilità.

---

## Finding scartati dalla verifica avversariale (falsi positivi / già mitigati)

| Finding proposto | Motivo dello scarto |
|---|---|
| "CORS `Access-Control-Allow-Origin: *` su endpoint amministrativo" | Pattern standard delle edge function Supabase; la barriera è JWT + ruolo super_advisor. |
| "`key={i}` instabile nella timeline AutoFix" | Elementi completamente stateless (testo + navigazione): il rendering resta corretto in ogni scenario; costo di riconciliazione irrilevante su 15 righe. Rischio solo ipotetico futuro. |
| "`tickets` senza `company_id` → isolamento a rischio" | Il design single-company-per-tenant è un ADR esplicito (migration 013): 3 progetti Supabase fisicamente separati, nessun percorso concreto di leak. Edge case condizionato a un cambio architetturale deliberato. |
| "Export CSV vulnerabile a formula injection" | Scrittura dei campi riservata a 2-3 utenti interni fidati; export solo admin; Excel moderno mitiga DDE con avvisi bloccanti. Hardening da una riga accettabile ma non un finding di sicurezza qui. |
| "Ricarico completo della lista dopo ogni operazione bulk" | Il refetch è qui il pattern più corretto: le azioni bulk modificano righe lato server (commenti AI, stati) che il client non conosce; patch locali duplicherebbero logica col rischio di divergenza. Costo irrilevante alla scala reale. |
| "Route lista/dettaglio separate → remount e refetch a ogni navigazione" | Premessa errata su React Router 6: route sorelle con lo stesso elemento **non** smontano il componente; lo stato persiste e `load()` gira una volta per ingresso nella sezione (verificato: `toast` è stabile). |
| "N+1 update sequenziali in 'Chiudi senza lavorare'" | Pattern riga-per-riga deliberato e necessario (commenti diversi per riga, PostgREST non supporta update bulk per-riga); fallimento a metà benigno e ritentabile; volumi minimi. |
| "TOCTOU in bulkCloseWithoutWork come finding autonomo" | Stessa causa radice del lost update sui commenti (finding 7); accorpato. |
| "Collisione branch AutoFix tra tenant" | Gli id ticket sono UUID; l'aspetto reale è il riuso stantio (finding 9) e la tracciabilità (finding 53). |
| "XSS `javascript:` via URL allegato" (come sicurezza alta) | Richiede già accesso in scrittura al DB; declassato a hardening (finding 48). |
| "Bulk 'Riapri' come transizione invalida" | Il dettaglio offre Riapri sia da risolto sia da chiuso con la stessa logica: comportamento coerente. Resta valida solo la parte su "Prendi in carico" (finding 5). |

---

## Nota sul processo

Prima esecuzione: 16 auditor completati (114 finding grezzi), verifica avversariale interrotta
dal limite di spesa dopo 8 verdetti; i restanti verificati manualmente (rev. 1). Seconda
esecuzione (resume dello stesso run, auditor e verdetti esistenti dalla cache): i 106
verificatori mancanti hanno completato il lavoro — 130 agenti totali, 0 errori. La rev. 2
recepisce integralmente i verdetti dei verificatori; dove più verificatori hanno giudicato lo
stesso finding (duplicati tra aree), la severità adottata è quella maggioritaria. I verdetti
hanno anche corretto due errori della verifica manuale di rev. 1: il finding
`VITE_SUPABASE_URL` (scartato a torto: l'evidenza è in `src/lib/tenants.ts`) e il riferimento
alle policy del bucket `media` (la migration vigente è la 054, non la 048).
