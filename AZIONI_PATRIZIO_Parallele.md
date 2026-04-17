# Piano Azioni Patrizio — Lavoro Parallelo

> Mentre Cowork costruisce il codice (Fase 1→5), tu prepari le credenziali e accreditamenti.
> Obiettivo: **zero tempi morti** — quando Cowork finisce una fase, tutto è già pronto per la successiva.

---

## Timeline Parallela

```
SETTIMANA    1    2    3    4    5    6    7    8    9   10   11   12   13   14
             ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
COWORK:      │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
             │  FASE 1         │  FASE 2 (Yapily)         │  FASE 3 (SDI)            │
             │  Multi-tenant   │  Open Banking code       │  Fatturazione code       │
             │  RBAC, Onboard  │  Edge Fn + React         │  XML + Edge Fn + React   │
             │                 │                          │                          │
PATRIZIO:    │▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│                │▓▓▓▓▓▓▓▓│                │
             │ Yapily │ SDI Accredit.    │                │ PITR   │                │
             │ Setup  │ (4-6 sett.)      │                │ Attiva │                │
             │        │                  │                │        │                │
             └────────┴──────────────────┴────────────────┴────────┴────────────────┘

LEGENDA: ▓ = lavoro attivo
```

---

## BLOCCO A — Yapily (Fai SUBITO, Settimana 1)

> Tempo stimato: 30 minuti
> Serve per: Fase 2 Cowork (settimana 5)
> Se lo fai ora, Cowork non si ferma mai

### Passo 1 — Login Yapily Console
- [ ] Vai su https://console.yapily.com
- [ ] Login con Google (pdonnini@gmail.com) — lo hai già fatto con me
- [ ] Verifica di essere nella dashboard

### Passo 2 — Crea Applicazione
- [ ] Vai su **Applications** (sidebar sinistra)
- [ ] Clicca **"Create Application"** (o "New Application")
- [ ] Nome: `Gestionale NZ`
- [ ] Callback URL: `https://gestionale-nz.netlify.app/banking/callback`
- [ ] Seleziona i servizi: **AIS** (Account Information) + **PIS** (Payment Initiation)
- [ ] Salva

### Passo 3 — Copia Credenziali
- [ ] Dalla pagina dell'applicazione appena creata, copia:
  - **Application UUID** (es. `a1b2c3d4-...`)
  - **Application Key**
  - **Application Secret**
- [ ] Salvali temporaneamente in un posto sicuro (NOT in chat, file locale crittografato)
- [ ] Quando Cowork arriva alla Fase 2, incollali in chat → verranno salvati in Supabase Vault

### Passo 4 — Verifica Istituzioni
- [ ] Vai su **Institutions** → filtra per **Italy**
- [ ] Conferma che vedi le tue banche (Intesa, UniCredit, ecc.)
- [ ] Nota: il piano gratuito/sandbox ha limitazioni sui volumi — per produzione potrebbe servire upgrade

### Passo 5 — Certificati (se richiesti)
- [ ] Alcuni piani Yapily richiedono certificati eIDAS/QWAC
- [ ] Vai su **Certificates** → verifica se devi caricare qualcosa
- [ ] Se sì, Yapily fornisce documentazione guidata — seguila
- [ ] Se no (sandbox/test mode), procedi senza

**Risultato:** Credenziali Yapily pronte. Cowork le userà in Fase 2.

---

## BLOCCO B — Agenzia delle Entrate / SDI (Inizia Settimana 1-2)

