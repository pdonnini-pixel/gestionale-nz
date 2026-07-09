# Piano di pagamento fornitore + segnalazioni anomalie — Note di implementazione

> ## 📌 REGOLA — LEGGERE SEMPRE PRIMA DI TOCCARE IL CICLO PASSIVO
>
> Questo file va **letto per intero prima di qualsiasi lavoro sulla sezione Ciclo Passivo**
> (Fornitori, Fatturazione, Scadenzario) e prima di modificare fornitori, payables,
> `electronic_invoices`, il bridge A-Cube o le scadenze. Contiene le regole di piano
> pagamento, l'aggancio fornitore↔fattura **per P.IVA**, e i casi noti (es. Estenergy→Hera).
> Se una richiesta contraddice queste regole, **fermarsi e spiegare** invece di eseguire.

## Regola aggancio fornitore ↔ fattura (A-Cube / manuale)
- Il fornitore si crea/associa **per PARTITA IVA** (`sender_vat`), NON per nome. Il bridge
  `sync_acube_sdi_passive_to_payable` cerca `partita_iva = sender_vat OR vat_number = sender_vat`;
  se esiste lo riusa (nessun duplicato), altrimenti lo crea con il nome della prima fattura vista.
- Conseguenza: un fornitore che ha **cambiato ragione sociale** resta in anagrafica col nome
  vecchio ma con la stessa P.IVA (le nuove fatture si agganciano comunque). Cercare per nome
  può far sembrare un fornitore "assente" quando invece c'è: **verificare sempre per P.IVA**.
- Un fornitore creato **a mano senza P.IVA** genererà un DUPLICATO alla prima fattura A-Cube
  (che porta la P.IVA e non trova match per nome). Inserire sempre la P.IVA reale.

## Resoconto popolamento piani pagamento — 2026-07-09 (solo NZ)
Origine: file `SCADENZE_NEW_ZAGO_2026_x_code.xlsx` (6 fogli Giu→Nov, 508 righe), aggregato
per fornitore su **tutti i mesi** (non solo Giugno) per dedurre metodo/base/rate/banca.
- **92 fornitori** aggiornati con `payment_method`/`default_payment_method`, `payment_base`
  (DF/FM), `prima_scadenza_gg`, `numero_rate`, `payment_bank_account_id` (solo per metodi
  che richiedono banca). Solo UPDATE di campi vuoti, nessuna cancellazione.
- **HERA COMM S.p.A.** (P.IVA `03819031208`): era in anagrafica come **"Estenergy S.p.A."**
  (Estenergy confluita in Hera Comm, stessa P.IVA). Rinominato → HERA COMM e piano
  **RID / data fattura / 20gg / MPS**. 51 payables storici restano agganciati per P.IVA.
- **HUMATICS S.r.l. - Società Unipersonale** = nuova denominazione di **SYS-DAT Verona
  S.r.l.** (stessa società, P.IVA `03268520230`, già in anagrafica con 8 fatture + 9
  scadenze storiche). Il record SYS-DAT è stato **rinominato → HUMATICS** (P.IVA e storico
  invariati); piano **RI.BA / fine mese / 30gg / MPS**. Le fatture "Humatics" da A-Cube si
  agganciano per P.IVA. Il record "Humatics" creato a mano il 09/07 (senza P.IVA) era un
  duplicato → **soft-delete** (`is_deleted=true`).
- Banche NZ: MPS `e351d628-a150-4769-b965-9514deab48a3`, BCC `e3e82fb2-2661-4525-a25e-8960fc1123dc`,
  Intesa `549a983d-3fe1-4f9a-aed8-d5d5ed14f123`. `CASSA *` = contanti (nessuna banca).
- **Nota parità-tenant**: questo è **DATO specifico dei fornitori di New Zago** → NON si
  replica su Made/Zago (hanno fornitori/P.IVA diversi). La parità #0 vale per codice/migration,
  non per questi valori-dato.

---

