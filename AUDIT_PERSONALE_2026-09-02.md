# Due diligence sezione personale (dipendenti, cedolini, organico)

Data: 2026-09-02. Autore: sessione Claude Code su richiesta di Patrizio.
Perimetro: pagina `/dipendenti` (Personale) e ogni punto del gestionale che mostra,
conta o usa un numero di dipendenti.

Verifica fatta sui **dati vivi** dei 3 tenant via connettore Supabase (NZ
`xfvfxsvqpnpvibgeqpqp`, Made `wdgoebzvosspjqttitra`, Zago `jxlwvzjreukscnswkbjx`),
non su ipotesi. Nessun dato è stato modificato: solo `SELECT`.

---

## 1. La regola che deve valere (e che oggi non vale ovunque)

Patrizio l'ha formulata così: quando si caricano i cedolini di un mese, quel
carico **rende granitico** il dato. Se a luglio in un outlet arrivano 5 cedolini
dove a giugno ne arrivavano 6, allora a luglio quell'outlet ha 5 persone in
forza, e 5 resta il numero da lì in avanti finché un nuovo carico non dice altro.

Tradotta in regola operativa:

> **Regola dell'organico granitico.** L'organico di un outlet in un mese è
> l'insieme delle persone che hanno un cedolino caricato per quell'outlet in
> quel mese. Non l'anagrafica, non le allocazioni, non `employees.outlet_id`.
> Il mese senza carico non vale zero: vale «non ancora caricato», e in quel caso
> si mostra l'ultimo mese granito, dicendo quale.

Tre conseguenze che oggi il codice non rispetta fino in fondo:

1. l'organico è **una serie storica per mese**, non un numero unico. Ogni mese ha
   il suo, e i mesi passati non si riscrivono quando cambia l'anagrafica di oggi;
2. l'**outlet** di una persona è un attributo del mese, non della persona. A
   giugno Palmanova, a luglio Torino: entrambe le cose sono vere, ciascuna nel
   suo mese;
3. chi cessa a maggio **resta contato nei mesi in cui è stato pagato**. La
   cessazione non cancella il passato.

---

## 2. Dove vive il dato personale

### Tabelle

| Tabella | Cosa contiene | Righe NZ | Chi la scrive |
|---|---|---|---|
| `employees` | anagrafica persone | 48 (47 attivi) | pagina Personale, import netti |
| `employee_outlet_allocations` | persona → outlet, con % | 43 | pagina Personale (editor allocazioni), import netti solo per i nuovi |
| `employee_costs` | netto e componenti lordi per persona/mese | 110 (tutte con netto) | corsia import «netti» e «lordi», form manuale |
| `employee_cost_imports` | audit dei carichi mensili | | corsia import |
| `personnel_gross_cost` | costo lordo per **outlet/mese** dal prospetto paghe, con `numero_dipendenti` | 30 | scheda «Costo lordo» |
| `personnel_gross_cost_employee` | costo lordo per **persona/mese** dalla statistica costo orario | 197 | scheda «Costo lordo» |
| `inail_rates` | tassi INAIL per PAT | | scheda «Costo lordo» |
| `employee_documents` | cedolini PDF allegati | | pagina Personale |
| `v_employee_costs_by_outlet` | vista: costi allocati per outlet | | (lettura) |
| `v_personnel_gross_cost` | vista: costo lordo con INAIL calcolato | | (lettura) |

Entrambe le viste hanno `security_invoker=on` sui tre tenant: verificato, la RLS
per azienda regge.

### Pagine e componenti

| Dove | Cosa mostra | Fonte del numero dipendenti |
|---|---|---|
| Personale, Panoramica | organico del mese, costo medio per addetto | cedolini del mese (`employee_costs.netto`) |
| Personale, Per outlet | dipendenti e netto per outlet | cedolini del mese incrociati con le allocazioni di **oggi** |
| Personale, Organico | anagrafica completa | tutte le persone, con badge «pagato/non pagato» |
| Personale, Costi & cedolini | componenti del mese, import | cedolini del mese |
| Personale, Costo lordo | costo lordo per outlet e per persona | `personnel_gross_cost` (+ `numero_dipendenti` del file) |
| Confronto outlet | badge dipendenti, ricavo per dipendente, KPI totale | cedolini dell'ultimo mese del periodo, **con fallback anagrafica** |
| Produttività | fatturato per dipendente, ore, ROI personale | allocazioni anagrafiche pesate per % |
| Outlet, scheda Staff | dipendenti attivi, costo medio | `employees.outlet_id` (query rotta, vedi F5) |
| Cashflow prospettico | stima uscita stipendi | Σ netti dell'ultimo mese caricato |
| Store Manager | personale in turno | dati demo, dichiarati tali |
| Import Hub, fonte «Cedolini / Personale» | import massivo | percorso separato e pericoloso (vedi F1) |
| Dashboard, Conto economico, Scenario | costo personale in euro | bilancio e budget, nessun conteggio teste |

