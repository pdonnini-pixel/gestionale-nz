# Piano di Implementazione — Feature Sibill → Gestionale NZ

Data: 17 aprile 2026
Autore: Patrizio + Claude
Reference: `docs/reference-ui/SIBILL_ANALYSIS.md`

---

## METODOLOGIA

Confronto feature-by-feature tra Sibill (app.sibill.com, navigato live il 16/04) e Gestionale NZ (stato attuale del codice). Per ogni area: cosa c'è, cosa manca, cosa fare, effort stimato, priorità.

Effort stimato in "giorni di sessione" (una sessione = ~3-4 ore di lavoro con Claude).

---

## MAPPA COMPARATIVA

### AREA 1: MOVIMENTI BANCARI

| Feature Sibill | Gestionale NZ | Gap |
|---|---|---|
| Tab: Movimenti / Pagamenti / Regole / Prima nota | Solo tab "Movimenti" in Banche.jsx | **Mancano 3 tab** |
| Sub-tab: Tutti / Entrate / Uscite / Da verificare / Non categorizzati | Nessun filtro tab | **Mancano sub-tab** |
| KPI sommario: N risultati, uscite, entrate, netto | Nessun KPI sopra la lista | **Manca** |
| Toggle "Verificato" SI/NO per movimento | Non presente | **Manca** |
| Badge categoria colorato | Non presente | **Manca** |
| Proposte categorizzazione automatica | Non presente | **Manca** |
| Pannello laterale dettaglio movimento | Non presente (modal o inline) | **Manca** |
| Upload giustificativi/allegati | Non presente | **Manca** |
| Creazione ricorrenze da movimento | Non presente | **Manca** |
| Riconciliazione con lista candidati | ✅ Implementato (sessione 16/04) | OK |
| Esclusione automatica commissioni bancarie | ✅ Implementato | OK |

**Cosa fare — Sprint Movimenti (Priorità ALTA):**

1. **Sub-tab filtranti** — Aggiungere tab Tutti / Entrate / Uscite / Da verificare / Non categorizzati sopra la tabella movimenti in Banche.jsx. Filtra `cash_movements` per direction e status.
   - Effort: 0.5 giorni
   - Impatto: Alto (workflow operatore quotidiano)

2. **KPI sommario movimenti** — Barra con conteggio risultati, totale entrate, totale uscite, netto. Calcolo client-side sui movimenti filtrati.
   - Effort: 0.3 giorni
   - Impatto: Medio (visibilità immediata)

3. **Toggle "Verificato"** — Aggiungere colonna `verified` (boolean) a `cash_movements`. Toggle inline per ogni riga.
   - DB: `ALTER TABLE cash_movements ADD COLUMN verified BOOLEAN DEFAULT false`
   - Effort: 0.5 giorni
   - Impatto: Alto (audit trail operativo)

4. **Pannello laterale dettaglio** — Click su movimento apre side panel (non modal) con: dettaglio completo, proposte riconciliazione, upload allegati, crea ricorrenza.
   - Effort: 1.5 giorni
   - Impatto: Critico (hub operativo per singolo movimento)

5. **Categorizzazione movimenti** — Badge colorato per categoria. Tabella `movement_categories` o campo category in `cash_movements`. Regole automatiche basate su descrizione/importo.
   - DB: `ALTER TABLE cash_movements ADD COLUMN category TEXT, ADD COLUMN category_rule_id UUID`
   - Nuova tabella: `movement_category_rules (id, company_id, pattern, category, priority)`
   - Effort: 2 giorni
   - Impatto: Alto (base per cashflow per categoria)

6. **Upload giustificativi** — Supabase Storage bucket per allegati movimento. Link `cash_movement_id` → file.
   - Effort: 1 giorno
   - Impatto: Medio (compliance documentale)

**Totale Sprint Movimenti: ~6 giorni**

---

### AREA 2: CASHFLOW

| Feature Sibill | Gestionale NZ | Gap |
|---|---|---|
| Grafico barre mensile entrate/uscite + linea netto | CashflowProspettico ha grafico composito | **Parziale** (diverso layout) |
| KPI: Entrate, Uscite, Netto periodo | CashflowProspettico ha KPI sommari | ✅ OK |
| Tabella mese per mese con categorie espandibili | Non presente | **Manca** |
| Sotto-categorie: POS FDM, Fornitori, Personale, Gestione, Imposte | Non presente | **Manca** |
| Stato: Realizzato vs Previsto per mese | CashflowProspettico ha actual vs forecast | **Parziale** (non nella tabella) |
| Celle editabili per budget previsionali | Non presente | **Manca** |
| Pulsante "Aggiungi" per forecast manuale per categoria | Non presente | **Manca** |
| Range date personalizzabile | Solo selezione anno | **Parziale** |
| Linea tratteggiata per previsioni nel grafico | Non presente | **Manca** |
| Esportazione dati | Non presente | **Manca** |

