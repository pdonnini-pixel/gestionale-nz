# BLUEPRINT — Gestionale NZ v2.0

> **Documento master per Cowork** — Allineamento funzionale Sibill ↔ NZ, integrazioni Open Banking (Yapily) e Agenzia delle Entrate (SDI/Corrispettivi), architettura scalabile multi-tenant.
>
> Ultima revisione: 17 aprile 2026  
> Autore: Patrizio Donnini — AI Strategy Blueprint

---

## 0. Infrastruttura Esistente — Inventario

| Componente | Dettaglio |
|---|---|
| **Frontend** | React 18 + Vite, TanStack Router, Zustand, Tailwind CSS |
| **Hosting** | Netlify (gestionale-nz.netlify.app) |
| **Backend** | Supabase (project `xfvfxsvqpnpvibgeqpqp`, eu-west-1) |
| **Database** | PostgreSQL 17, 59 tabelle, RLS abilitato su tutte |
| **Auth** | Supabase Auth (email + password), ruoli via `app_metadata` |
| **Storage** | Supabase Storage (documenti, fatture XML, allegati) |
| **Edge Functions** | Deno-based (deploy via GitHub push, proxy API) |
| **Repo** | `pdonnini-pixel/gestionale-nz` (GitHub) |
| **CI/CD** | Netlify auto-deploy da GitHub main branch |

### Tabelle Esistenti (59 tabelle, tutte con RLS)

**Core Azienda:** `companies` (1), `company_settings` (1), `app_users` (1), `user_profiles` (3), `user_outlet_access` (6)

**Outlet & Retail:** `outlets` (7, 53 colonne), `outlet_suppliers`, `outlet_attachments`, `outlet_bank_accounts`, `outlet_cost_template`, `outlet_simulations` (1)

**Contabilità & Budget:** `budget_entries` (1.236), `budget_confronto` (24), `annual_budgets`, `budget_cost_lines`, `monthly_actuals` (3), `monthly_cost_lines` (39), `cost_categories` (25), `cost_centers` (8), `chart_of_accounts` (20), `balance_sheet_data` (535), `balance_sheet_imports` (2), `recurring_costs`

**Tesoreria & Banche:** `bank_accounts` (1), `bank_balances` (1), `bank_imports` (1), `bank_transactions`, `cash_movements` (513), `cash_position`, `cash_budget`, `loans`, `loan_tranches`

**Fornitori & Scadenzario:** `suppliers` (75), `payables` (211, 38 colonne), `payable_actions` (26), `payment_schedule`, `payment_records`, `invoices`

**Fatture Elettroniche:** `electronic_invoices` (211), `daily_receipts_ade`

**Riconciliazione:** `reconciliation_log` (373), `reconciliation_rejected_pairs`

**Ricavi:** `daily_revenue` (49)

**Dipendenti:** `employees` (30 colonne), `employee_costs`, `employee_documents`, `employee_outlet_allocations`

**Contratti:** `contracts` (32 colonne), `contract_documents`, `contract_deadlines`, `contract_amount_history`

**Documenti & Import:** `documents`, `document_versions`, `import_documents` (2), `import_batches` (3), `csv_mappings`, `pos_imports`, `receipt_imports`

**Sistema:** `_deploy_temp`

---

## 1. Matrice Funzionale Unificata — Sibill ↔ NZ

Legenda: ✅ = presente e completo | 🔶 = parziale | ❌ = assente | 🎯 = da implementare in v2

### 1.1 Funzionalità Core

| Funzionalità | Sibill | NZ v1 | NZ v2 Target | Note |
|---|:---:|:---:|:---:|---|
| **Dashboard KPI** | ✅ saldo, cashflow, scadenze | ✅ multi-outlet | ✅ merge | NZ aggiunge confronto outlet che Sibill non ha |
| **Multi-azienda** | ✅ switch company | ❌ singola company | 🎯 | Aggiungere `company_id` selector, tenant isolation |
| **Multi-outlet** | ❌ | ✅ 7 outlet attivi | ✅ preservare | Feature chiave NZ — struttura retail unica |
| **Confronto Outlet** | ❌ | ✅ comparazione KPI | ✅ preservare | Sibill non ha nulla di simile |
| **Budget & Controllo** | ❌ | ✅ 1.236 entries | ✅ preservare | Budget vs actual per centro di costo |
| **Conto Economico** | ❌ | ✅ balance sheet 535 rows | ✅ preservare | Import bilancio da file + analisi |

### 1.2 Tesoreria & Open Banking

