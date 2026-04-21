# Prompt per Cowork — Sessione post-consulenza Aprile 2025

## Cosa e' stato fatto (NON dal repo, ma direttamente su Supabase)

Nella sessione di consulenza abbiamo fatto modifiche DIRETTE al database di produzione che NON sono nel codice sorgente ma sono documentate nei file del repo. Leggi TUTTO prima di toccare qualsiasi cosa.

### 1. Fix ricavi — budget_entries
- Cambiato `account_code` da 'RIC001' a '510100' su tutte le righe ricavi
- Motivo: il frontend ConfrontoOutlet filtra con `account_code.startsWith("5")`, quindi 'RIC001' dava ricavi = 0
- **REGOLA: i ricavi devono SEMPRE usare account_code = '510100'**

### 2. Voci gap bilancio — 84 nuove righe in budget_entries
- Inserite 7 voci x 12 mesi come `cost_center = 'spese_non_divise'`
- Sono costi presenti nel bilancio ma assenti dai centri di costo operativi
- Totale: 122.389,31 EUR di costi aggiuntivi + 86,95 EUR di ricavi
- Account codes: CAT_69, CAT_71, ADJ_83, ADJ_63, ADJ_65, ADJ_61, ADJ_77
- **MAI eliminare queste righe**

### 3. Risultato atteso
- Ricavi totali: ~2.324.500 EUR
- Costi totali: ~2.526.055 EUR  
- Risultato: ~-201.555 EUR (quadra con bilancio ufficiale)
- Righe budget_entries anno 2025: 780

## File di riferimento da leggere

1. **CLAUDE.md** (root) — contiene la sezione "REGOLE CRITICHE" con tutti i dettagli
2. **supabase/migrations/20260421_007_budget_entries_fix_and_bilancio_gap.sql** — documentazione SQL completa con query di verifica
3. **docs/GestionaleNZ_Specifica_Roadmap_v1.docx** — specifica con framework allocazione costi e roadmap

## Prossime attivita' di sviluppo (in ordine di priorita')

### Priorita' 1: Sistema di Allocazione Fornitori
- Creare tabelle `supplier_allocation_rules` e `supplier_allocation_details`
- 4 modalita': DIRETTO, SPLIT %, SPLIT VALORE, QUOTE UGUALI
- UI per pagina "Definizione Divisione Fornitori"
- Dettagli completi nel docx in docs/

### Priorita' 2: Import Fatture e Corrispettivi da AdE
- Riprendere il lavoro sull'importazione da Agenzia delle Entrate
- Verificare stato certificati SDI in Vault

### Priorita' 3: Conto Bancario
- Creare 1 conto MPS con saldo 25.000 EUR e 10 movimenti di esempio

### Priorita' 4: Robustezza
- Verificare storage Supabase
- Strategia Git (pulire le tante cartelle dist_* nel repo?)
- CI/CD

## ATTENZIONE

Prima di qualsiasi migrazione o modifica a `budget_entries`:
1. Leggi CLAUDE.md sezione "REGOLE CRITICHE"
2. Esegui le query di verifica dal file migration 007
3. Se i numeri non tornano, FERMATI e chiedi a Patrizio
