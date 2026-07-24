# FASE 1 — Mappa esaustiva delle variabili: riconciliazione movimenti bancari ↔ fatture

> Documento di analisi (NESSUN codice). Contesto: **Gestionale NZ v2.0**, ciclo passivo/attivo
> multi-tenant (NZ + Made + Zago), Open Banking + SDI via **A-Cube**.
> Obiettivo: enumerare TUTTO ciò che fa variare l'accoppiamento movimento↔fattura, prima di
> progettare il motore (Fase 2). Riferimento normativo primario: **Italia** (SDI, IVA, SEPA).
>
> ⛔ Al termine ci si ferma per conferma di Patrizio prima della Fase 2.

---

## 0. Cosa esiste GIÀ in questo sistema (grounding — non partire da zero)

Prima di enumerare, fotografo il motore attuale, perché la Fase 2 dovrà **estenderlo**, non
riscriverlo (regola no-data-loss + parità tenant).

**Tabelle vive coinvolte** (baseline `20260417_000`):
- `bank_transactions` — movimento bancario. Campi chiave: `transaction_date`, `value_date`,
  `booking_date`, `amount` (segno: <0 uscita, >0 entrata), `currency`, `description`,
  `counterpart` / `counterpart_name` / `counterpart_iban`, `reference`, `category`,
  `status` (BOOKED/booked/pending), `source`, `raw_data` (jsonb), `is_reconciled`,
  `reconciled_at`, `supplier_id`, `invoice_id` / `reconciled_invoice_id`,
  `payment_schedule_id`, dedup hash (`046`, `051`, `080`).
- `electronic_invoices` — fattura elettronica (attiva/passiva). Campi: `invoice_number`,
  `invoice_date`, `supplier_name`, `supplier_vat`, `net_amount`/`vat_amount`/`gross_amount`,
  `due_date`, `payment_method`, `payment_terms`, `sdi_id`, `sdi_status`, `tipo_documento`
  (TD01…), `xml_content`, `is_reconciled`, `cash_movement_id`.
- `payables` — scadenza/rata di pagamento (deriva dalla fattura). Campi: `invoice_number`,
  `invoice_date`, `due_date`/`original_due_date`/`postponed_to`, `gross_amount`,
  `amount_paid`, `amount_remaining` (ricalcolato dal trigger `update_payable_status`),
  `status` (`da_pagare`/`scaduto`/`pagato`/…), `installment_number`/`installment_total`,
  `supplier_vat`, `iban`, `closed_manually` (085), `is_placeholder` (dedup 106),
  `is_forecast` (045), `cash_movement_id`, `payment_bank_account_id`.
- `reconciliation_log` — audit degli abbinamenti (status, `bank_transaction_id`,
  `applied_amount`, score per asse).
- `payable_credit_note_links` — intenzione di compensazione fattura↔nota di credito (090,
  stato `pending`/consumato).

**Motore attuale** (RECONCILIATION_NOTES.md — waterfall, trigger su INSERT + cron 05:45 UTC):
1. **Granitico gruppo** `try_match_group_bank_transaction`: fornitore + numero/i fattura in
   causale, somma esatta (incl. pagamenti cumulativi e fattura−NC). Auto, no conferma.
2. **A punteggio** `try_match_bank_transaction` (engine v2, migr. 032): 3 assi —
   **importo 50pt** (`50 − diff%·5`), **nome/VAT 30pt** (VAT in causale=30, name=25, altrimenti
   `similarity()·30`), **data 20pt** (`20 − giorni_diff`). Soglia match 50, **auto ≥80**,
   50–80 → proposta.
3. **Biettivo per data** `rerun_bijective_reconciliation`: costi ricorrenti a importo fisso,
   1-a-1 sulla data più vicina, senza riuso.
4. **A importo, causale anonima** `try_match_amount_bank_transaction` (migr. 110): flussi CBI
   senza nome/numero; auto solo se candidato **unico**, altrimenti proposta.
5. Contorno: `close_non_supplier_movements` (commissioni/carte/F24/stipendi → chiusi senza
   fattura), `close_paid_fiscal_deadlines` (scadenze fiscali/paga pagate a gruppi).
- **Commissioni CBI scorporate**: la causale porta `IMPORTO BONIFICI` (netto) + `IMPORTO
  COMMISSIONI`; si confronta il **netto**, non il lordo (±1,75 non deve rompere il match).
- Manuali: `reconcile_movement`, `reconcile_movement_group`, `undo_reconcile_movement`.

