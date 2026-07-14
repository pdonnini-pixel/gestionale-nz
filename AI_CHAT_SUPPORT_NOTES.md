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

## Possibile evoluzione (fase 2, non inclusa)
Far rispondere l'AI anche sui dati reali del tenant ("quanto devo a X?"): richiede
accesso DB con RLS e va valutato a parte per rischi/costi.