**Cosa fare — Sprint Cashflow (Priorità ALTA):**

1. **Tabella cashflow consuntivo** — Nuova vista (o refactor di CashFlow.jsx) con tabella mese × categoria. Dati da `cash_movements` raggruppati per mese e categoria. Righe espandibili per sotto-categoria.
   - Effort: 2 giorni
   - Impatto: Critico (visibilità reale dei flussi)
   - Dipende da: Categorizzazione movimenti (Area 1.5)

2. **Transizione Realizzato → Previsto** — Mesi passati mostrano dati reali da `cash_movements`, mesi futuri da budget/forecast. Indicatore visivo (badge "Realizzato"/"Previsto" + linea tratteggiata nel grafico).
   - Effort: 1 giorno
   - Impatto: Alto (distinguere dato reale da proiezione)

3. **Celle editabili per budget** — Mesi futuri con input editabile per categoria. Salvataggio su tabella `cashflow_budget` (nuova).
   - DB: `CREATE TABLE cashflow_budget (id UUID, company_id UUID, year INT, month INT, category TEXT, amount DECIMAL, scenario TEXT, created_at TIMESTAMPTZ)`
   - Effort: 1.5 giorni
   - Impatto: Alto (pianificazione attiva)

4. **Esportazione CSV/Excel** — Pulsante "Esporta" che genera CSV/XLSX della tabella cashflow corrente.
   - Effort: 0.5 giorni
   - Impatto: Medio (reporting esterno)

**Totale Sprint Cashflow: ~5 giorni**

---

### AREA 3: SCADENZARIO

| Feature Sibill | Gestionale NZ | Gap |
|---|---|---|
| Tab: Situazione / Scadenzario / Ricorrenze / Regole | ScadenzarioSmart ha vista unica + CostiRicorrenti | **Parziale** |
| KPI: Da pagare con dettaglio per fornitore | ScadenzarioSmart ha KPI sommari | **Parziale** (manca drill-down) |
| Grafico proiezione saldo timeline | Non presente | **Manca** |
| KPI: Saldo oggi / Pagamenti / Incassi / Saldo finale | Non presente | **Manca** |
| "Saldo finale incluso scaduto" | Non presente | **Manca** |
| Filtro per tipo: Incassi vs Pagamenti | ScadenzarioSmart filtra per status | **Parziale** |
| Pannello laterale dettaglio scadenza | Non presente | **Manca** |
| Pulsante "Sollecita" per reminder | Non presente | **Manca** |
| Pulsante "Cerca movimenti" per riconciliazione | Non presente | **Manca** |
| Tab "Conto non assegnato" | Non presente | **Manca** |

**Cosa fare — Sprint Scadenzario (Priorità ALTA):**

1. **KPI tesoreria** — Barra superiore: Saldo oggi (da `bank_accounts`), Totale da pagare (da `payables` scadute+in_scadenza), Totale da incassare (fatture attive non saldate), Saldo proiettato.
   - Effort: 1 giorno
   - Impatto: Critico (visione tesoreria immediata)

2. **Grafico proiezione saldo** — LineChart con asse X = giorni/settimane, asse Y = saldo. Parte dal saldo attuale, sottrae scadenze pagamenti, somma incassi previsti. Mostra punto di minimo e data.
   - Effort: 1.5 giorni
   - Impatto: Critico (previsione liquidità)
   - Dipende da: KPI tesoreria

3. **Pannello laterale scadenza** — Click su scadenza apre side panel con: dettaglio fattura, metodo pagamento, conto assegnato, storico azioni, pulsanti Sollecita/Rimanda/Paga.
   - Effort: 1 giorno
   - Impatto: Alto (operatività)

4. **Tab "Situazione"** — Vista riassuntiva per fornitore: quanto dovuto, quante scadenze, % scaduto. Simile alla vista Sibill con elenco fornitori e importi aggregati.
   - Effort: 1 giorno
   - Impatto: Alto (prioritizzazione pagamenti)