| Funzionalità | Sibill | NZ v1 | NZ v2 Target | Note |
|---|:---:|:---:|:---:|---|
| **Connessione banche PSD2** | ✅ multi-banca automatica | ❌ import manuale CSV | 🎯 Yapily | 322 banche IT disponibili via Yapily |
| **Saldi real-time** | ✅ aggiornamento automatico | 🔶 1 saldo manuale | 🎯 Yapily AIS | Polling giornaliero + webhook |
| **Movimenti bancari** | ✅ sync automatica | 🔶 513 mov. da CSV | 🎯 Yapily AIS | Sync automatica con categorizzazione |
| **Cashflow previsionale** | ✅ proiezione AI-based | 🔶 cash_budget manuale | 🎯 ibrido | Scadenzario + movimenti ricorrenti + AI |
| **Riconciliazione** | ✅ AI-powered matching | 🔶 373 log, rule-based | 🎯 upgrade AI | Mantenere regole NZ + aggiungere ML matching |
| **Pagamenti PSD2 (PIS)** | ✅ disposizione diretta | ❌ | 🎯 Yapily PIS | Pagamento fornitori diretto da app |
| **Multi-conto** | ✅ n conti | 🔶 1 conto attivo | 🎯 | Estendere `bank_accounts` con Yapily consent |

### 1.3 Ciclo Passivo & Fornitori

| Funzionalità | Sibill | NZ v1 | NZ v2 Target | Note |
|---|:---:|:---:|:---:|---|
| **Anagrafica fornitori** | ✅ base | ✅ 75 fornitori, 29 campi | ✅ NZ più ricco | NZ ha outlet_suppliers (link outlet↔fornitore) |
| **Scadenzario** | ✅ con alert | ✅ 211 payables, 38 campi | ✅ merge | NZ ha payable_actions audit trail (26 log) |
| **Import fatture XML** | ✅ da SDI | ✅ 211 e-invoices | ✅ preservare | Arricchire con parsing automatico da SDI |
| **Pagamento fornitori** | ✅ disposizione PSD2 | ❌ solo tracking | 🎯 Yapily PIS | Workflow: scadenza → approvazione → pagamento |
| **Categorizzazione AI** | ✅ auto-tagging | ❌ | 🎯 | Classificazione automatica per conto/centro costo |

### 1.4 Fatturazione & Fisco

| Funzionalità | Sibill | NZ v1 | NZ v2 Target | Note |
|---|:---:|:---:|:---:|---|
| **Fatturazione attiva** | ✅ crea + invia FatturaPA | ❌ | 🎯 SDI | Generazione XML FatturaPA + invio via SDI |
| **Ricezione fatture passive** | ✅ da SDI automatica | 🔶 import manuale XML | 🎯 SDI | Canale accreditato WebService SDI |
| **Corrispettivi telematici** | ❌ | 🔶 daily_receipts_ade | 🎯 AdE API | Invio giornaliero + riconciliazione POS |
| **F24 / Scadenze fiscali** | ✅ (add-on €10-25/mese) | ❌ | 🎯 fase 3 | Calcolo + reminder scadenze fiscali |
| **Nota di credito** | ✅ | ❌ | 🎯 | Gestione NC con storno automatico |
| **Conservazione sostitutiva** | ✅ | ❌ | 🎯 fase 3 | Storage certificato 10 anni |

### 1.5 Reportistica & Analytics

| Funzionalità | Sibill | NZ v1 | NZ v2 Target | Note |
|---|:---:|:---:|:---:|---|
| **Report personalizzabili** | ✅ export PDF/Excel | 🔶 export base | 🎯 | Template report + export multi-formato |
| **Analytics AI** | ✅ insight automatici (€20/mese) | ❌ | 🎯 fase 3 | Anomaly detection, trend, suggerimenti |
| **Confronto YoY** | ✅ | 🔶 budget_confronto | ✅ | NZ ha già la struttura, potenziare UI |
| **Simulazioni** | ❌ | ✅ outlet_simulations | ✅ preservare | Feature unica NZ: what-if per outlet |

### 1.6 Gestione Risorse (Solo NZ)

| Funzionalità | Sibill | NZ v1 | NZ v2 Target | Note |
|---|:---:|:---:|:---:|---|
| **Dipendenti** | ❌ | ✅ 30 campi + costi + allocazioni | ✅ preservare | Unica: allocazione % dipendente su outlet |
| **Contratti** | ❌ | ✅ 32 campi + scadenze + storico | ✅ preservare | Gestione contratti con alert scadenze |
| **Archivio documenti** | ❌ | ✅ versioning + categorie | ✅ preservare | Document management con versioni |
| **POS Import** | ❌ | ✅ pos_imports + ricavi | ✅ preservare | Import incassi POS per outlet |
| **Costi ricorrenti** | ❌ | ✅ recurring_costs | ✅ preservare | Auto-generazione movimenti periodici |

### 1.7 Funzionalità Piattaforma