Stato: **migration DB pronta** (`supabase/migrations/20260709_087_supplier_payment_plan_and_anomalies.sql`),
edge/import e frontend **da fare** (step successivi). Nessun dato toccato.

## Regole concordate (Patrizio)
- Si applica **solo alle fatture con data emissione ≥ 31/07/2026** e **solo se il fornitore ha il piano impostato**. Il **pregresso non si tocca** (nessun ricalcolo retroattivo).
- L'anomalia è a livello **fornitore** (la fattura ne fa capo). Sistemato il fornitore → si risolve per tutte le sue fatture.
- Badge rosso numerato su **Fatturazione** = n° fornitori con anomalia **aperta** (stato condiviso azienda). Sparisce **solo** quando `stato='risolta'`, per tutte le operatrici.
- **Banca di pagamento** sul fornitore, obbligatoria a seconda del metodo (serve per lo storno nelle simulazioni cashflow):
  - obbligatoria: `riba_*`, `rid`, `sdd_core`, `sdd_b2b`, `carta_credito`, `carta_debito`
  - facoltativa: `bonifico_*` (si sceglie al pagamento), `contanti`, `compensazione`, `mav`, `rav`, `bollettino_postale`, `f24`

## Algoritmo scadenze (già in `fn_supplier_installment_schedule`)
Importo per rata = **totale ÷ n° rate** (parti uguali, l'ultima assorbe l'arrotondamento).
Per ogni rata `i` (1..N):
- **DATA FATTURA (DF)** → a giorni: `due = emissione + (prima_gg + 30·(i−1))`
- **FINE MESE (FM)** → a mesi solari: `due = ultimo giorno del mese (emissione + N mesi)`, con `N = prima_gg/30 + (i−1)`

Esempi verificati:
| Config | Emiss. | Scadenze |
|---|---|---|
| FM 30/60/90 · 1200 | 30/06/26 | 31/07 · 31/08 · 30/09 (400) |
| DF 30/60/90 · 1200 | 30/06/26 | 30/07 · 29/08 · 28/09 (400) |
| FM 30gg · 900 | 31/01/26 | **28/02/26** |
| FM 30gg · 900 | 31/01/28 (bisestile) | **29/02/28** |
| FM 30gg | 17/07/26 | 31/08/26 |

## Config fornitore (colonne aggiunte a `suppliers`)
- `payment_method` (già esistente, enum `payment_method`)
- `payment_base` = `data_fattura` | `fine_mese`
- `prima_scadenza_gg` (30/60/90…)
- `numero_rate` (1,2,3…)
- `payment_bank_account_id` → FK `bank_accounts(id)`

## Segnalazioni: tabella `payment_import_anomalies`
Stato condiviso azienda (`aperta`/`risolta`), una sola aperta per `(company, fornitore, tipo)`.
Tipi + "come risolvere" (`come_risolvere`):
| anomaly_type | quando | come risolvere |
|---|---|---|
| `metodo_mancante` | fornitore senza metodo | Fornitori › [nome] → imposta metodo |
| `banca_mancante` | metodo che richiede banca (RI.BA/carta/RID) ma manca | assegna la banca di pagamento |
| `piano_incompleto` | RI.BA senza base/giorni/n° rate | completa il piano |
| `importo_non_quadra` | somma rate ≠ lordo / lordo assente | verifica importo fattura |
| `fornitore_non_riconosciuto` | fattura da fornitore non in anagrafica | crea/associa il fornitore |

Helper `fn_supplier_config_anomaly(supplier_id)` ritorna i primi tre tipi (o NULL). Gli altri due (`importo_non_quadra`, `fornitore_non_riconosciuto`) li rileva il flusso di import.

## STATO IMPLEMENTAZIONE