5. **Link Scadenzario → Banche** — Pulsante "Cerca movimenti" su ogni scadenza per trovare il pagamento corrispondente in `cash_movements`. Riconciliazione diretta.
   - Effort: 1 giorno
   - Impatto: Alto (chiude il cerchio riconciliazione)

**Totale Sprint Scadenzario: ~5.5 giorni**

---

### AREA 4: FATTURE / INVOICES

| Feature Sibill | Gestionale NZ | Gap |
|---|---|---|
| Dashboard fatture con grafici imponibile mensile | Non presente (fatture sparse in Fornitori e Import) | **Manca** |
| Calcolo IVA: A Credito / A Debito / Netto | Non presente | **Manca** |
| Tab: Situazione / Ricevute / Emesse / Corrispettivi / DDT | Non presente | **Manca** |
| Classifica Clienti per peso % ricavi | Non presente | **Manca** |
| Classifica Fornitori per peso % costi | Fornitori.jsx ha lista ma senza ranking % | **Parziale** |
| Emissione fattura (form completo) | Non presente | **Manca** (bassa priorità) |

**Cosa fare — Sprint Fatture (Priorità MEDIA):**

1. **Dashboard Fatture** — Nuova pagina `/fatture` con: grafico imponibile mensile (da `electronic_invoices`), KPI Ricavi/Costi/Differenza, tabella top clienti e top fornitori con % peso.
   - Effort: 2 giorni
   - Impatto: Alto (visibilità fiscale aggregata)

2. **Calcolo IVA automatico** — Da dati XML già parsati nelle `electronic_invoices`. Mostra IVA a credito (acquisti) vs IVA a debito (vendite) vs tasse nette.
   - Effort: 1 giorno
   - Impatto: Alto (compliance fiscale)

3. **Tab Ricevute / Emesse** — Filtro per tipo documento (TD01-TD06 etc.) con lista fatture, stato pagamento, collegamento a scadenzario.
   - Effort: 1 giorno
   - Impatto: Medio

4. **Emissione fatture** — NON prioritario per New Zago (non emettono fatture attive). Eventuale futuro.
   - Effort: 5+ giorni (se mai necessario)
   - Impatto: Basso per NZ

**Totale Sprint Fatture: ~4 giorni** (escl. emissione)

---

### AREA 5: DASHBOARD CONTI

| Feature Sibill | Gestionale NZ | Gap |
|---|---|---|
| Saldo aggregato grande in evidenza | Banche.jsx ha card per conto | **Parziale** |
| Conti raggruppati per istituto con logo | Non raggruppati | **Manca** |
| IBAN mascherato | Non presente | **Manca** |
| "Nascondi saldi" toggle | Non presente | **Manca** |
| Conti manuali (cassa contanti) | Non presente | **Manca** |

**Cosa fare — Sprint Dashboard Conti (Priorità MEDIA):**

1. **Raggruppamento per banca** — Group bank_accounts per `bank_name`, mostrare logo/icona istituto, saldo aggregato per gruppo.
   - Effort: 0.5 giorni

2. **IBAN mascherato + toggle saldi** — Mascherare IBAN (mostrare ultimi 4), aggiungere toggle "Nascondi saldi" globale.
   - Effort: 0.3 giorni

3. **Conti manuali** — Tipo conto "manuale" per cassa contanti, con aggiornamento saldo manuale.
   - Effort: 0.5 giorni

**Totale Sprint Dashboard Conti: ~1.3 giorni**

---

## ROADMAP PROPOSTA

### FASE 1 — "Operatività Quotidiana" (Settimane 1-2)
> Obiettivo: dare all'operatore gli strumenti per il lavoro giornaliero

| # | Feature | Area | Effort | Dipende da |
|---|---|---|---|---|
| 1.1 | Sub-tab movimenti (Entrate/Uscite/Da verificare) | Movimenti | 0.5g | — |
| 1.2 | KPI sommario movimenti | Movimenti | 0.3g | — |
| 1.3 | Toggle "Verificato" su movimenti | Movimenti | 0.5g | ALTER TABLE |
| 1.4 | KPI tesoreria scadenzario | Scadenzario | 1g | — |
| 1.5 | Tab "Situazione" scadenzario per fornitore | Scadenzario | 1g | — |

**Effort Fase 1: ~3.3 giorni**

### FASE 2 — "Visibilità e Controllo" (Settimane 3-4)
> Obiettivo: dashbaord di controllo per CFO/advisor