---

## 3. La prova: cinque fonti, cinque numeri diversi

Marzo 2026, tenant NZ. Stesso mese, stessi outlet, cinque modi di contare già
presenti nel prodotto.

| Outlet | Personale (cedolini) | Prospetto paghe | Statistica costo orario | Produttività (allocazioni) | `employees.outlet_id` |
|---|---:|---:|---:|---:|---:|
| BARBERINO | 5 | 5 | 5 | 5 | 4 |
| BRUGNATO | 4 | 4 | 4 | 4 | 5 |
| FRANCIACORTA | 4 | 4 | 4 | 5 | 4 |
| PALMANOVA | **4** | **5** | 4 | **7** | 4 |
| SEDE / MAGAZZINO | **5** | **7** | 5 | 6 | 7 |
| TORINO | 4 | 4 | 4 | 4 | 5 |
| VALDICHIANA | **5** | **6** | **6** | 6 | 5 |
| VALMONTONE | 6 | 6 | 6 | 6 | 6 |
| **Totale** | **37** | **41** | 40 (+2 da assegnare) | 43 | 45 |

Su Palmanova la differenza fra il numero della pagina Personale e quello della
pagina Produttività è di tre persone su quattro. Non è un arrotondamento.

La serie storica dei cedolini mostra che il fenomeno descritto da Patrizio è
già nei dati: Franciacorta passa da 5 a 4 fra gennaio e febbraio, Palmanova da 5
a 4 fra febbraio e marzo, Torino compare da marzo. Le altre pagine non se ne
accorgono.

Ultimo mese disponibile, per fonte: cedolini netti marzo, prospetto paghe
aprile, statistica costo orario maggio. Tre orizzonti diversi nello stesso
momento.

---

## 4. Findings

Ordinati per gravità. Ogni voce ha l'evidenza che l'ha fatta emergere.

### F1 — critico. L'import cedolini di Import Hub cancella dati e non li rimpiazza

`src/lib/parsers/importEngine.ts`, funzione `processPayrollCSV` (righe 705-915).
La fonte «Cedolini / Personale» è attiva in Import Hub (`canProcess` la include,
`ImportHub.tsx:580`). Il percorso fa, in quest'ordine:

1. `DELETE FROM employee_costs WHERE employee_id = … AND year = … AND month = …`
   per ogni dipendente trovato nel file. Cancellazione secca, senza backup e
   senza conferma: viola la regola granitica «no data loss»;
2. reinserisce righe con le colonne `outlet_id` e `allocation_pct`, che in
   `employee_costs` **non esistono** (le colonne reali sono `retribuzione`,
   `contributi`, `inail`, `tfr`, `altri_costi`, `netto`, `source`, `import_id`,
   `note`). L'insert fallisce;
3. per una persona su più outlet genera più righe con lo stesso
   `employee_id, year, month`, che l'indice unico `employee_costs_employee_id_year_month_key`
   (migration 061) rifiuta comunque;
4. legge `employee_outlet_allocations.outlet_id`, colonna che non esiste (è
   `outlet_code`);
5. il netto viene letto dal file (`netto_in_busta`) ma non finisce mai nel
   record scritto.

Risultato pratico: chi usa quella fonte perde i netti del mese e non ottiene
nulla in cambio. Su NZ non è mai stata usata (tutte le 110 righe di
`employee_costs` hanno `source = 'import_busta_paga'`, cioè la corsia della
pagina Personale), quindi il danno non si è ancora verificato. È una mina
armata, raggiungibile in tre clic da chiunque abbia il ruolo giusto.

### F2 — alto. Nessuna fonte è dichiarata sovrana

Le cinque fonti della tabella al punto 3 convivono senza gerarchia. Il codice non
dice da nessuna parte «l'organico è questo», e ogni pagina ha scelto per conto
suo. Finché la regola granitica non è scritta in un punto solo (un helper
condiviso, come `ceHelpers` per il conto economico), ogni fix su una pagina
riapre la divergenza su un'altra.

