# Lavoro notturno 15-16 Aprile 2026

## 1. Import Hub — Da 3/7 a 6/7 sorgenti funzionanti

### Nuovi processori creati in `importEngine.js`:

**processBalanceSheetPDF** — Bilanci PDF
- Legge PDF come ArrayBuffer (non come testo)
- Chiama `parseBilancio()` dal bilancioParser esistente
- Converte in record con `toSupabaseRecords()`
- Cancella dati precedenti per stesso anno prima di re-importare
- Inserisce in `balance_sheet_data` per alimentare ContoEconomico
- Mostra dettagli: attività, passività, costi, ricavi, risultato

**processReceiptsCSV** — Corrispettivi giornalieri
- Auto-mapping colonne: data, lordo, netto, IVA, scontrini, contanti, carta
- Calcola avg_ticket automaticamente
- Inserisce in `daily_revenue` con source='corrispettivi_import'
- Alimenta: AnalyticsPOS, Dashboard, ConfrontoOutlet

**processPayrollCSV** — Cedolini dipendenti
- Auto-mapping: cognome, nome, retribuzione, contributi, INAIL, TFR, netto
- Match automatico con dipendenti esistenti per cognome+nome
- Upsert: cancella costi precedenti per stesso mese/anno prima di inserire
- Report: dipendenti trovati vs non trovati
- Alimenta: Dipendenti, Produttività, BudgetControl

### Miglioramenti infrastruttura:
- `readFileContent()` ora supporta modalità binaria (`asBinary`) per PDF
- `previewImport()` supporta tutti i nuovi tipi
- `canProcess()` abilitato per balance_sheet, receipts, payroll
- Context passato con fiscal_year, month, year
- Nuovi auto-mapping: `autoReceiptsMapping()`, `autoPayrollMapping()`
- sourceMap batch: aggiunto 'pdf_bilancio', 'csv_cedolini'

### File modificati:
- `src/lib/parsers/importEngine.js` — da 323 a ~810 righe
- `src/pages/ImportHub.jsx` — canProcess aggiornato, context arricchito, dettagli risultato

---

## 2. Impostazioni — Fix critici e validazioni

### Bug critico risolto: COMPANY_ID
- `COMPANY_ID` era definito solo nel componente padre ma usato nei sotto-componenti
- Fix: passato come prop `companyId` a tutti e 4 i sotto-componenti
- CompanySection, UserSection, CostSection, CentriDiCostoSection

### Validazioni aggiunte:
- **P.IVA**: deve avere esattamente 11 cifre
- **Codice Fiscale**: minimo 11 caratteri
- **PEC**: deve contenere @
- **Quote soci**: totale non può superare 100%, ogni socio deve avere nome
- **Voci di costo**: codice duplicato bloccato, auto-referenza parent_id bloccata
- Guard `if (!COMPANY_ID)` prima di ogni operazione Supabase

### File modificato:
- `src/pages/Impostazioni.jsx`

---

## 3. Dipendenti — Sicurezza dati e funzionalità

### Bug critico risolto: company_id filtering
- Tutte le query ora filtrano per `company_id = COMPANY_ID`
- employees, employee_outlet_allocations, employee_costs, cost_centers, employee_documents
- Le allocazioni e i costi ora usano `.in('employee_id', empIds)` per sicurezza

### Nuove funzionalità:
- **Export CSV funzionante**: esporta tutti i dipendenti con costi per anno selezionato
  - Colonne: Cognome, Nome, Qualifica, Contratto, Outlet, Allocazione%, Mese, Retribuzione, Contributi, INAIL, TFR, Totale
  - Encoding UTF-8 con BOM per Excel italiano

### Validazioni aggiunte:
- Nome e cognome obbligatori
- Codice fiscale: esattamente 16 caratteri se presente
- Controllo duplicati: avviso se dipendente con stesso nome/cognome esiste già
- company_id aggiunto automaticamente alla creazione nuovo dipendente

### File modificato:
- `src/pages/Dipendenti.jsx`

---

## Stato Import Hub dopo il lavoro notturno

| Sorgente | Processore | Stato | Alimenta |
|----------|------------|-------|----------|
| Estratti Conto | processBankCSV | ✅ | Banche, Cashflow |
| Fatture Elettroniche | processInvoiceXML | ✅ | Scadenzario, Fornitori |
| POS Data | processPOSCSV | ✅ | Outlet, Analytics |
| Bilanci PDF | processBalanceSheetPDF | ✅ NEW | ContoEconomico |
| Corrispettivi | processReceiptsCSV | ✅ NEW | Analytics, Dashboard |
| Cedolini | processPayrollCSV | ✅ NEW | Dipendenti, Produttività |
| Documenti Generali | — (solo upload) | ⏳ | — |

**Build verificata**: compila senza errori.