| Funzionalità | Sibill | NZ v1 | NZ v2 Target | Note |
|---|:---:|:---:|:---:|---|
| **Onboarding guidato** | ✅ wizard multi-step | ❌ | 🎯 | Setup azienda → outlet → banca → SDI |
| **Ruoli e permessi** | ✅ admin/viewer/accountant | 🔶 user_outlet_access | 🎯 | RBAC completo con permessi granulari |
| **Notifiche** | ✅ email + in-app + push | ❌ | 🎯 | Alert scadenze, movimenti, anomalie |
| **Intercom / Supporto** | ✅ chat integrata | ❌ | 🎯 fase 3 | Help center + chat supporto |
| **BaaS (conto + carte)** | ✅ conto integrato | ❌ | ❌ | Non prioritario per NZ |
| **API pubblica** | ❌ | ❌ | 🎯 fase 4 | REST/GraphQL per integrazioni terze |

---

## 2. Integrazione Yapily — Open Banking (PSD2)

### 2.1 Overview Architetturale

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Frontend    │────▶│  Supabase Edge    │────▶│   Yapily     │
│  React SPA   │◀────│  Functions        │◀────│   API v4     │
└─────────────┘     └──────────────────┘     └──────┬──────┘
                           │                         │
                    ┌──────▼──────┐           ┌──────▼──────┐
                    │  Supabase   │           │  322 Banche │
                    │  PostgreSQL │           │  Italiane   │
                    └─────────────┘           └─────────────┘
```

### 2.2 Autenticazione & Consent Flow

**Credenziali Yapily** (da conservare in Supabase Vault):
- `YAPILY_APPLICATION_KEY` — chiave applicazione
- `YAPILY_APPLICATION_SECRET` — secret (Base64 per header Authorization)

**Flusso Consent (AIS — Account Information Service):**

1. Frontend richiede lista istituzioni → Edge Function → `GET /institutions?country=IT`
2. Utente seleziona banca → Edge Function crea consent → `POST /account-auth-requests`
3. Yapily restituisce `authorisationUrl` → redirect utente alla banca
4. Utente autorizza presso la banca → callback a NZ con `consent` token
5. Edge Function salva consent in `yapily_consents` → polling o webhook per conferma
6. Da questo momento: accesso a conti, saldi, movimenti

**Flusso Consent (PIS — Payment Initiation Service):**

1. Utente seleziona fattura da pagare → Edge Function crea payment auth → `POST /payment-auth-requests`
2. Redirect alla banca per autorizzazione SCA
3. Callback con `paymentIdempotencyId` → Edge Function esegue → `POST /payments`
4. Polling stato pagamento → aggiornamento `payable` e `cash_movements`

### 2.3 Nuove Tabelle Database — Open Banking

```sql
-- Consensi Yapily attivi
CREATE TABLE yapily_consents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    institution_id TEXT NOT NULL,            -- es. "intesa-sanpaolo-it"
    institution_name TEXT NOT NULL,
    consent_token TEXT NOT NULL,             -- crittografato via Vault
    consent_type TEXT NOT NULL CHECK (consent_type IN ('AIS', 'PIS')),
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','AUTHORIZED','EXPIRED','REVOKED','REJECTED')),
    expires_at TIMESTAMPTZ,
    max_historical_days INT DEFAULT 90,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Conti bancari sincronizzati via Yapily
CREATE TABLE yapily_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    consent_id UUID REFERENCES yapily_consents(id) NOT NULL,
    yapily_account_id TEXT NOT NULL,
    account_type TEXT,                       -- CASH_TRADING, SAVINGS, etc.
    iban TEXT,
    currency TEXT DEFAULT 'EUR',
    institution_id TEXT NOT NULL,
    bank_account_id UUID REFERENCES bank_accounts(id),  -- link a tabella NZ esistente
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Transazioni Open Banking
CREATE TABLE yapily_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    yapily_account_id UUID REFERENCES yapily_accounts(id) NOT NULL,
    transaction_id TEXT NOT NULL,            -- ID Yapily
    date DATE NOT NULL,
    booking_date DATE,
    amount NUMERIC(15,2) NOT NULL,
    currency TEXT DEFAULT 'EUR',
    description TEXT,
    reference TEXT,
    merchant_name TEXT,
    category TEXT,
    status TEXT CHECK (status IN ('BOOKED','PENDING')),
    raw_data JSONB,                          -- risposta completa Yapily
    cash_movement_id UUID REFERENCES cash_movements(id),  -- link riconciliazione
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Pagamenti PIS
CREATE TABLE yapily_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    consent_id UUID REFERENCES yapily_consents(id),
    payable_id UUID REFERENCES payables(id),
    idempotency_key UUID DEFAULT gen_random_uuid(),
    amount NUMERIC(15,2) NOT NULL,
    currency TEXT DEFAULT 'EUR',
    creditor_name TEXT NOT NULL,
    creditor_iban TEXT NOT NULL,
    reference TEXT,                           -- causale
    payment_type TEXT DEFAULT 'DOMESTIC_SINGLE',
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','AUTHORIZED','COMPLETED','FAILED','REJECTED')),
    yapily_payment_id TEXT,
    initiated_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    error_details JSONB
);

-- RLS su tutte le nuove tabelle
ALTER TABLE yapily_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE yapily_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE yapily_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yapily_payments ENABLE ROW LEVEL SECURITY;