### F3 — alto. L'outlet della persona non è storicizzato

`employee_outlet_allocations` ha `valid_from` e `valid_to`, ma su NZ ci sono 43
allocazioni con `valid_to` sempre `NULL`, tutte al 100%, tutte primarie. In
pratica esiste una sola fotografia: quella di oggi.

Conseguenza: la pagina Personale calcola il numero per outlet incrociando il
cedolino del mese con l'allocazione corrente. Se una persona a luglio passa da
Palmanova a Torino e qualcuno aggiorna l'allocazione, **anche giugno, maggio e
gennaio** la mostrano a Torino. Il passato si riscrive da solo. È il punto che
più direttamente contraddice la richiesta di Patrizio: il dato granito di
giugno deve restare quello di giugno.

Da notare: il file dei netti **contiene già la filiale per riga** e il parser la
legge (`PreviewRow.outlet`), ma la usa solo per creare l'allocazione dei
dipendenti nuovi. Per tutti gli altri viene buttata.

### F4 — alto. Produttività calcola il costo del personale sui conti dei servizi

`src/pages/Produttivita.tsx:186-190`: il costo del personale è la somma degli
`account_code` che iniziano per `63`. Nel piano dei conti reale di NZ il gruppo
`63` è **«Per servizi»**; il personale è `67` («Per il personale»). Budget 2026:

- conti `63xx`: 816.317 euro (servizi)
- conti `67xx`: 1.793.455 euro (personale)

Quindi incidenza del personale sui ricavi, ROI del personale, costo per ora,
margine per ora e le raccomandazioni finali della pagina girano su un numero che
è meno della metà di quello giusto, e riferito ad altro. La pagina somma anche i
ricavi per prefisso `5`, contro la regola di usare `chart_of_accounts.is_revenue`
(qui l'errore è piccolo: 433 euro di conti `59`), e conta i dipendenti dalle
allocazioni anagrafiche invece che dai cedolini.

Sempre in quella pagina, le ore lavorate sono `dipendenti × 40 × 52`: ignora
`part_time_pct` e `ore_settimanali`, che nell'anagrafica esistono.

### F5 — alto. La scheda Staff dell'outlet interroga colonne che non esistono

`src/pages/Outlet.tsx:1523`: la query chiede `annual_gross_salary` e
`monthly_net_salary`. In `employees` le colonne sono `gross_annual_cost` e
`net_monthly_salary`. La select fallisce, l'errore non viene gestito (`const { data } = …`
senza controllo) e la scheda mostra sempre «Nessun dipendente assegnato», su
tutti gli outlet e tutti i tenant.

Anche a query riparata resterebbe un problema di merito: userebbe
`employees.outlet_id`, che su NZ è popolato per 40 persone su 48 e diverge dalle
allocazioni su cinque outlet su otto (tabella al punto 3).

### F6 — medio-alto. Chi cessa sparisce dai mesi in cui è stato pagato

Nella pagina Personale il totale dell'organico (`organicoAttivo`) conta chi ha un
cedolino nel mese, senza guardare `is_active`. Il dettaglio per outlet parte
invece da `activeEmployees`. I due numeri non coincidono.

Evidenza su NZ: una persona cessata il 24 maggio 2026 ha tre cedolini regolari
(gennaio, febbraio, marzo) e un'allocazione su Valdichiana. Oggi Valdichiana a
marzo mostra 5 persone; le fonti paghe per lo stesso mese ne dicono 6. La sesta è
lei, cancellata retroattivamente da un evento di maggio. Stessa cosa nel KPI di
gennaio: totale 35, somma per outlet 34.

### F7 — medio. Il carico di un mese non è una sostituzione

L'import netti fa `upsert` riga per riga (`onConflict: employee_id,year,month`).
Le righe del mese **non presenti** nel nuovo file restano dov'erano. Se il file di
luglio viene caricato sbagliato (sei persone) e poi ricaricato corretto (cinque),
il sesto netto resta a database e luglio continua a valere sei. È esattamente il
caso che la regola granitica deve impedire.

Serve una riconciliazione esplicita del mese: alla conferma, mostrare le righe
presenti a database e assenti dal file, e chiedere cosa farne (marcarle, non
cancellarle in automatico).