**Buchi noti oggi** (cosa la Fase 2 deve chiudere, e che la tassonomia sotto sistematizza):
il matching è quasi tutto **passivo** (uscite → payables); l'**attivo** (incassi → fatture di
vendita) è scoperto; ritenuta d'acconto/rivalsa cassa/split payment non hanno uno scarto
"spiegato" strutturato; i PSP (POS/Nexi/Stripe) non hanno un modello di riconciliazione lordo↔netto
commissioni; l'apprendimento dalle correzioni manuali non è formalizzato.

---

## Dimensione 1 — Fonti e formati dei dati

### 1.1 Formati di estratto conto
| Voce | (a) cos'è | (b) nei dati | (c) perché rompe | (d) come gestire |
|---|---|---|---|---|
| **CAMT.053** (rendiconto giornaliero ISO 20022) | XML strutturato entries `Ntry` con `Amt`, `CdtDbtInd`, `BookgDt`/`ValDt`, `NtryDtls/TxDtls` (RmtInf, RltdPties, Refs) | campi ricchi ma annidati; `RmtInf/Ustrd` = causale libera; `EndToEndId`, `InstrId` | i parser CSV ignorano i sotto-campi strutturati (E2E ref, IBAN controparte) → si butta il segnale migliore | mappare `TxDtls` in colonne dedicate: `reference`(E2E), `counterpart_iban`, `remittance_info` |
| **CAMT.052/054** (intraday / notifica debit-credit) | movimenti provvisori / avvisi | possono duplicare o anticipare il .053; status `pending` | doppio conteggio se importati insieme al .053 | dedup per E2E/hash; usare .052/054 solo per anticipare, riconciliare sul .053 |
| **MT940/MT942** (SWIFT legacy) | testo a tag `:61:`/`:86:` | `:86:` = blob non standard, causale ABI mescolata | parsing del `:86:` varia per banca; IBAN controparte spesso assente | parser per-banca del tag `:86:`; degradare a "causale libera" |
| **CBI / CBI2** (interbancario IT) | tracciati distinta/esiti, flussi `DISPOSIZIONE - FILIALE DISPONENTE …` | causale porta **LORDO** + `IMPORTO BONIFICI`/`IMPORTO COMMISSIONI`; spesso **senza nome/numero** | importo lordo ≠ importo fattura; nessun riferimento controparte | leggere i campi strutturati dalla causale (già fatto, migr. 110); confrontare il **netto** |
| **OFX/QIF** | export home-banking | pochi campi, causale libera, no IBAN | zero riferimenti strutturati | trattare come CSV povero |
| **CSV export banca** | colonne non standard per banca | intestazioni diverse, decimali IT/EN, date miste | mapping fragile, `1.234,56` vs `1,234.56` | mapping per-banca + normalizzazione robusta importi/date |
| **PDF / scansione** | estratto stampato / OCR | testo non tabellare, OCR con refusi | numeri corrotti (0/O, 1/l), righe spezzate | OCR + validazione con saldo progressivo; sempre revisione umana |
| **API PSD2 / Open Banking (A-Cube)** | JSON per movimento | `status` `booked`/`pending`, `remittanceInformation`, `creditorName`/`debtorName`, IBAN, `raw_data` | `booked` (non `posted`) va incluso; PSD2 tronca a volte la remittance | processare `booked` (già fatto, migr. 103); conservare `raw_data` |

### 1.2 Campi del movimento (semantica che spesso si perde)
- **Data contabile vs data valuta** (`transaction_date`/`booking_date` vs `value_date`): il match
  temporale va fatto su una finestra che le comprenda entrambe (la valuta può precedere/seguire).
- **Segno** (`amount`): <0 = uscita (candidati = payables/fatture passive), >0 = entrata
  (candidati = fatture attive/incassi). Convenzione da fissare e validare per ogni sorgente.
- **Causale ABI / descrizione libera**: dove vive quasi tutto il segnale testuale (nome, numero
  fattura, IBAN, riferimenti). Fortemente non standardizzata.
- **CRO / TRN / EndToEndId / reference**: identificativo univoco del bonifico; **potenzialmente
  la chiave più forte** se lo si trova anche sul lato fattura (raro in IT, ma esiste per RiBa/SDD).
- **Saldo progressivo** (`running_balance`/`balance_after`): usabile come **checksum**
  (movimenti ordinati devono ricostruire il saldo) e per scovare import mancanti/duplicati.

