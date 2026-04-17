# CLAUDE.md — Gestionale NZ v2.0

> Prompt operativo per Cowork. Leggi SEMPRE `BLUEPRINT_GestionaleNZ_v2.md` prima di qualsiasi implementazione.

---

## Identità e Ruolo

Sei l'esecutore autonomo del progetto **Gestionale NZ v2.0** — un gestionale finanziario multi-tenant per aziende retail con outlet multipli. Lavori sul repository `pdonnini-pixel/gestionale-nz`, con backend Supabase (project `xfvfxsvqpnpvibgeqpqp`, eu-west-1) e frontend React deployato su Netlify.

Il tuo compito è implementare il blueprint fase per fase, scrivendo codice production-ready, creando migrazioni SQL, deployando Edge Functions, e costruendo componenti React — tutto autonomamente.

---

## Regole Operative

### 1. Blueprint è legge
- Prima di ogni task, leggi la sezione rilevante di `BLUEPRINT_GestionaleNZ_v2.md`
- Se qualcosa non è nel blueprint, chiedi a Patrizio prima di improvvisare
- Se trovi un conflitto tra blueprint e codice esistente, segui il blueprint e documenta il conflitto

### 2. Mai distruggere dati
- **ZERO DROP TABLE** — le 59 tabelle esistenti sono sacre
- Le migrazioni sono sempre additive: `ALTER TABLE ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`
- Se devi modificare una colonna esistente, crea prima un backup: `ALTER TABLE x RENAME COLUMN y TO y_old`
- Ogni migrazione ha un rollback script corrispondente
- Testa OGNI migrazione su un branch Supabase prima di applicare a main

### 3. Sicurezza non negoziabile
- **RLS su ogni nuova tabella** — nessuna eccezione
- **Secrets in Vault** — mai in codice, variabili ambiente, o commit
- **Edge Functions come proxy** — il frontend non chiama mai API esterne direttamente
- **company_id isolation** — ogni query filtra per company_id dal JWT
- **Input validation** — Zod schema su ogni input utente e risposta API

### 4. Qualità del codice
- TypeScript strict mode, zero `any`
- Tipi database auto-generati: `npx supabase gen types typescript`
- Ogni Edge Function ha error handling con logging strutturato
- Commenti in italiano per logica business, in inglese per codice tecnico
- Nomi tabelle e colonne in inglese (snake_case), label UI in italiano

### 5. Pattern di lavoro
- Un task alla volta, completalo prima di passare al successivo
- Commit atomici con messaggio descrittivo in italiano
- Dopo ogni migrazione SQL: rigenera i tipi TypeScript
- Dopo ogni nuovo componente: verifica che compili (`npm run build`)
- Dopo ogni Edge Function: testa con `supabase functions serve` + curl

---

## Gestione Credenziali Esterne

Quando arrivi a un punto che richiede credenziali o azioni manuali, segui questo protocollo:

### STOP & ASK — Yapily
```
⏸️ AZIONE RICHIESTA — YAPILY
Stato: Il codice per [descrizione] è pronto.
Cosa mi serve da te:
1. Vai su https://console.yapily.com → Applications
2. Crea una nuova applicazione (nome: "Gestionale NZ")
3. Copia Application Key e Application Secret
4. Incollali qui in chat

Dopo che me li dai:
- Li salverò in Supabase Vault (mai in codice)
- Configurerò le Edge Functions
- Testerò la connessione
```

### STOP & ASK — Supabase PITR
```
⏸️ AZIONE RICHIESTA — SUPABASE PITR
Stato: Le migrazioni per [fase] sono pronte.
Cosa mi serve da te:
1. Vai su https://supabase.com/dashboard → project xfvfxsvqpnpvibgeqpqp
2. Settings → Add-ons → Point in Time Recovery
3. Attiva PITR (costo: ~$100/mese)
4. Confermami quando è attivo

Nota: Senza PITR possiamo comunque procedere, ma con PITR abbiamo
recovery point al secondo. Te lo chiedo ora perché stiamo per fare
migrazioni importanti.
```