### F8 — medio. L'import non aggiorna organico e allocazioni

Il file dei netti è la fonte più aggiornata che l'azienda abbia, e non tocca
l'anagrafica:

- chi non compare più nel file resta `is_active = true` e resta allocato al suo
  outlet, per sempre;
- chi cambia filiale nel file mantiene l'allocazione vecchia (l'allocazione si
  crea solo per i dipendenti nuovi);
- cinque persone assunte fra maggio e giugno 2026 hanno `outlet_id` ma **zero
  allocazioni** e zero cedolini: invisibili in Personale «Per outlet», in
  Confronto outlet e in Produttività. Nella statistica costo orario di maggio
  compaiono infatti sotto «Da assegnare» (7 righe, 5 senza corrispondenza in
  anagrafica).

### F9 — medio. Il mese di default è il mese di calendario

`selectedMonth` parte da `new Date().getMonth() + 1`. Oggi, 2 settembre 2026, la
pagina si apre su settembre: nessun cedolino, organico zero, tabelle vuote, e il
KPI «costo medio per addetto» non calcolabile. Il default corretto è l'ultimo
mese con dati caricati, con l'etichetta che lo dichiara.

### F10 — medio. Il «Nr dipendenti» del file paghe si legge e si butta

`src/lib/payrollParse.ts` (righe 172 e 208) estrae per ogni filiale il totale di
ripartizione e il numero dipendenti dichiarato dal software paghe, e li usa solo
per alzare un warning se la somma non quadra. È la conferma del fornitore paghe
sul numero di teste per outlet e mese, cioè proprio il dato che serve, e non
viene salvato da nessuna parte.

Il prospetto riepilogativo lo salva (`personnel_gross_cost.numero_dipendenti`),
ma è un altro file e un altro carico, con un mese di sfasamento rispetto ai
netti.

### F11 — medio. Confronto outlet ripiega sull'anagrafica senza dirlo

`ConfrontoOutlet.tsx:937`: se il mese più recente del periodo non ha cedolini, il
conteggio ripiega sull'anagrafica attiva allocata. La logica di partenza è
corretta (prende l'ultimo mese con cedolini, deduplica per codice fiscale,
esclude gli amministratori), ma il fallback silenzioso rimette in gioco il numero
anagrafico proprio nei casi in cui il dato granito manca, e l'interfaccia dice
«dipendenti assegnati» senza distinguere. Il KPI totale in cima somma outlet con
fonti diverse.

Da notare anche che Confronto outlet esclude la sede (centro di costo `hq`),
mentre Personale la include: due totali diversi, entrambi legittimi, oggi non
spiegati.

### F12 — basso-medio. Su Zago l'organico è a zero pur avendo 12 dipendenti

Made: nessun dipendente, nessun dato. Zago: 12 dipendenti attivi in anagrafica,
tutti con matricola, **zero allocazioni e zero cedolini**. Con la regola granitica
applicata alla lettera, la pagina Personale di Zago mostra organico 0 in ogni
mese e la scheda «Per outlet» vuota, pur avendo un'anagrafica popolata.

Serve distinguere «zero persone» da «nessun cedolino caricato»: stesso principio
del segnaposto usato in Budget e Controllo.

### F15 — alto. In Produttività le chiavi degli outlet non combaciano

Emerso mentre correggevo F4. Il conteggio dipendenti veniva indicizzato per nome
outlet delle allocazioni (`VALDICHIANA`, `SEDE / MAGAZZINO`) ma cercato con il
centro di costo del budget (`valdichiana`, `sede_magazzino`). Nessuna chiave
combaciava, quindi il dato dipendenti era `null` per ogni outlet e la pagina
mostrava «N/D» su fatturato per dipendente, ricavo per ora, costo per ora e
margine per ora: tutte le metriche che danno il nome alla pagina. Risolto con un
ponte costruito dall'anagrafica outlet (`cost_center_key`, `code`, `name`).

### F13 — basso. Le guide raccontano il modello vecchio

`src/data/pageGuides.ts` è allineato al codice di oggi, quindi documenta anche le
parti da cambiare: per Produttività dice che il conteggio arriva dalle
allocazioni, per Confronto outlet parla di «dipendenti assegnati», per la scheda
Staff dell'outlet descrive una tabella che in realtà non si popola mai. Vanno
riscritte insieme al codice, come da regola guide sempre allineate.