### 1.3 Campi della fattura elettronica (XML SDI) rilevanti
Numero, data, **Cedente/Prestatore** (P.IVA/CF, denominazione), **Cessionario/Committente**,
`DatiBeniServizi` (imponibile, aliquote, imposta), **TotaleDocumento**, e soprattutto:
- `DatiPagamento/DettaglioPagamento`: **ModalitàPagamento** (MP05 bonifico, MP08 carta,
  MP12 RiBa, MP19 SEPA SDD…), **IBAN**, **DataScadenzaPagamento**, **ImportoPagamento**
  (per rate: N dettagli). → è la fonte primaria dei `payables`/scadenze e dell'IBAN atteso.
- `DatiRitenuta` (ritenuta d'acconto: tipo, importo, aliquota, causale).
- `DatiCassaPrevidenziale` (rivalsa INPS 4% / cassa professionale, con eventuale IVA e ritenuta).
- `DatiBollo` (bollo 2€ su esenti/fuori campo > 77,47€).
- `DatiRitenuta`+`EsigibilitaIVA` (`S`=split payment, `D`=differita/IVA per cassa, `I`=immediata).
- `TipoDocumento`: TD01 fattura, TD04 **nota di credito**, TD05 nota debito, TD16/17/18/19
  **autofatture/reverse charge**, TD24/25 differita, TD08 storno. Il segno atteso cambia.
- `DatiOrdineAcquisto/CIG/CUP` (PA / tracciabilità L.136/2010).
- **Attiva vs passiva**: se il Cedente = nostra P.IVA → **attiva** (incasso, `amount>0`);
  se il Cessionario = nostra P.IVA → **passiva** (pagamento, `amount<0`).

---

## Dimensione 2 — Variabili sull'IMPORTO (perché il numero non torna)

Per tutte: (c) un match "importo esatto al centesimo" fallisce; serve uno **scarto spiegato**.

| Voce | (a)/(b) manifestazione | scarto tipico | (d) segnale/gestione |
|---|---|---|---|
| **Ritenuta d'acconto** | professionista: si versa netto = imponibile − ritenuta (20% su compenso, o 23% su base). `DatiRitenuta` in XML | movimento **minore** della fattura | se XML ha `DatiRitenuta`: netto atteso = totale − ritenuta; scarto spiegato "ritenuta" |
| **Rivalsa/cassa previdenziale** (INPS 4%, casse) | aumenta l'imponibile; `DatiCassaPrevidenziale` | movimento **maggiore** dell'imponibile base | usare TotaleDocumento (già comprensivo), non l'imponibile |
| **Split payment (scissione pagamenti)** | PA/`EsigibilitaIVA=S`: si paga solo **imponibile**, l'IVA la versa il cliente all'Erario | movimento = imponibile (no IVA) | se `S`: importo atteso = `net_amount`, non `gross_amount` |
| **Reverse charge** | fattura senza IVA a debito (art.17); autofattura integrativa | totale = imponibile; nessuna IVA in banca | atteso = imponibile; nessun movimento IVA separato |
| **Bollo 2€** | su esenti/fuori campo; a volte a carico cliente in fattura | movimento = totale + 2€ (o −2€ se a carico ns.) | tolleranza fissa 2€ come scarto "bollo" |
| **Commissioni/spese bancarie trattenute** | bonifico estero/urgente, spese incasso RiBa/SDD | movimento netto della commissione (es. −1,75 CBI) | leggere `IMPORTO COMMISSIONI`; tolleranza "commissione" |
| **Commissioni PSP su incassi** (POS/Nexi, Stripe, PayPal, Satispay, Scalapay) | l'accredito arriva **al netto** della fee (1–3%), spesso **aggregato** per giornata | incasso banca < somma fatturato lordo | modello a 2 livelli: incasso PSP netto ↔ report PSP ↔ fatture; fee = scarto "commissione PSP" |
| **Note di credito (totali/parziali)** | riduzione del dovuto; TD04 | movimento = fattura − NC | sommare fattura − NC (già in `try_match_group_*` / `payable_credit_note_links`) |
| **Sconto cassa / abbuono** | sconto per pagamento pronta cassa; abbuono attivo/passivo su arrotondamento | movimento leggermente minore | tolleranza "abbuono" (soglia €/‰ configurabile) |
| **Arrotondamenti** | centesimi su rate `totale/N` | ±0,01–0,02 per rata | ultima rata assorbe (già `fn_supplier_installment_schedule`); tolleranza 0,02 |
| **Acconti e saldi** | pagamento in 2+ momenti (30% + saldo) | ogni movimento < totale | cardinalità N:1 (vedi Dim.3); tracciare `amount_paid` cumulato |
| **Cambio valuta / differenze cambio** | fattura in EUR, incasso in valuta o viceversa | scarto per tasso + spese cambio | usare `currency`; scarto "cambio" con tasso del giorno |
| **Insoluti / storni** | RiBa/SDD tornata indietro; storno banca | movimento **positivo** che annulla un'uscita (o viceversa) | riconoscere coppia storno; riaprire la scadenza |
| **IVA per cassa (art.32-bis)** | esigibilità differita all'incasso | tempistica, non importo | flag `EsigibilitaIVA=D`: rilassare la finestra temporale |

---

## Dimensione 3 — Variabili sulla CARDINALITÀ (non è 1:1)

| Voce | (b) come appare | (c) perché rompe | (d) gestione |
|---|---|---|---|
| **1:1** | un movimento = una fattura | caso base | match diretto |
| **1:N** (un bonifico → N fatture) | causale "SALDO FATT 5421+5422"; importo = somma | nessuna singola fattura pareggia | subset-sum su fatture stesso fornitore/finestra (già `try_match_group_*`) |
| **N:1** (una fattura in più tranche/rate) | acconto+saldo, RiBa mensili | ogni movimento < fattura | accumulo su `amount_paid`; stato `parziale` finché somma = gross |
| **N:M** | distinta cumulativa che paga più fatture con più NC | esplosione combinatoria | subset-sum bilaterale con vincoli (fornitore, finestra, cap importo) |
| **Movimento senza fattura** | giroconti tra conti propri, stipendi, F24/imposte, contributi INPS, interessi, prelievi contanti, commissioni | nessun candidato fattura → falsi "non riconciliato" | categorizzare e **chiudere senza fattura** (già `close_non_supplier_movements`) |
| **Fattura senza movimento** | non pagata, compensata, permuta/baratto, cessione credito/factoring, pagata contanti/altro conto | resta aperta pur essendo "sistemata" | stati: `da_pagare` vs `compensata`/`ceduta`; non forzare match |
| **Giroconto interno** | uscita conto A = entrata conto B, stesso importo/data | due movimenti, zero fatture, rischio doppio conteggio | rilevare coppia inter-account; marcare `giroconto`, escludere da cashflow |

---

## Dimensione 4 — RIFERIMENTI e IDENTITÀ (perché il collegamento è ambiguo)

| Voce | (b) manifestazione | (c) perché rompe | (d) gestione |
|---|---|---|---|
| **Numero fattura in mille formati** | `Fatt. 5421`, `FT5421`, `n.5421/2026`, `2026/5421`, `INV-5421`, con/senza anno, zeri iniziali | regex ingenua non li cattura tutti; `5421` vs `05421` | estrattore tollerante + normalizzazione (strip zeri, separa anno) |
| **Numeri corti (2–3 cifre)** | `FT 11`, `12` | troppi falsi positivi da soli | accettare solo con **contesto fattura + somma esatta** (già migr. 093/111) |
| **Più numeri nella stessa causale** | "SALDO 5421 5422 5423" | quale/quali? | estrarre lista, provare subset-sum |
| **Numero assente** | flussi CBI anonimi | nessun riferimento testuale | fallback a importo+controparte, o proposta (migr. 110) |
| **Ragione sociale vs nome commerciale vs sigla** | "HERA COMM" in anagrafica ma "Estenergy"/"Gruppo Hera" in causale | name-match fallisce | **chiave = P.IVA**, non nome (regola PAYMENT_PLAN); alias/`similarity()` come ripiego |
| **Cambio ragione sociale** | SYS-DAT→HUMATICS, Estenergy→Hera (stessa P.IVA) | nome nuovo ≠ anagrafica | agganciare per `supplier_vat`; nome è secondario |
| **P.IVA/CF assente in causale** | bonifici privati, home-banking | non c'è la chiave forte | ricadere su IBAN/importo/data |
| **IBAN come chiave** | `counterpart_iban` vs `DatiPagamento/IBAN` del fornitore | l'IBAN del fornitore può cambiare / averne più d'uno | mappa IBAN→fornitore appresa; ma un IBAN ≠ garanzia di unicità |
| **Omonimie / stesso IBAN più controparti** | IBAN di un PSP/commercialista che incassa per più soggetti | IBAN non identifica il vero creditore | non usare IBAN da solo per PSP/intermediari |
| **Intermediari / PSP per conto terzi** | Amazon/marketplace, Stripe, agenzia che incassa e gira | controparte banca ≠ cliente della fattura | riconciliazione a 2 stadi (banca↔PSP↔fatture) |
| **Gruppo vs consociata** | fattura a capogruppo, paga la controllata (P.IVA diversa) | P.IVA pagante ≠ P.IVA fattura | mappa relazioni infragruppo (config) |

---

## Dimensione 5 — Variabili TEMPORALI

| Voce | (b)/(c) | (d) gestione |
|---|---|---|
| **Sfasamento pagamento vs scadenza** | si paga prima/dopo la `due_date` | finestra asimmetrica configurabile (es. −10/+60 gg) |
| **Data valuta vs contabile** | differiscono di 1–3 gg | match su intervallo che copre entrambe |
| **Pagamenti anticipati/tardivi** | acconti mesi prima; insoluti mesi dopo | non usare la data come vincolo rigido; solo come score |
| **Ricorrenti (SDD/RID, RiBa, canoni)** | stesso importo ogni mese, N fatture simili | rischio di agganciare il mese sbagliato | **biettivo per data** 1-a-1 (già `rerun_bijective`) |
| **Competenza vs cassa** | fattura fine mese, pagata mese dopo; chiusure periodo | la fattura del mese M si abbina a un movimento M+1 | finestra a cavallo mese/trimestre |
| **Chiusura di periodo / anno** | movimenti a cavallo 31/12 | rischio di non trovare il partner nell'anno importato | non limitare i candidati all'anno del movimento |

---

## Dimensione 6 — STRUMENTI di pagamento/incasso (ognuno lascia tracce diverse)

| Strumento | traccia in E/C | info persa | segnale utile |
|---|---|---|---|
| **Bonifico SEPA (SCT)** | causale libera + IBAN controparte + E2E | dipende da chi compila la causale | E2E ref, IBAN, testo causale |
| **Bonifico istantaneo (SCT Inst)** | come SCT, valuta = contabile | — | data secca affidabile |
| **RiBa** | "EFFETTI RITIRATI"/"INSOLUTO RIBA", a gruppi mensili | singola fattura spesso non citata | importo+scadenza mensile; insoluto = storno |
| **SDD/RID** | addebito ricorrente, "SEPA DD", mandato | numero fattura raro | mandato/creditore + importo ricorrente |
| **MAV/RAV** | bollettino con codice MAV | fattura non citata | codice MAV ↔ ente |
| **F24** | "DELEGA F24", importo cumulato tributi | nessuna fattura | chiudere senza fattura (imposte) |
| **PagoPA** | "PAGOPA"/IUV | fattura non citata | IUV ↔ avviso |
| **Assegno** | "ASSEGNO N…", data versamento ≠ emissione | beneficiario non strutturato | resta manuale spesso |
| **Carta/POS (uscita)** | "PAGAMENTO POS", merchant | numero fattura assente | merchant→fornitore; spesso no fattura |
| **PSP incassi** (Stripe/PayPal/Nexi/Satispay/Scalapay) | accredito **netto aggregato** giornaliero | mapping ai singoli ordini/fatture | report PSP come ponte; fee = scarto |
| **Contanti** | nessuna traccia bancaria | fattura pagata senza movimento | fattura senza movimento (legittima) |
| **Compensazione** | nessun movimento | credito↔debito azzerati | stato `compensata`, non match |

---

## Dimensione 7 — RUMORE, qualità del dato, normalizzazione

- **Descrizioni non standardizzate**: maiuscole/minuscole, abbreviazioni, troncamenti PSD2.
- **Encoding/accenti**: `Società`/`Societa'`/`Societ&agrave;`; UTF-8 vs latin-1; da normalizzare (lower + strip accenti).
- **Refusi/abbreviazioni**: `S.p.A`/`SPA`/`S P A`, `S.r.l.`/`Srl`.
- **Campi mancanti/troncati**: remittance tagliata a 140 char; IBAN parziale.
- **Duplicati**: stesso movimento importato da .052 e .053, o re-import; gestito via
  `import_dedup_hash`/`unified_dedup` (046/051/080) — ma serve robustezza cross-formato.
- **Movimenti tecnici/di storno**: rettifiche banca, giroconti tecnici.
- **Importi in centesimi vs euro**: alcune API danno `12345` = 123,45.
- **Separatori decimali/migliaia**: IT `1.234,56` vs EN `1,234.56`.
- **Valute**: default EUR ma possibili multi-valuta.
- **Numeri fattura non univoci nel tempo**: la numerazione riparte ogni anno → `numero+anno` è la chiave, non il solo numero.

---

## Dimensione 8 — Regole di business / edge case ITALIANI

- **Split payment PA** (`EsigibilitaIVA=S`): paghi imponibile, non il totale. *[IT-specifico]*
- **Reverse charge** (art.17 DPR 633): fattura senza IVA a debito; autofatture TD16-19. *[IT/UE]*
- **Ritenuta d'acconto professionisti** (20%/23%): versi netto. *[IT-specifico]*
- **Rivalsa INPS 4% / cassa professionale**: aumenta il dovuto. *[IT-specifico]*
- **IVA per cassa** (art.32-bis): esigibilità all'incasso → timing. *[IT-specifico]*
- **Autofatture / integrazioni**: movimento IVA verso Erario, non verso fornitore. *[IT]*
- **Note di credito** (TD04): riducono/annullano; possono arrivare dopo il pagamento. *[IT/UE]*
- **Compensazione** (art.1241 c.c.): credito↔debito, nessun movimento. *[IT]*
- **Cessione del credito / anticipo fatture / factoring**: incassa il factor, non tu; il
  cliente paga il factor. Movimento = anticipo del factor (netto di commissioni/interessi). *[IT/UE]*
- **Insoluti RiBa**: addebito di ritorno che riapre la posizione. *[IT-specifico]*
- **Plafond IVA / esportatori abituali** (dich. d'intento): fatture senza IVA; totale=imponibile. *[IT]*
- **Bollo 2€** su esenti/fuori campo > 77,47€. *[IT-specifico]*
- **Enasarco/contributi agenti**, **ritenuta condominio 4%**: scarti specifici. *[IT]*

---

## Dimensioni AGGIUNTIVE (auto-critica: "cosa manca?")

> Applicando la regola "aggiungi ≥3 casi finché non trovi più nulla", emergono dimensioni non
> nell'elenco originale ma decisive in questo sistema:

**9. Ciclo di vita & stato (lifecycle)** — una fattura può essere: aperta, in distinta ("in
sospeso" = filtro UI, NON stato DB), chiusa a mano (`closed_manually`, senza movimento),
placeholder/doppione (`is_placeholder`), forecast (`is_forecast`), con NC pending. Il motore
deve considerare **candidati = aperte + chiuse-a-mano non ancora agganciate** (regola granitica
2026-07-24), altrimenti perde il bonifico "orfano".

**10. Idempotenza & re-run** — trigger su INSERT + cron notturno + re-import storico: lo stesso
movimento passa più volte nel motore. Ogni abbinamento deve essere **reversibile**
(`undo_reconcile_movement`) e **non duplicabile** (no doppio `amount_paid`). `amount_remaining`
è ricalcolato dal trigger: la compensazione va su `amount_paid`, mai set diretto (caso noto).

**11. Multi-tenant & multi-outlet** — 3 tenant fisici (parità #0) + allocazione costo per outlet
(diretto/split%/valore/quote-uguali). Un movimento può riferirsi a una fattura poi splittata su
N outlet: la riconciliazione è a livello fattura, l'allocazione è a valle. Mai P.IVA/UUID hardcoded.

**12. Fiducia & automazione graduata** — non "match/no-match" ma **confidenza + stato**:
certo→auto, incerto→proposta, mai chiusure al buio (regola "quando è certo chiudi, quando dubiti
proponi"). Lo scarto deve essere **spiegato** (ritenuta? commissione? split?), non solo numerico.

**13. Apprendimento dalle correzioni** — le conferme/annullamenti manuali dell'operatrice sono
segnale: alias fornitore, mappe IBAN→fornitore, pattern causale ricorrenti. Oggi non formalizzato.

**14. Sicurezza & audit** — RLS per `company_id`, audit trail completo (`reconciliation_log`,
`payable_actions`), spiegabilità di ogni decisione automatica (chi/come/perché).

---

## Checklist delle CHIAVI di matching (con affidabilità stimata)

| Chiave | Dove | Affidabilità | Note |
|---|---|---|---|
| **CRO/TRN/EndToEndId** identico su banca e fattura | E2E / RmtInf | ⭐⭐⭐⭐⭐ quasi certa | raro che la fattura IT lo riporti; fortissima quando c'è (SDD/RiBa) |
| **Numero fattura (normalizzato) + P.IVA + importo esatto** | causale + XML | ⭐⭐⭐⭐⭐ | pilastro del match granitico |
| **Numero fattura (lungo) + importo esatto** | causale | ⭐⭐⭐⭐ | rischio numeri riusati tra anni → aggiungere anno |
| **P.IVA in causale + importo (netto spiegato)** | causale | ⭐⭐⭐⭐ | P.IVA è la chiave identità preferita (no nome) |
| **Subset-sum fatture stesso fornitore = importo** | payables | ⭐⭐⭐⭐ se fornitore certo | cumulativi/NC; combinatoria da limitare |
| **IBAN controparte → fornitore + importo** | `counterpart_iban` | ⭐⭐⭐ | fragile per PSP/intermediari/IBAN condivisi |
| **Nome controparte (fuzzy) + importo + data** | `counterpart_name` | ⭐⭐⭐ | omonimie, cambio ragione sociale |
| **Importo esatto + finestra temporale (no nome)** | — | ⭐⭐ | solo se candidato **unico** → altrimenti proposta |
| **Importo con tolleranza (scarto spiegato) + fornitore** | — | ⭐⭐⭐ se scarto tipizzato | ritenuta/commissione/split |
| **Solo importo** | — | ⭐ | mai auto; troppi collisioni |
| **Solo data / solo nome** | — | ⭐ | mai da sole |
| **Ricorrente biettivo (fornitore fisso, 1-a-1 su data)** | — | ⭐⭐⭐⭐ nel suo dominio | canoni/abbonamenti a importo fisso |

**Principio**: affidabilità = **specificità della chiave** (E2E/numero+P.IVA) × **esattezza importo
(o scarto spiegato)** × **unicità del candidato**. L'auto scatta solo con chiave forte + candidato unico.

---

## Matrice dei casi (30 scenari: reale → perché il match ingenuo fallisce → segnale utile)

| # | Situazione reale | Perché il match ingenuo fallisce | Segnale utile per riconoscerla |
|---|---|---|---|
| 1 | Bonifico paga 1 fattura, importo esatto, numero in causale | — (caso base, ma spesso non c'è il numero) | numero norm. + P.IVA + importo |
| 2 | Sforazzini: 466,95 = fatt. 5421+5422 (1:N) | nessuna singola fattura = 466,95 | subset-sum stesso fornitore |
| 3 | Studio Poli CBI: lordo 2.751,75 (=2.750+1,75 comm.), causale anonima | importo lordo ≠ fattura, nessun nome/numero | `IMPORTO BONIFICI`/`COMMISSIONI` → netto; candidato unico |
| 4 | Professionista: fattura 1.000, versato 800 (ritenuta 20%) | −200 rompe l'importo | `DatiRitenuta` in XML → netto atteso 800 |
| 5 | Fattura PA split payment: totale 1.220, pagato 1.000 (imponibile) | −220 IVA rompe | `EsigibilitaIVA=S` → atteso = net_amount |
| 6 | Cassa 4%: imponibile 1.000, dovuto 1.040+IVA | +40 rispetto all'imponibile | `DatiCassaPrevidenziale` → usare TotaleDocumento |
| 7 | Incasso Nexi POS: accredito giornaliero netto commissioni, aggregato | 1 movimento vs N vendite, importo netto | report PSP come ponte; fee = scarto |
| 8 | Stripe payout settimanale netto fee | somma incassi lordi ≠ payout | payout↔balance transactions↔fatture |
| 9 | Acconto 30% + saldo 70% (N:1) | ogni movimento < fattura | accumulo `amount_paid`, stato parziale |
| 10 | 14ª mensilità pagata ai singoli dipendenti (N EMOLUMENTI = importo) | nessun bonifico unico | somma gruppo movimenti (`close_paid_fiscal_deadlines`) |
| 11 | Fattura + NC in causale, netto esatto | fattura da sola non pareggia | fattura − NC (`try_match_group_*`, `credit_note_links`) |
| 12 | NC arriva DOPO il pagamento della fattura | fattura già chiusa, poi rettifica | riaprire/aggiustare via link, non forzare |
| 13 | Estenergy→Hera Comm (stessa P.IVA, nome cambiato) | name-match fallisce | agganciare per `supplier_vat` |
| 14 | Fornitore creato a mano senza P.IVA → duplicato all'A-Cube | due anagrafiche, match diviso | P.IVA obbligatoria; merge per P.IVA |
| 15 | Numero fattura corto "FT 11" | `11` matcha ovunque | solo con contesto + somma esatta (093/111) |
| 16 | Numeri fattura ripetuti tra 2 anni (5421/2025 e 5421/2026) | collisione | chiave = numero + anno |
| 17 | Ricorrente Trenitalia importo fisso, N fatture uguali | quale mese? | biettivo per data 1-a-1 |
| 18 | Giroconto MPS→Intesa stesso importo/data | 2 movimenti, 0 fatture | coppia inter-account → `giroconto`, no cashflow |
| 19 | F24 imposte cumulate | nessuna fattura | chiudere senza fattura (imposte) |
| 20 | Stipendi bonifico multiplo EMOLUMENTI | nessuna fattura fornitore | non-fornitore → chiuso |
| 21 | Commissioni/oneri banca | nessuna fattura | `close_non_supplier_movements` |
| 22 | Insoluto RiBa (addebito di ritorno) | movimento positivo che annulla un'uscita | coppia storno → riapri scadenza |
| 23 | Reverse charge / autofattura | fattura senza IVA, movimento verso Erario | TD16-19 → atteso imponibile; no movimento fornitore |
| 24 | Bonifico estero con spese trattenute | importo netto < fattura, valuta diversa | scarto "commissione"+"cambio" |
| 25 | Pagamento in contanti (fattura senza movimento) | nessun candidato movimento | legittimo: fattura chiusa senza banca |
| 26 | Compensazione credito↔debito | nessun movimento | stato `compensata`, non match |
| 27 | Cessione credito/factoring: incassa il factor | controparte = factor, importo = anticipo netto | mappa factor; scarto interessi/commissioni |
| 28 | Bonifico unico paga fatture di 2 fornitori diversi (raro) | subset-sum monoparte fallisce | subset-sum multi-fornitore (bassa priorità) |
| 29 | Sconto cassa/abbuono: pagato 995 su 1.000 | −5 rompe l'esatto | tolleranza "abbuono" configurabile |
| 30 | Fattura fine mese pagata mese dopo | finestra data stretta scarta il partner | finestra a cavallo mese; data solo come score |

*(auto-critica finale: aggiunti oltre i 25 richiesti i casi 26–30 — compensazione, factoring,
subset multi-fornitore, abbuono, competenza/cassa — che il primo elenco non copriva.)*

---

## Assunzioni esplicite

1. Il motore **estende** l'attuale (waterfall + `reconciliation_log`), non lo sostituisce; tutto
   additivo/reversibile, parità sui 3 tenant, nessun DELETE (regole CLAUDE.md).
2. Fonte primaria movimenti = **A-Cube Open Banking** (status `booked`), più import CSV/CAMT storici.
3. Fonte primaria fatture = **XML SDI via A-Cube**; i `payables` sono già generati (scadenzario XML
   o piano fornitore).
4. Segno `amount`: <0 uscita→passive, >0 entrata→attive (da validare per ogni sorgente).
5. Chiave identità fornitore/cliente = **P.IVA**, non il nome.
6. "In sospeso"/distinta = stato **UI**, non DB; le fatture in distinta restano agganciabili.
7. La sandbox cloud NON raggiunge Supabase: in Fase 2 le migration si scrivono come file e si
   applicano a mano sui 3 tenant.

## Domande aperte per Patrizio (da chiarire prima/durante la Fase 2)

1. **Attivo (incassi) è in scope adesso?** Oggi il motore è quasi tutto passivo. La riconciliazione
   delle **fatture di vendita** (con PSP/POS) è l'estensione più grande: la facciamo ora o dopo?
2. **PSP/POS** (Nexi, Stripe, Satispay…): quali usate davvero e disponiamo dei **report di
   settlement** (per il ponte lordo↔netto)? Senza quelli, gli incassi PSP restano proposte.
3. **Tolleranze**: valori di default per abbuono/commissione/bollo? (es. bollo 2€, commissione
   fino a X€, abbuono ‰). Configurabili per tenant?
4. **Ritenuta/split/cassa**: quanto sono frequenti sui vostri fornitori? Vale la pena parsare
   `DatiRitenuta`/`DatiCassaPrevidenziale` dall'XML per lo scarto spiegato?
5. **Finestra temporale**: valori (es. −10/+60 gg dalla scadenza) per lo score data?
6. **Apprendimento**: vuoi che le conferme manuali diventino regole persistenti (alias fornitore,
   mappe IBAN→fornitore)? Con quale visibilità/controllo?
7. **Soglia auto vs proposta**: confermi l'attuale (auto ≥80, proposta 50–80)? Nuova soglia per i
   match con scarto spiegato?

---

⛔ **FINE FASE 1 — mi fermo qui e attendo la tua conferma prima della Fase 2 (progettazione + codice).**