-- Policy: accesso solo ai dati della propria company
CREATE POLICY "company_isolation" ON yapily_consents
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);
CREATE POLICY "company_isolation" ON yapily_accounts
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);
CREATE POLICY "company_isolation" ON yapily_transactions
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);
CREATE POLICY "company_isolation" ON yapily_payments
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);
```

### 2.4 Edge Functions — Yapily Proxy

```
supabase/functions/
├── yapily-institutions/     # GET lista banche IT
├── yapily-auth/             # POST crea consent AIS/PIS
├── yapily-callback/         # GET/POST callback da banca
├── yapily-accounts/         # GET conti collegati
├── yapily-transactions/     # GET movimenti + sync
├── yapily-balances/         # GET saldi real-time
├── yapily-payments/         # POST disposizione pagamento
└── yapily-webhook/          # POST webhook Yapily
```

**Esempio — Edge Function `yapily-transactions`:**

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const companyId = user.app_metadata.company_id;
  const { accountId, from, to } = await req.json();

  // Recupera consent attivo
  const { data: account } = await supabase
    .from("yapily_accounts")
    .select("*, yapily_consents(*)")
    .eq("id", accountId)
    .eq("company_id", companyId)
    .single();

  if (!account?.yapily_consents?.consent_token) {
    return new Response("No active consent", { status: 400 });
  }

  // Chiama Yapily API
  const yapilyRes = await fetch(
    `https://api.yapily.com/accounts/${account.yapily_account_id}/transactions?from=${from}&to=${to}`,
    {
      headers: {
        "Authorization": `Basic ${btoa(Deno.env.get("YAPILY_APP_KEY") + ":" + Deno.env.get("YAPILY_APP_SECRET"))}`,
        "consent": account.yapily_consents.consent_token,
        "Content-Type": "application/json"
      }
    }
  );

  const transactions = await yapilyRes.json();

  // Upsert transazioni in DB
  const rows = transactions.data.map((t: any) => ({
    company_id: companyId,
    yapily_account_id: accountId,
    transaction_id: t.id,
    date: t.date,
    booking_date: t.bookingDateTime,
    amount: t.amount,
    currency: t.currency,
    description: t.description,
    reference: t.reference,
    merchant_name: t.merchantName,
    status: t.status,
    raw_data: t
  }));

  const { error } = await supabase
    .from("yapily_transactions")
    .upsert(rows, { onConflict: "transaction_id" });

  return new Response(JSON.stringify({ synced: rows.length, error }), {
    headers: { "Content-Type": "application/json" }
  });
});
```

### 2.5 Banche Italiane Confermate (Yapily Console)

- **Totale:** 322 istituzioni italiane disponibili
- **Intesa Sanpaolo:** AIS (conti, saldi, transazioni) + PIS (singolo, futuro, periodico, pre-auth riutilizzabile) — tipo Business
- **UniCredit:** AIS (conti, transazioni) + PIS (singolo, instant SEPA, internazionale, periodico) — tipo Business + Personal
- **Copertura:** tutte le principali banche retail e business italiane

### 2.6 Sync & Riconciliazione Automatica

**Strategia di sync:**
1. **Polling schedulato** — Edge Function CRON ogni 4 ore per aggiornare saldi e movimenti
2. **Webhook** — Yapily notifica in real-time nuovi movimenti (dove supportato)
3. **Sync manuale** — pulsante "Aggiorna" in UI per sync on-demand

**Riconciliazione ibrida (regole NZ + ML):**
1. Match esatto: importo + data + riferimento → confidence 95%+
2. Match fuzzy: importo + finestra ±3gg + nome fornitore → confidence 70-94%
3. Suggerimento AI: pattern storici + categorizzazione → confidence 50-69%
4. Manuale: operatore conferma o rifiuta → alimenta training set

---

## 3. Integrazione Agenzia delle Entrate — SDI & Corrispettivi

### 3.1 Canale SDI — Accreditamento

**Canale raccomandato: WebService (SOAP/REST)**

| Aspetto | WebService | PEC | FTP |
|---|---|---|---|
| Automazione | ✅ completa | ❌ polling email | 🔶 batch |
| Real-time | ✅ immediato | ❌ ritardo ore | ❌ ritardo |
| Volume | ✅ illimitato | ❌ limite casella | 🔶 medio |
| Implementazione | 🔶 media | ✅ semplice | 🔶 media |

**Fasi accreditamento WebService SDI:**
1. Registrazione su portale "Fatture e Corrispettivi" (SPID/CIE)
2. Generazione certificati client SSL (X.509)
3. Upload certificato su portale AdE
4. Test su ambiente di validazione SDI
5. Attivazione canale produzione
6. **Tempistica:** 4-6 settimane

### 3.2 FatturaPA — Struttura XML

```xml
<FatturaElettronica versione="FPR12">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>PIVA</IdCodice></IdTrasmittente>
      <ProgressivoInvio>00001</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>XXXXXXX</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore><!-- dati azienda --></CedentePrestatore>
    <CessionarioCommittente><!-- dati cliente --></CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento><!-- Fattura -->
        <Data>2026-04-17</Data>
        <Numero>1</Numero>
        <ImportoTotaleDocumento>1220.00</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee><!-- righe fattura --></DettaglioLinee>
      <DatiRiepilogo><!-- riepilogo IVA --></DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento><!-- Bonifico -->
        <DataScadenzaPagamento>2026-05-17</DataScadenzaPagamento>
        <ImportoPagamento>1220.00</ImportoPagamento>
        <IBAN>IT60X0542811101000000123456</IBAN>
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</FatturaElettronica>
```

**Tipi documento gestiti:**
- TD01 — Fattura
- TD02 — Acconto su fattura
- TD04 — Nota di credito
- TD05 — Nota di debito
- TD06 — Parcella
- TD24 — Fattura differita
- TD25 — Fattura differita (triangolazione)

### 3.3 Notifiche SDI

| Codice | Nome | Significato | Azione NZ |
|---|---|---|---|
| RC | Ricevuta Consegna | Fattura consegnata al destinatario | Aggiorna stato → `DELIVERED` |
| NS | Notifica di Scarto | Errore nel file XML | Alert + mostra errori per correzione |
| MC | Mancata Consegna | Destinatario non raggiungibile | Deposito in cassetto fiscale, notifica utente |
| AT | Attestazione Trasmissione | File depositato in cassetto | Aggiorna stato → `DEPOSITED` |
| NE | Notifica Esito | Accettata/Rifiutata dal destinatario | Aggiorna stato corrispondente |
| DT | Decorrenza Termini | 15gg senza risposta = accettata | Auto-update stato → `ACCEPTED` |

### 3.4 Corrispettivi Telematici

**Integrazione con AdE per invio giornaliero corrispettivi:**

```
Registratore Telematico → POS Import NZ → Aggregazione giornaliera → XML Corrispettivi → API AdE
```

**Endpoint:** `https://api.agenziaentrate.gov.it/corrispettivi/v1`