> Tempo stimato: 2-3 ore diluite su 4-6 settimane (l'AdE ha tempi burocratici)
> Serve per: Fase 3 Cowork (settimana 8)
> INIZIA SUBITO perché l'accreditamento richiede settimane

### Passo 1 — Accesso Portale
- [ ] Vai su https://ivaservizi.agenziaentrate.gov.it/portale/
- [ ] Login con **SPID** o **CIE** (Carta d'Identità Elettronica)
- [ ] Entra nella sezione **"Fatture e Corrispettivi"**

### Passo 2 — Verifica Dati Aziendali
- [ ] Controlla che la Partita IVA della tua azienda sia corretta
- [ ] Verifica la PEC registrata (deve essere attiva)
- [ ] Nota il **Codice Destinatario** attuale (se ne hai uno — 7 caratteri alfanumerici)

### Passo 3 — Richiedi Accreditamento Canale WebService
- [ ] Nella sezione Fatture e Corrispettivi, cerca **"Accreditamento canale"**
- [ ] Seleziona **"Web Service"** come tipo di canale
- [ ] Compila i dati richiesti:
  - Codice Fiscale del soggetto trasmittente
  - Endpoint URL dove ricevere le fatture: `https://xfvfxsvqpnpvibgeqpqp.supabase.co/functions/v1/sdi-receive`
  - Endpoint URL per le notifiche: `https://xfvfxsvqpnpvibgeqpqp.supabase.co/functions/v1/sdi-notifications`
- [ ] **NOTA:** Gli endpoint non funzioneranno ancora — è normale. L'AdE li testa dopo.

### Passo 4 — Genera Certificati SSL
- [ ] L'AdE ti chiederà di generare un certificato client
- [ ] Segui la procedura guidata sul portale:
  1. Genera la CSR (Certificate Signing Request)
  2. L'AdE firma il certificato
  3. Scarica il certificato firmato (`.pem`) e la chiave privata (`.key`)
- [ ] **Conservali in modo sicuro** — servono a Cowork per configurare le Edge Functions
- [ ] NON inviarli via email — passali a Cowork direttamente in chat quando richiesto

### Passo 5 — Attendi Attivazione
- [ ] L'AdE processerà la richiesta in **2-4 settimane**
- [ ] Riceverai una PEC di conferma accreditamento
- [ ] Nel frattempo, Cowork costruisce tutto il codice con test XML locali

### Passo 6 — Test Ambiente Validazione
- [ ] Una volta accreditato, l'AdE ti dà accesso all'**ambiente di test**
- [ ] Cowork invierà fatture di test per verificare il flusso
- [ ] Conferma i risultati sul portale AdE → sezione "Monitoraggio fatture"

### Passo 7 — Corrispettivi Telematici
- [ ] Nella stessa sezione del portale, verifica la configurazione dei **corrispettivi**
- [ ] Se hai registratori telematici, nota i **numeri seriali** dei dispositivi
- [ ] Questi serviranno per mappare i corrispettivi agli outlet corretti

**Risultato:** Canale SDI accreditato + certificati SSL pronti. Cowork li integra in Fase 3.

---

## BLOCCO C — Supabase PITR (Settimana 4, prima delle migrazioni pesanti)

> Tempo stimato: 5 minuti
> Serve per: sicurezza prima delle migrazioni Fase 2

### Passo 1 — Attiva PITR
- [ ] Vai su https://supabase.com/dashboard
- [ ] Seleziona progetto `xfvfxsvqpnpvibgeqpqp`
- [ ] **Settings** → **Add-ons** → **Point in Time Recovery**
- [ ] Clicca **"Enable"** (costo: ~$100/mese aggiuntivi al piano Pro)
- [ ] Conferma

### Passo 2 — Verifica
- [ ] Dopo 10-15 minuti, verifica che PITR sia attivo nella dashboard
- [ ] Conferma a Cowork in chat

**Risultato:** Recovery point al secondo. Se qualsiasi migrazione va storta, rollback istantaneo.

---

## BLOCCO D — Netlify Environment Variables (Settimana 1)

> Tempo stimato: 10 minuti
> Serve per: l'app attualmente non funziona (env vars mancanti)

### Passo 1 — Verifica Deploy
- [ ] Vai su https://app.netlify.com → sito `gestionale-nz`
- [ ] **Site settings** → **Environment variables**
- [ ] Verifica che queste variabili esistano:
  - `VITE_SUPABASE_URL` = `https://xfvfxsvqpnpvibgeqpqp.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = [la tua anon key da Supabase dashboard → Settings → API]

### Passo 2 — Se mancano, aggiungile
- [ ] Vai su Supabase Dashboard → Settings → API
- [ ] Copia **Project URL** e **anon public key**
- [ ] Torna su Netlify → aggiungi le environment variables
- [ ] **Trigger redeploy** (Deploys → "Trigger deploy" → "Clear cache and deploy site")

### Passo 3 — Verifica
- [ ] Vai su https://gestionale-nz.netlify.app
- [ ] L'app dovrebbe caricarsi (non più pagina bianca)
- [ ] Fai login con le tue credenziali

**Risultato:** App NZ funzionante di nuovo. Cowork può testare le modifiche in ambiente reale.

---

## BLOCCO E — GitHub Access (Settimana 1, se necessario)

> Tempo stimato: 5 minuti

### Passo 1 — Verifica accesso repo
- [ ] Vai su https://github.com/pdonnini-pixel/gestionale-nz
- [ ] Verifica che il repo esista e sia accessibile
- [ ] Se Cowork ha bisogno di push access, crea un **Personal Access Token**:
  - Settings → Developer Settings → Personal Access Tokens → Fine-grained
  - Repo: `pdonnini-pixel/gestionale-nz`
  - Permissions: Contents (Read & Write), Pull Requests (Read & Write)
  - Copia il token → passalo a Cowork quando richiesto

**Risultato:** Cowork può fare push e deploy direttamente.

---

## Checklist Riepilogativa

| # | Azione | Quando | Durata | Stato |
|---|---|---|---|---|
| A1 | Login Yapily Console | Subito | 2 min | ☐ |
| A2 | Crea App Yapily | Subito | 10 min | ☐ |
| A3 | Copia credenziali Yapily | Subito | 5 min | ☐ |
| A4 | Verifica istituzioni IT | Subito | 5 min | ☐ |
| B1 | Login portale AdE (SPID) | Settimana 1 | 5 min | ☐ |
| B2 | Verifica dati aziendali | Settimana 1 | 10 min | ☐ |
| B3 | Richiedi accreditamento SDI | Settimana 1 | 30 min | ☐ |
| B4 | Genera certificati SSL | Settimana 1-2 | 20 min | ☐ |
| B5 | Attendi attivazione | Settimane 2-6 | (attesa) | ☐ |
| B6 | Test ambiente validazione | Dopo attivazione | 30 min | ☐ |
| B7 | Config corrispettivi | Dopo attivazione | 15 min | ☐ |
| C1 | Attiva PITR Supabase | Settimana 4 | 5 min | ☐ |
| D1 | Fix env vars Netlify | Subito | 10 min | ☐ |
| D2 | Verifica app funzionante | Subito | 5 min | ☐ |
| E1 | GitHub token per Cowork | Se richiesto | 5 min | ☐ |

**Tempo totale tuo: ~2.5 ore** (di cui 1.5h concentrate nella prima settimana, il resto sono attese AdE)

---

## Comunicazione con Cowork

Quando completi un'azione, scrivi in chat:
- ✅ **"Fatto A3"** → Cowork sa che le credenziali Yapily sono pronte
- ✅ **"Fatto D1"** → Cowork sa che l'app è online
- ✅ **"Fatto B4"** + allega certificati → Cowork li salva in Vault

Cowork non procederà con le integrazioni esterne finché non riceve la tua conferma.
Per il codice puro (Fase 1, componenti React, migrazioni non-breaking), Cowork procede in autonomia.