✅ **FATTO in questo branch:**
- Migration `087` — schema (4 campi fornitore, tabella anomalie, funzioni pure di calcolo/anomalia). **Applicata e verificata su NZ + Made + Zago.**
- Migration `088` — motore anomalie: `rpc_refresh_payment_anomalies()` (apre/risolve le anomalie di config per i fornitori con fatture ≥ 31/07) e `rpc_resolve_payment_anomaly()`. **Da applicare a mano su NZ + Made + Zago** (query in coda al file).
- Frontend:
  - `Fornitori.tsx` — form fornitore con i 4 campi (base DF/FM, 1ª scadenza gg, n° rate, banca) + avviso banca-obbligatoria per metodo. Deep-link `?edit=<id>`.
  - `Sidebar.tsx` + `Layout.tsx` — **badge rosso numerato** su Fatturazione = anomalie aperte (aggiornamento live all'evento `fatt-anomalia-risolta`).
  - `components/PaymentAnomaliesPanel.tsx` + `Fatturazione.tsx` — pannello segnalazioni con descrizione + "come risolvere" + "Vai al fornitore" + "Risolto".
- `npm run build` OK; nuovi file type-clean.

✅ **FATTO — Generazione rate all'import (migration 089, applicata su NZ+Made+Zago):**
Scoperta: il bridge A-Cube (`sync_acube_sdi_passive_to_payable`) **genera già** le
scadenze dallo scadenzario dell'XML (DatiPagamento) quando presente. La 089
aggiunge, **solo nel ramo fallback** (XML senza scadenzario), la generazione dal
**piano fornitore** via `fn_supplier_installment_schedule()`:
- guardia `emissione >= 31/07/2026` (oggi 0 fatture → zero effetto sul pregresso)
- **opt-in per fornitore**: agisce solo se `payment_base` e `numero_rate` sono
  impostati; senza piano il comportamento resta identico a oggi (rata unica)
- assegna metodo e `payment_bank_account_id` del fornitore; `acube_uuid` solo sulla
  rata 1; `on conflict do nothing` anti-duplicato
- il ramo XML-con-scadenzario (n>=2) **non è toccato**.

Validazione: funzione ridistribuita senza errori su tutti e 3 i tenant; vincoli di
unicità payables compatibili (installment_number distinto). La verifica end-to-end
avverrà sulla prima fattura reale ≥ 31/07 da fornitore configurato.

Nota: le anomalie di configurazione (metodo/banca/piano mancanti) vengono comunque
rilevate e mostrate dal badge/pannello Fatturazione (087/088).
Aggancio al flusso che crea i payables dall'import SDI A-Cube (bridge `trg_sync_acube_sdi_passive` / edge `acube-cf-sync-invoices`). Logica:
1. Solo se `electronic_invoices.invoice_date >= '2026-07-31'`.
2. Risali al fornitore. Se non riconosciuto → anomalia `fornitore_non_riconosciuto`.
3. `fn_supplier_config_anomaly(supplier_id)`: se != NULL → apri quella anomalia (upsert su indice unico), **non** generare rate.
4. Altrimenti: `fn_supplier_installment_schedule(...)` → crea N righe `payables` con `installment_number/installment_total/due_date`, e `payment_bank_account_id` dalla banca del fornitore (per riba/carta).
5. Se la somma rate ≠ gross (post arrotondamento) o gross assente → anomalia `importo_non_quadra`.
6. Alla risoluzione (operatrice sistema + "Rigenera scadenze"): se `fn_supplier_config_anomaly` ora è NULL e le rate quadrano → set `stato='risolta'`.

Nota: NON modificare il bridge 029 direttamente (come da 053); usare flusso additivo/separato e attivo solo per emissione ≥ 31/07.

### B) Frontend
- **Form fornitore**: 4 campi (base DF/FM, prima scadenza gg, n° rate, banca) con validazione banca-obbligatoria per metodo.
- **Badge rosso** su voce sidebar *Fatturazione* = `count(payment_import_anomalies where stato='aperta')`.
- **Pannello anomalie** in Fatturazione: lista con `descrizione` + `come_risolvere`, link al fornitore, bottoni **Rigenera scadenze** / **Segna risolto**.

## Applicazione (Regola #0 — parità tenant)
La migration 087 va applicata **a mano su NZ + Made + Zago** dal dashboard Supabase. È additiva, idempotente, non distruttiva.