**Flusso:**
1. Import dati POS da `pos_imports` / `daily_revenue`
2. Aggregazione per outlet + giorno
3. Generazione XML corrispettivi (formato AdE)
4. Invio tramite certificati SPID/CIE delegato
5. Ricezione esito + salvataggio in `daily_receipts_ade`
6. Riconciliazione con `daily_revenue` per outlet

### 3.5 Nuove Tabelle Database — Fisco

```sql
-- Fatture attive emesse
CREATE TABLE active_invoices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    outlet_id UUID REFERENCES outlets(id),
    invoice_number TEXT NOT NULL,
    invoice_date DATE NOT NULL,
    tipo_documento TEXT NOT NULL DEFAULT 'TD01',
    client_name TEXT NOT NULL,
    client_vat TEXT,
    client_fiscal_code TEXT,
    codice_destinatario TEXT,              -- SDI code 7 chars o PEC
    pec_destinatario TEXT,
    total_amount NUMERIC(15,2) NOT NULL,
    taxable_amount NUMERIC(15,2),
    vat_amount NUMERIC(15,2),
    vat_rate NUMERIC(5,2) DEFAULT 22.00,
    payment_method TEXT DEFAULT 'MP05',    -- bonifico
    payment_terms TEXT DEFAULT 'TP02',     -- pagamento completo
    due_date DATE,
    xml_content TEXT,                      -- FatturaPA XML generato
    xml_file_path TEXT,                    -- path in Supabase Storage
    sdi_id TEXT,                           -- identificativo SDI assegnato
    sdi_status TEXT DEFAULT 'DRAFT' CHECK (sdi_status IN (
        'DRAFT','SENT','DELIVERED','REJECTED','DEPOSITED','ACCEPTED','ERROR'
    )),
    sdi_notifications JSONB DEFAULT '[]',  -- storico notifiche RC/NS/MC/AT/NE/DT
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Configurazione canale SDI
CREATE TABLE sdi_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL UNIQUE,
    channel_type TEXT DEFAULT 'WEBSERVICE' CHECK (channel_type IN ('WEBSERVICE','PEC','FTP')),
    codice_fiscale_trasmittente TEXT NOT NULL,
    codice_sdi TEXT,                        -- codice destinatario 7 chars
    pec_ricezione TEXT,
    ssl_cert_path TEXT,                     -- path certificato in Vault
    ssl_key_path TEXT,
    environment TEXT DEFAULT 'TEST' CHECK (environment IN ('TEST','PRODUCTION')),
    accreditation_status TEXT DEFAULT 'PENDING',
    last_test_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Log corrispettivi inviati
CREATE TABLE corrispettivi_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES companies(id) NOT NULL,
    outlet_id UUID REFERENCES outlets(id) NOT NULL,
    date DATE NOT NULL,
    device_serial TEXT,
    total_amount NUMERIC(15,2) NOT NULL,
    vat_breakdown JSONB,                    -- {22: 1000, 10: 500, 4: 200}
    xml_content TEXT,
    submission_status TEXT DEFAULT 'PENDING',
    ade_receipt_id TEXT,
    submitted_at TIMESTAMPTZ,
    error_details JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE active_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sdi_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrispettivi_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON active_invoices
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);
CREATE POLICY "company_isolation" ON sdi_config
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);
CREATE POLICY "company_isolation" ON corrispettivi_log
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);
```