### F14 — debito. Anagrafica a doppio binario e copertura di test

`employees` ha coppie di colonne che dicono la stessa cosa: `nome`/`first_name`,
`cognome`/`last_name`, `codice_fiscale`/`fiscal_code`, `data_assunzione`/`hire_date`,
`livello`/`level`, `note`/`notes`, `ore_settimanali`/`weekly_hours`,
`contratto_tipo`/`contract_type`, più `outlet_id` che duplica le allocazioni. La
pagina Personale scrive entrambe le colonne di ogni coppia (`mapFormToDb`), gli
import ne scrivono solo alcune, le altre pagine leggono ora l'una ora l'altra. Su
NZ otto dipendenti su 48 non hanno codice fiscale, quindi la deduplica per
persona di Confronto outlet ripiega sul nome per un sesto delle persone.

Il test pixel (`tests/e2e/pixel-check.spec.ts`) copre sei rotte e **non** include
`/dipendenti`.

---

## 5. Cosa proporrei di fare, in ordine

Nessuna di queste modifiche è stata applicata: questo documento è solo l'analisi.
Le fasi 2 e seguenti toccano dati vivi sui tre tenant e vanno autorizzate.

**Fase 0, subito, senza rischi.** Disattivare la fonte «Cedolini / Personale» in
Import Hub (F1) rimandando alla pagina Personale, così la cancellazione non è più
raggiungibile. Correggere i conti di Produttività da `63` a `macro_group = 'personale'`
letto dal piano dei conti (F4) e la query della scheda Staff (F5). Portare il mese
di default all'ultimo mese caricato (F9). Sono fix di codice, verificabili con la
CI pixel una volta aggiunta `/dipendenti` alle rotte coperte.

**Fase 1, la regola in un punto solo.** Un helper condiviso, sulla falsariga di
`ceHelpers`, che esponga: organico di un outlet in un mese, organico aziendale del
mese, ultimo mese granito, stato del dato (granito, ereditato dall'ultimo carico,
mai caricato). Tutte le pagine passano da lì. Nessuna migration.

**Fase 2, storicizzare l'outlet del mese.** Il file dei netti porta già la
filiale per riga: salvarla sul carico, in una colonna `outlet_code` di
`employee_costs` oppure valorizzando `valid_from`/`valid_to` sulle allocazioni.
Migration additiva, backfill dai file già caricati dove possibile. Da qui in poi
il numero di giugno resta quello di giugno anche se la persona cambia negozio a
luglio.

**Fase 3, il carico come sostituzione consapevole.** Alla conferma dell'import,
diff esplicito fra il mese a database e il mese nel file: chi c'era e non c'è
più, chi è nuovo, chi ha cambiato outlet. Con proposta di aggiornare anagrafica e
allocazioni, e conferma binaria. Mai cancellazioni in automatico.

**Fase 4, allineare le pagine e le guide.** Confronto outlet, Produttività,
scheda Outlet e le rispettive voci di `pageGuides.ts` nello stesso commit.

Due decisioni, entrambe prese da Patrizio il 2026-09-02:

1. **mese senza cedolini**: si mostra l'ultimo mese granito, dichiarandolo con
   l'etichetta «al mese X». Non si mostra vuoto e non si mostra zero. Applicata
   in fase 0;
2. **sede o magazzino in Confronto outlet**: resta **fuori** dall'organico
   aziendale, come oggi. Quella pagina confronta i punti vendita, quindi il suo
   totale è la somma dei soli outlet; il totale che comprende la sede è quello
   della pagina Dipendenti. Da fase 4 la differenza va dichiarata in pagina,
   così i due numeri non sembrano in contraddizione.

Terza decisione presa lo stesso giorno, fuori dalle fasi: la pagina si chiama
**Dipendenti** ovunque (prima il menu diceva «Dipendenti» e il titolo
«Personale»), e il ruolo `contabile` vede la voce nel menu, allineandolo ai
permessi che la RLS gli dà già su `employee_costs`.

---

## 6. Fase 0: cosa è stato applicato