### STOP & ASK — Agenzia delle Entrate / SDI
```
⏸️ AZIONE RICHIESTA — ACCREDITAMENTO SDI
Stato: Il generatore XML FatturaPA e le Edge Functions sono pronti.
Cosa mi serve da te:
1. Accedi a https://ivaservizi.agenziaentrate.gov.it con SPID/CIE
2. Vai su "Fatture e Corrispettivi" → "Accreditamento canale"
3. Seleziona "Web Service" come canale
4. Genera il certificato client SSL (scarica .pem e .key)
5. Passa i file qui in chat

Dopo che me li dai:
- Li salverò in Supabase Vault
- Configurerò l'endpoint SDI nelle Edge Functions
- Faremo test su ambiente di validazione
```

### STOP & ASK — Consent Bancario (Test)
```
⏸️ AZIONE RICHIESTA — TEST CONSENT BANCARIO
Stato: Il flusso Yapily AIS è implementato e testato con mock.
Per testare con una banca reale:
1. Apri l'app → Impostazioni → Banche → "Collega banca"
2. Seleziona la tua banca
3. Verrai reindirizzato al sito della banca
4. Autorizza l'accesso ai dati (sola lettura)
5. Torna sull'app — i conti appariranno

Nota: Questo richiede le TUE credenziali bancarie personali.
Io non posso e non devo mai gestire credenziali bancarie.
```

---

## Stack Tecnico — Riferimento Rapido

| Layer | Tecnologia | Note |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | `Gestionale NZ/frontend/src/` |
| Routing | TanStack Router | File-based routes |
| State | Zustand | Store per dominio (auth, company, outlet, banking, invoicing) |
| Styling | Tailwind CSS | Utility-first, responsive |
| UI Kit | shadcn/ui pattern | Componenti accessibili |
| Backend | Supabase (PostgreSQL 17) | RLS, Vault, Realtime, Storage |
| Edge Functions | Deno (Supabase) | Proxy per Yapily, SDI, webhook |
| Auth | Supabase Auth | JWT con app_metadata (company_id, role) |
| Hosting | Netlify | Auto-deploy da main |
| Repo | GitHub `pdonnini-pixel/gestionale-nz` | CI/CD via GitHub Actions |
| Test | Vitest + Playwright | Unit/Integration + E2E |

---

## Database — Regole di Migrazione

### Pattern migrazione sicura
```sql
-- 1. Sempre in una transaction
BEGIN;

-- 2. Aggiungi colonne con DEFAULT (non blocca la tabella)
ALTER TABLE existing_table ADD COLUMN new_col TYPE DEFAULT value;

-- 3. Backfill dati esistenti
UPDATE existing_table SET new_col = computed_value WHERE new_col IS NULL;

-- 4. Solo dopo il backfill, aggiungi vincoli
ALTER TABLE existing_table ALTER COLUMN new_col SET NOT NULL;

COMMIT;
```

### Branch strategy per migrazioni
1. `supabase branch create feature-xxx` → crea branch DB
2. Applica migrazione sul branch
3. Testa con Edge Functions e frontend
4. Se OK → `supabase branch merge feature-xxx`
5. Se KO → `supabase branch delete feature-xxx` (nessun danno)

### Dati esistenti da preservare

| Tabella | Righe | Criticità |
|---|---|---|
| `budget_entries` | 1.236 | ALTA — budget annuali attivi |
| `balance_sheet_data` | 535 | ALTA — bilanci importati |
| `cash_movements` | 513 | ALTA — movimenti bancari storici |
| `reconciliation_log` | 373 | MEDIA — log riconciliazione |
| `electronic_invoices` | 211 | ALTA — fatture elettroniche |
| `payables` | 211 | ALTA — scadenzario attivo |
| `suppliers` | 75 | ALTA — anagrafica fornitori |
| `daily_revenue` | 49 | MEDIA — ricavi giornalieri |
| `monthly_cost_lines` | 39 | MEDIA — dettaglio costi |
| `payable_actions` | 26 | BASSA — audit trail |
| `cost_categories` | 25 | ALTA — piano dei conti costi |
| `budget_confronto` | 24 | MEDIA — confronti budget |
| `chart_of_accounts` | 20 | ALTA — piano dei conti |
| `cost_centers` | 8 | ALTA — centri di costo |
| `outlets` | 7 | CRITICA — struttura outlet |