### 3.6 Edge Functions — SDI

```
supabase/functions/
├── sdi-generate-xml/        # Genera FatturaPA XML da active_invoices
├── sdi-send/                # Invia XML a SDI via WebService
├── sdi-receive/             # Webhook ricezione fatture passive
├── sdi-notifications/       # Webhook notifiche SDI (RC/NS/MC/AT/NE/DT)
├── sdi-status-check/        # Polling stato fatture inviate
├── corrispettivi-send/      # Invio giornaliero corrispettivi
└── corrispettivi-status/    # Verifica esito invio
```

---

## 4. Architettura & Scalabilità

### 4.1 Multi-Tenant Isolation

**Strategia: `company_id` in `app_metadata` + RLS everywhere**

```sql
-- Ogni tabella con dati aziendali ha company_id
-- RLS policy standard applicata a TUTTE le tabelle:
CREATE POLICY "tenant_isolation" ON <table_name>
    FOR ALL
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid)
    WITH CHECK (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);
```

**Gerarchia ruoli:**

| Ruolo | Permessi |
|---|---|
| `super_admin` | Gestione multi-azienda, configurazione globale |
| `admin` | Gestione completa singola azienda |
| `manager` | Operazioni su outlet assegnati (via `user_outlet_access`) |
| `viewer` | Solo lettura |
| `accountant` | Accesso a fatture, movimenti, riconciliazione |

### 4.2 Sicurezza

**Secrets Management — Supabase Vault:**
```sql
-- Tutti i secret via Vault, MAI in variabili ambiente
SELECT vault.create_secret('yapily_app_key', 'YOUR_KEY', 'Yapily Application Key');
SELECT vault.create_secret('yapily_app_secret', 'YOUR_SECRET', 'Yapily Application Secret');
SELECT vault.create_secret('sdi_cert_pem', '...', 'SDI SSL Certificate');
SELECT vault.create_secret('sdi_key_pem', '...', 'SDI SSL Private Key');
```

**JWT & Auth:**
- Supabase Auth con email/password + eventuale SPID/CIE
- JWT contiene `app_metadata: { company_id, role, outlet_ids[] }`
- Refresh token rotation abilitata
- Session timeout configurabile per ruolo

**Crittografia:**
- Consent token Yapily: crittografati at-rest via `pgcrypto`
- Certificati SDI: in Supabase Vault
- IBAN e dati sensibili: encrypted columns dove necessario
- TLS 1.3 per tutte le comunicazioni

### 4.3 Database Performance

**Partitioning per tabelle ad alto volume:**

```sql
-- cash_movements: partizionamento per mese
CREATE TABLE cash_movements_partitioned (
    LIKE cash_movements INCLUDING ALL
) PARTITION BY RANGE (date);

-- Partizioni automatiche (cron job mensile)
CREATE TABLE cash_movements_y2026m01 PARTITION OF cash_movements_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- ...

-- yapily_transactions: stesso pattern
CREATE TABLE yapily_transactions_partitioned (
    LIKE yapily_transactions INCLUDING ALL
) PARTITION BY RANGE (date);
```

**Indici critici:**

```sql
-- Ricerca movimenti
CREATE INDEX idx_cash_movements_company_date ON cash_movements(company_id, date DESC);
CREATE INDEX idx_cash_movements_bank_date ON cash_movements(bank_account_id, date DESC);

-- Riconciliazione
CREATE INDEX idx_yapily_tx_amount_date ON yapily_transactions(amount, date);
CREATE INDEX idx_payables_amount_due ON payables(total_amount, due_date);

-- Full-text search fornitori
CREATE INDEX idx_suppliers_name_trgm ON suppliers USING gin(name gin_trgm_ops);

-- Fatture per stato SDI
CREATE INDEX idx_active_invoices_sdi ON active_invoices(company_id, sdi_status);
```

**PITR Backup:**
- Supabase PITR (Point-in-Time Recovery) abilitato
- RPO: ultimo secondo, RTO: minuti
- Backup giornaliero aggiuntivo su Storage separato per tabelle critiche

### 4.4 Realtime & Caching