Applicata in questo stesso branch dopo la conferma di Patrizio sulla domanda 1
(mese senza cedolini: si mostra l'ultimo mese granito, dichiarandolo). Solo
codice: nessuna migration, nessuna scrittura sul database, nessun deploy di Edge
Function.

**Nuovo modulo `src/lib/headcount.ts`** (con 12 test in `headcount.test.ts`): la
regola dell'organico granitico in un punto solo. Espone il mese granito
(`lastGranitedPeriod`, `resolvePeriod`), l'organico aziendale
(`companyHeadcount`) e quello per outlet (`headcountByOutlet`,
`headcountCountByOutlet`). Conta solo chi ha il cedolino, esclude gli
amministratori, include i cessati nei mesi in cui sono stati pagati, deduplica
le persone per codice fiscale.

| Finding | Stato | Intervento |
|---|---|---|
| F1 import distruttivo | risolto | fonte «Cedolini / Personale» non più elaborabile in Import Hub (il file resta archiviato) e `DELETE` rimosso da `processPayrollCSV`, con avviso in pagina che rimanda a Personale |
| F4 conti sbagliati | risolto | Produttività classifica ricavi e costi da `chart_of_accounts` (`is_revenue`, `macro_group = 'personale'`), mai per prefisso |
| F15 chiavi non combacianti | risolto | ponte cost_center → nome outlet dall'anagrafica |
| F5 scheda Staff | risolto | colonne corrette (`gross_annual_cost`, `net_monthly_salary`, `role_description`), elenco dalle allocazioni, conteggio dai cedolini con etichetta del mese |
| F6 cessati e totali | risolto | organico e dettaglio per outlet passano dallo stesso helper: i due numeri ora coincidono e i cessati restano nei mesi pagati |
| F9 mese di default | risolto | la pagina si apre sull'ultimo mese con cedolini; su un mese vuoto compare l'avviso con il salto all'ultimo mese granito |
| F2 fonte sovrana | in parte | l'helper esiste ed è usato da Personale, Produttività e scheda Outlet. Confronto outlet resta da allineare (dipende dalla domanda 2) |
| F13 guide | risolto per le pagine toccate | aggiornate le voci Personale, Produttività, Outlet e Import Hub in `pageGuides.ts` |
| F14 copertura test | in parte | `/dipendenti` e `/produttivita` aggiunte al pixel check |
| F3, F7, F8, F10, F11, F12 | aperti | sono le fasi 2, 3 e 4: storicizzazione dell'outlet, carico come sostituzione, allineamento di Confronto outlet |

Effetto numerico del fix F4 sul budget 2026 di NZ, costo del personale per
centro di costo:

| Outlet | Ricavi | Personale (corretto, conti 67) | Vecchio calcolo (conti 63) | Incidenza prima → dopo |
|---|---:|---:|---:|---|
| VALDICHIANA | 826.632 | 194.212 | 71.080 | 8,6% → 23,5% |
| BARBERINO | 354.565 | 173.133 | 67.944 | 19,2% → 48,8% |
| VALMONTONE | 219.074 | 164.634 | 54.708 | 25,0% → 75,1% |

La pagina dava verde (sotto il 20%) a punti vendita con incidenza reale del 49% e
del 75%. Le raccomandazioni automatiche in fondo alla pagina cambiano di
conseguenza.

Verifiche: `npm run build` verde, `npx tsc --noEmit` senza nuovi errori (restano
i due preesistenti di `TesoreriaManuale.tsx`, già su `main`), 108 unit test
verdi più i 12 nuovi di `headcount.test.ts`, `check-view-security-invoker` verde.
La verifica pixel gira in CI sui tre tenant e ora copre anche le due pagine
toccate.

## 7. Verifiche eseguite (analisi)

- `SELECT` su NZ, Made e Zago per anagrafica, allocazioni, cedolini, costo lordo
  per outlet e per persona, piano dei conti, budget 2026.
- Confronto per outlet e per mese fra le cinque fonti di conteggio (tabella al
  punto 3), su dati vivi di gennaio, febbraio e marzo 2026.
- Controllo `reloptions` delle viste `v_employee_costs_by_outlet` e
  `v_personnel_gross_cost`: `security_invoker=on` presente.
- Lettura integrale di `src/pages/Dipendenti.tsx`, `src/lib/payrollParse.ts`,
  `src/lib/parsers/importEngine.ts` (parte payroll), e delle sezioni personale di
  `ConfrontoOutlet.tsx`, `Produttivita.tsx`, `Outlet.tsx`, `CashflowProspettico.tsx`,
  `StoreManager.tsx`, `pageGuides.ts`, `tests/e2e/pixel-check.spec.ts`.
- Nessuna scrittura sul database, nessuna migration, nessun deploy.