| # | Feature | Area | Effort | Dipende da |
|---|---|---|---|---|
| 2.1 | Grafico proiezione saldo | Scadenzario | 1.5g | 1.4 |
| 2.2 | Pannello laterale dettaglio movimento | Movimenti | 1.5g | 1.1 |
| 2.3 | Pannello laterale dettaglio scadenza | Scadenzario | 1g | 1.5 |
| 2.4 | Dashboard Fatture (grafici + KPI) | Fatture | 2g | — |
| 2.5 | Calcolo IVA automatico | Fatture | 1g | 2.4 |

**Effort Fase 2: ~7 giorni**

### FASE 3 — "Intelligenza Operativa" (Settimane 5-7)
> Obiettivo: automazione e categorizzazione

| # | Feature | Area | Effort | Dipende da |
|---|---|---|---|---|
| 3.1 | Categorizzazione movimenti + regole | Movimenti | 2g | 1.1 |
| 3.2 | Cashflow consuntivo tabellare per categoria | Cashflow | 2g | 3.1 |
| 3.3 | Transizione Realizzato → Previsto | Cashflow | 1g | 3.2 |
| 3.4 | Link Scadenzario → Banche (cerca movimenti) | Scadenzario | 1g | 2.2 |
| 3.5 | Upload giustificativi | Movimenti | 1g | 2.2 |

**Effort Fase 3: ~7 giorni**

### FASE 4 — "Pianificazione Avanzata" (Settimane 8-9)
> Obiettivo: previsioni e budget interattivo

| # | Feature | Area | Effort | Dipende da |
|---|---|---|---|---|
| 4.1 | Celle editabili budget cashflow | Cashflow | 1.5g | 3.2 |
| 4.2 | Esportazione CSV/Excel cashflow | Cashflow | 0.5g | 3.2 |
| 4.3 | Dashboard conti (raggruppamento, IBAN, toggle) | Conti | 1.3g | — |
| 4.4 | Tab Ricevute/Emesse fatture | Fatture | 1g | 2.4 |

**Effort Fase 4: ~4.3 giorni**

---

## RIEPILOGO EFFORT

| Fase | Descrizione | Effort | Settimane |
|---|---|---|---|
| Fase 1 | Operatività Quotidiana | 3.3 giorni | 1-2 |
| Fase 2 | Visibilità e Controllo | 7 giorni | 3-4 |
| Fase 3 | Intelligenza Operativa | 7 giorni | 5-7 |
| Fase 4 | Pianificazione Avanzata | 4.3 giorni | 8-9 |
| **TOTALE** | | **~22 giorni** | **~9 settimane** |

---

## MODIFICHE DB NECESSARIE

Riassunte tutte le ALTER/CREATE che servono (da eseguire su Supabase):

```sql
-- Fase 1: Toggle verificato
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS verified_by UUID;

-- Fase 3: Categorizzazione
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS category_rule_id UUID;

CREATE TABLE IF NOT EXISTS movement_category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,        -- regex o LIKE pattern sulla descrizione
  category TEXT NOT NULL,
  priority INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fase 4: Budget cashflow
CREATE TABLE IF NOT EXISTS cashflow_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  year INT NOT NULL,
  month INT NOT NULL,           -- 1-12
  category TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  scenario TEXT DEFAULT 'base', -- base, ottimistico, pessimistico
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, year, month, category, scenario)
);
```

---

## NOTE STRATEGICHE

1. **Non replicare Sibill 1:1** — Il gestionale NZ ha feature che Sibill non ha (budget per outlet, confronto outlet, conto economico, dipendenti, contratti). L'obiettivo è prendere il meglio della UX bancaria/tesoreria di Sibill e integrarlo nel contesto multi-outlet di NZ.

2. **Categorizzazione è la chiave** — Molte feature (cashflow per categoria, analisi spese, regole automatiche) dipendono dalla categorizzazione dei movimenti. Investire bene nella Fase 3.1 sblocca tutto il resto.

3. **Side panel pattern** — Sibill usa il pannello laterale ovunque (movimenti, scadenze). Creare un componente riutilizzabile `SidePanel.jsx` una volta e riusarlo in tutte le aree.

4. **Dati reali come test** — Tutti i dati MPS sono già importati. Ogni feature va testata subito con dati veri per validare l'esperienza operatore.

5. **Non serve la fatturazione attiva** — New Zago non emette fatture. La dashboard fatture serve solo per le ricevute (acquisti) e il calcolo IVA.