**Supabase Realtime subscriptions:**
```typescript
// Notifiche in tempo reale per nuovi movimenti bancari
supabase
  .channel('bank-movements')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'yapily_transactions',
    filter: `company_id=eq.${companyId}`
  }, (payload) => {
    // Aggiorna dashboard, notifica utente
    addNotification('Nuovo movimento bancario', payload.new);
    invalidateQuery(['cash-movements']);
  })
  .subscribe();

// Aggiornamento stato fatture SDI
supabase
  .channel('sdi-status')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'active_invoices',
    filter: `company_id=eq.${companyId}`
  }, (payload) => {
    if (payload.new.sdi_status !== payload.old.sdi_status) {
      showSDINotification(payload.new);
    }
  })
  .subscribe();
```

**Caching strategy:**
- TanStack Query con `staleTime: 5min` per dati stabili (anagrafica, configurazione)
- `staleTime: 30s` per dati dinamici (saldi, movimenti)
- Invalidazione selettiva post-sync Yapily
- Service Worker per offline-first su dati frequenti

### 4.5 Frontend Architecture

```
src/
├── app/
│   ├── routes/                    # TanStack Router file-based
│   │   ├── _layout.tsx            # Shell + sidebar
│   │   ├── dashboard.tsx
│   │   ├── outlets/
│   │   │   ├── index.tsx          # Lista outlet
│   │   │   ├── $outletId.tsx      # Dettaglio outlet
│   │   │   └── compare.tsx        # Confronto outlet
│   │   ├── treasury/
│   │   │   ├── accounts.tsx       # Conti bancari + Yapily
│   │   │   ├── movements.tsx      # Movimenti (CSV + Open Banking)
│   │   │   ├── reconciliation.tsx
│   │   │   └── cashflow.tsx       # Cashflow previsionale
│   │   ├── invoicing/
│   │   │   ├── active.tsx         # Fatture emesse
│   │   │   ├── passive.tsx        # Fatture ricevute (SDI)
│   │   │   ├── create.tsx         # Creazione fattura
│   │   │   └── receipts.tsx       # Corrispettivi
│   │   ├── suppliers/
│   │   ├── budget/
│   │   ├── employees/
│   │   ├── contracts/
│   │   ├── documents/
│   │   ├── settings/
│   │   │   ├── company.tsx
│   │   │   ├── banking.tsx        # Config Yapily
│   │   │   ├── sdi.tsx            # Config SDI / AdE
│   │   │   ├── users.tsx          # RBAC
│   │   │   └── outlets.tsx
│   │   └── onboarding/            # Wizard setup
│   └── stores/                    # Zustand stores
│       ├── authStore.ts
│       ├── companyStore.ts
│       ├── outletStore.ts
│       ├── bankingStore.ts        # stato Yapily
│       └── invoicingStore.ts      # stato SDI
├── components/
│   ├── ui/                        # Design system (shadcn/ui pattern)
│   ├── banking/                   # Componenti Open Banking
│   ├── invoicing/                 # Componenti fatturazione
│   └── shared/                    # Componenti condivisi
├── hooks/
│   ├── useYapily.ts               # Hook custom Yapily
│   ├── useSDI.ts                  # Hook custom SDI
│   ├── useReconciliation.ts
│   └── useRealtime.ts
├── lib/
│   ├── supabase.ts
│   ├── yapily.ts                  # Client Yapily (via Edge Functions)
│   ├── sdi.ts                     # Client SDI (via Edge Functions)
│   └── utils.ts
└── types/
    ├── database.ts                # Auto-generati da Supabase CLI
    ├── yapily.ts
    └── sdi.ts
```

### 4.6 Testing Strategy

| Livello | Tool | Copertura |
|---|---|---|
| Unit | Vitest | Utility, store, hooks — target 80% |
| Component | Vitest + Testing Library | Componenti UI critici |
| Integration | Vitest + MSW | Edge Functions mock, flussi Yapily/SDI |
| E2E | Playwright | Flussi critici: onboarding, consent, fatturazione |
| API | Vitest | Edge Functions isolate con Supabase test client |

### 4.7 CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test:unit
      - run: npm run test:integration

  e2e:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx playwright install --with-deps
      - run: npm run test:e2e

  deploy-preview:
    needs: test
    if: github.event_name == 'pull_request'
    # Netlify deploy preview automatico

  deploy-production:
    needs: [test, e2e]
    if: github.ref == 'refs/heads/main'
    steps:
      - run: npx supabase db push        # Migrazioni DB
      - run: npx supabase functions deploy # Edge Functions
      # Netlify auto-deploy da main
