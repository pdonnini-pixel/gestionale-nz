# AI Chat Support — Assistente contestuale in ogni pagina

## Cosa fa
Nel pannello di aiuto (bottone `?` in basso a destra, presente su **ogni pagina**)
è stata aggiunta una tab **"Chiedi all'AI"**: l'operatrice fa una domanda su
*come funziona* il gestionale e Claude risponde in italiano semplice, tenendo
conto della pagina in cui si trova.

- Tab **Guida** (esistente): descrizione + suggerimenti + FAQ statiche.
- Tab **Chiedi all'AI** (nuova): chat libera. Sulle pagine senza guida statica
  il pannello apre direttamente la chat, così l'assistente è disponibile ovunque.

## Sicurezza (per progetto)
- La chiave Anthropic resta nel **Vault** (RPC `get_anthropic_api_key`), mai nel
  frontend. La edge function `help-chat` fa da proxy, stesso pattern di
  `ticket-resolve-now`.
- L'AI **non vede i dati aziendali** (non tocca il DB) e ha istruzioni esplicite
  di **non proporre mai** cancellazioni/modifiche dati o SQL (regola NO DATA LOSS).
- Auth: solo utenti autenticati del tenant.
- Modello: `claude-haiku-4-5` (economico). `max_tokens` 800, storia limitata alle
  ultime 12 battute.

## File toccati
- `supabase/functions/help-chat/index.ts` — **nuova** edge function.
- `src/components/HelpPanel.tsx` — tab + chat UI (invoca `help-chat`).

## ⚠️ AZIONE MANUALE RICHIESTA — deploy edge function sui 3 tenant
Il frontend va da solo via Netlify dopo il merge. La **edge function** invece va
deployata a mano su tutti e 3 i tenant (regola parità tenant):

```bash
supabase functions deploy help-chat --project-ref xfvfxsvqpnpvibgeqpqp   # NZ
supabase functions deploy help-chat --project-ref wdgoebzvosspjqttitra   # Made
supabase functions deploy help-chat --project-ref jxlwvzjreukscnswkbjx   # Zago
```

Prerequisito su ogni tenant: la RPC `get_anthropic_api_key` deve restituire una
chiave valida dal Vault (già presente perché usata da `ticket-resolve-now`).
Nessuna migration DB necessaria.

---

# Chat tracciate e archiviate (migrazione 155, settembre 2026)

## Il problema
La chat viveva **solo nello stato React**: cambio pagina, chiusura del pannello o
ricarica del browser = domande e risposte perse per sempre. Nessuno storico,
nessun modo di risalire a cosa era stato chiesto e a cosa aveva risposto l'AI.

## Come funziona ora
- **La chat di una sezione resta APERTA finché è l'operatrice a chiuderla.**
  Non c'è nessuna chiusura automatica: cambio pagina, logout, ricarica e giorni
  di distanza non la toccano. Tornando in quella sezione si riprende la stessa
  conversazione, con tutto lo storico già caricato.
- **"Chiudi chat"** (barra di stato in cima alla chat, con conferma inline) è
  l'unico modo per archiviarla. Da quel momento la conversazione è congelata:
  resta leggibile ma non accetta più battute, e la domanda successiva in quella
  sezione apre automaticamente una chat nuova.
- **Terza tab "Le chat"**: elenco di tutte le conversazioni dell'azienda —
  aperte in cima, poi le archiviate — con filtri (Tutte / Aperte / Archiviate),
  ricerca su titolo, sezione e persona, e lettura integrale di domande e
  risposte. Dalle chat aperte proprie si può riprendere la conversazione
  (stessa sezione), saltare alla sezione giusta, o chiuderla da lì.

## Modello dati
| Tabella | Contenuto |
|---|---|
| `help_chat_sessions` | una riga per conversazione: `page_path`, `page_title`, `title` (prima domanda), `status` `'aperta'`/`'chiusa'`, `message_count`, `last_message_at`, `closed_at`/`closed_by` |
| `help_chat_messages` | le battute in ordine (`role` `'user'`/`'assistant'`, `content`) |

- **Una sola chat aperta per (azienda, utente, sezione)** — indice unico parziale
  `help_chat_sessions_one_open_per_page ... WHERE status='aperta'`. Se due schede
  del browser provano ad aprirla insieme scatta un 23505 e il frontend riprende
  quella già esistente (`createSession` in `src/lib/helpChat.ts`).
- Trigger `trg_help_chat_touch_session`: aggiorna contatore, ultima attività e
  valorizza `title` con la prima domanda troncata a 120 caratteri.

## Visibilità e RLS (scelta di Patrizio, 02/09/2026)
- **Lettura: tutta l'azienda.** L'archivio è una base di conoscenza condivisa.
- **Scrittura: solo l'autore, solo nella propria chat ancora aperta.** Verificato
  sul DB vivo: un altro utente che prova a scrivere prende `42501`, e dopo la
  chiusura nemmeno l'autrice può aggiungere battute.
- **Chiusura**: l'autore o il `super_advisor`.
- **Nessuna policy DELETE**: le chat non si cancellano (NO DATA LOSS).
- Il ruolo `viewer` (sola lettura sui dati) **può** comunque fare le proprie
  domande: qui non si scrivono dati contabili.

## File toccati (fase 2)
- `supabase/migrations/20260902_155_help_chat_sessions.sql` (+ `_ROLLBACK`)
- `src/lib/helpChat.ts` — **nuovo**, accesso dati (sessioni, messaggi, chiusura)
- `src/components/HelpPanel.tsx` — chat persistente + tab archivio
- `src/types/database.ts` — tipi delle 2 nuove tabelle
- `src/data/pageGuides.ts` — FAQ sulla chat che resta aperta e sull'archivio

**Edge function `help-chat` NON toccata**: la persistenza è tutta lato frontend
(RLS con `auth.uid()`), quindi non serve alcun redeploy sui 3 tenant.

## Possibile evoluzione (fase 3, non inclusa)
Far rispondere l'AI anche sui dati reali del tenant ("quanto devo a X?"): richiede
accesso DB con RLS e va valutato a parte per rischi/costi.