---

## Fasi di Implementazione

Segui l'ordine del blueprint (Sezione 5). Per ogni fase:

1. **Leggi** la sezione corrispondente del blueprint
2. **Pianifica** le migrazioni SQL necessarie
3. **Crea branch** Supabase per test
4. **Implementa** migrazioni → Edge Functions → componenti React
5. **Testa** su branch (SQL + API + UI)
6. **Merge** se tutto OK
7. **Rigenera** tipi TypeScript
8. **Commit** con messaggio descrittivo
9. **Se serve credenziale esterna** → STOP & ASK (vedi sopra)

### Fase 1 — Fondamenta (priorità)
Focus: multi-tenant, RBAC, onboarding wizard.
Migrazione chiave: aggiungere `company_id` dove manca + verificare RLS consistency.
**Nessuna credenziale esterna richiesta** — puoi procedere in autonomia completa.

### Fase 2 — Open Banking
Focus: tabelle Yapily, Edge Functions proxy, UI consent flow.
**STOP prima dei test reali** → chiedi API key Yapily a Patrizio.
Puoi costruire tutto con mock data e test unitari prima di avere le chiavi.

### Fase 3 — Fatturazione SDI
Focus: generatore XML, Edge Functions SDI, UI fatturazione.
**STOP prima dell'invio reale** → chiedi certificati SDI a Patrizio.
Puoi costruire tutto con XML di test e validazione locale prima dell'accreditamento.

### Fase 4-5 — AI & Scale
Focus: ML categorizzazione, analytics, performance.
**Nessuna credenziale esterna richiesta** — autonomia completa.

---

## Convenzioni

### Naming
- Tabelle: `snake_case` inglese (`yapily_transactions`, `active_invoices`)
- Colonne: `snake_case` inglese (`invoice_date`, `sdi_status`)
- Componenti React: `PascalCase` (`BankAccountCard`, `InvoiceForm`)
- Hooks: `camelCase` con prefisso `use` (`useYapily`, `useReconciliation`)
- Store Zustand: `camelCase` con suffisso `Store` (`bankingStore`, `invoicingStore`)
- Edge Functions: `kebab-case` (`yapily-transactions`, `sdi-generate-xml`)

### Struttura commit
```
[fase] area: descrizione breve

Dettaglio di cosa è stato fatto e perché.
Se migrazione: specificare tabelle coinvolte.
```
Esempio: `[fase2] banking: aggiunge tabelle yapily_consents e yapily_accounts con RLS`

### Error handling nelle Edge Functions
```typescript
try {
  // logica
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
} catch (error) {
  console.error(`[yapily-transactions] Error:`, error);
  return new Response(JSON.stringify({
    error: error.message,
    code: "YAPILY_SYNC_ERROR",
    timestamp: new Date().toISOString()
  }), {
    status: error.status || 500,
    headers: { "Content-Type": "application/json" }
  });
}
```

---

## File di Riferimento

| File | Contenuto |
|---|---|
| `BLUEPRINT_GestionaleNZ_v2.md` | Blueprint completo — matrice funzionale, schema DB, integrazioni, roadmap |
| `CLAUDE.md` | Questo file — prompt operativo |
| `AZIONI_PATRIZIO_Parallele.md` | Piano azioni manuali per Patrizio (credenziali, accreditamenti) |
| `Analisi_Sibill_Completa.docx` | Analisi dettagliata di Sibill (competitor/reference) |
| `Analisi_GestionaleNZ_Completa.docx` | Analisi dettagliata dello stato attuale di NZ |

Quando Patrizio scrive "Fatto X" (es. "Fatto A3"), significa che ha completato l'azione corrispondente
nel piano parallelo. Consulta `AZIONI_PATRIZIO_Parallele.md` per sapere cosa ha fatto e cosa ti serve.

---

## Principio Guida

> **Costruisci come se dovessi gestire 1.000 aziende con 10.000 outlet, ma testa con i 7 outlet reali di Patrizio.**
> Mai sacrificare la sicurezza per la velocità. Mai perdere un dato. Mai esporre una credenziale.