```

### 4.8 Monitoring & Observability

- **Supabase Dashboard:** query performance, auth events, storage usage
- **Netlify Analytics:** page views, function invocations, errors
- **Edge Function Logs:** `supabase functions logs` per debug
- **Custom metrics:** tabella `audit_log` per tracking azioni utente
- **Alerting:** webhook su Slack/email per errori SDI, consent Yapily scaduti, riconciliazione fallita

---

## 5. Roadmap di Sviluppo

### Fase 1 — Fondamenta (Settimane 1-4)

**Obiettivo:** Multi-tenant, RBAC, onboarding, refactoring strutturale

- [ ] Implementare switch multi-azienda con tenant isolation
- [ ] RBAC completo (super_admin, admin, manager, viewer, accountant)
- [ ] Wizard onboarding (azienda → outlet → configurazione)
- [ ] Migrazione tabelle esistenti al pattern multi-tenant verificato
- [ ] Setup CI/CD pipeline (lint, test, deploy preview)
- [ ] Design system con shadcn/ui components

### Fase 2 — Open Banking Yapily (Settimane 5-10)

**Obiettivo:** Connessione banche, sync movimenti, riconciliazione automatica

- [ ] Registrazione app Yapily + certificati
- [ ] Edge Functions: institutions, auth, callback, accounts, transactions, balances
- [ ] Tabelle: yapily_consents, yapily_accounts, yapily_transactions, yapily_payments
- [ ] UI: selezione banca → consent → dashboard conti collegati
- [ ] Sync automatica movimenti (polling 4h + webhook)
- [ ] Riconciliazione ibrida (regole + scoring)
- [ ] Cashflow previsionale con dati real-time
- [ ] PIS: pagamento fornitori diretto da scadenzario

### Fase 3 — Agenzia delle Entrate (Settimane 8-14)

**Obiettivo:** Fatturazione attiva/passiva SDI, corrispettivi telematici

- [ ] Accreditamento canale WebService SDI (4-6 settimane di processo AdE)
- [ ] Generatore XML FatturaPA (tutti i TipoDocumento)
- [ ] Edge Functions: generate-xml, send, receive, notifications
- [ ] Tabelle: active_invoices, sdi_config, corrispettivi_log
- [ ] UI: creazione fattura → anteprima → invio → tracking stato
- [ ] Ricezione automatica fatture passive da SDI
- [ ] Parsing XML → inserimento in electronic_invoices + payables
- [ ] Corrispettivi: aggregazione giornaliera → invio AdE
- [ ] Nota di credito con storno automatico

### Fase 4 — AI & Analytics (Settimane 12-18)

**Obiettivo:** Intelligenza artificiale per categorizzazione, previsioni, anomalie

- [ ] Categorizzazione automatica movimenti (ML model)
- [ ] Riconciliazione AI-powered (upgrade da rule-based)
- [ ] Cashflow previsionale AI (time series + scadenzario)
- [ ] Anomaly detection su movimenti e fatture
- [ ] Dashboard insights automatici
- [ ] Report personalizzabili con export multi-formato

### Fase 5 — Completamento & Scale (Settimane 16-24)

**Obiettivo:** Feature parity con Sibill + unicità NZ

- [ ] F24 e scadenze fiscali
- [ ] Conservazione sostitutiva (10 anni)
- [ ] Notifiche multi-canale (email + in-app + push)
- [ ] Help center integrato
- [ ] Database partitioning per tabelle >100K rows
- [ ] Performance optimization (lazy loading, virtual scrolling)
- [ ] Playwright E2E test suite completa
- [ ] API pubblica REST (fase esplorativa)
- [ ] Documentazione tecnica e utente

---

## 6. Stima Costi Infrastruttura

| Componente | Piano | Costo/mese |
|---|---|---|
| Supabase | Pro | $25 |
| Supabase (add-on PITR) | — | $100 |
| Netlify | Pro | $19 |
| Yapily | Startup | ~€200-500 (per volume API) |
| GitHub | Free/Team | $0-4/utente |
| **Totale stimato** | | **~€350-650/mese** |

**Break-even:** con pricing simile a Sibill (€69-129/mese/azienda), bastano 5-10 clienti per coprire i costi infrastrutturali.

---

## 7. Principi Architetturali — "Robusto, Scalabile, Indistruttibile"

1. **RLS Everywhere** — nessuna tabella senza Row Level Security. Mai fidarsi del frontend.
2. **Edge Functions as Proxy** — il frontend non parla mai direttamente con API esterne (Yapily, SDI). Sempre tramite Edge Functions autenticate.
3. **Secrets in Vault** — zero credenziali in codice, variabili ambiente, o localStorage.
4. **Idempotency** — ogni operazione critica (pagamento, invio fattura) ha chiave di idempotenza.
5. **Audit Trail** — `payable_actions` pattern esteso a tutte le entità critiche.
6. **PITR + Backup** — Point-in-Time Recovery + backup schedulati.
7. **Graceful Degradation** — se Yapily è down, fallback a import manuale CSV. Se SDI è down, coda locale con retry.
8. **Type Safety** — TypeScript strict, tipi auto-generati da Supabase, Zod validation su input.
9. **Progressive Enhancement** — funzionalità base sempre disponibili, integrazioni premium opzionali.
10. **GDPR Compliant** — diritto all'oblio, export dati, consenso esplicito, log accessi.

---

> **Questo documento è il contratto tecnico del prodotto.** Ogni feature, tabella, endpoint e decisione architetturale è qui. Cowork deve leggere questo file prima di qualsiasi implementazione.
