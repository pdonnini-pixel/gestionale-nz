# Outlet in pre-apertura — note di sessione (14/09/2026)

Caso: **ROMA SORATTE (RSO)**, unità B46 al Roma Outlet Village (Sant'Oreste, RM),
concedente Westi S.r.l. (P.IVA 06227950968), insegna VICOLO. Preliminare firmato
il 10/09/2026, apertura prevista il 5/11/2026. La caparra da 20.000 € è già
uscita (bonifico dell'11/09, scadenza pagata nello Scadenzario), il canone
decorre dall'apertura: **costi già in corso, ricavi zero**.

## Il problema, in una riga

Il gestionale aveva tre «universi» di outlet che non si parlavano: l'anagrafica
(`outlets`), il budget per centro di costo (`cost_centers.role='outlet'`) e la
cassa (`outlet_daily_closings`). Il wizard scriveva solo la riga in `outlets` e
nove pagine analitiche trattavano un outlet senza ricavi come un negozio che va
male: margine 0%, «migliore» incidenza affitto, break-even inventato con un
COGS al 50%, allarme «margine critico», medie di catena abbassate, quota sede
ripartita anche su chi non ha ancora aperto.

## Cosa cambia (codice, tutti e 3 i tenant)

- **`src/lib/outletLifecycle.ts`** (nuovo, con test): stato `programmato` (in
  apertura) / `attivo` / `chiuso` calcolato da `opening_date`/`closing_date`;
  `isOutletOpenInPeriod`, `monthsOpenInYear`, `daysToOpening`, `safePct`
  (mai 0% o Infinity: `null` → «—»/«n/d»). Etichette e classi del badge in un
  posto solo. `useOutlets()` espone `lifecycle`, `opening_date`, `closing_date`.
- **`src/lib/costCenterKey.ts`** (nuovo): `slugCostCenter('ROMA SORATTE') →
  'roma_soratte'`, la chiave che lega `outlets.cost_center_key`,
  `cost_centers.code`, `budget_entries.cost_center`,
  `chart_of_accounts.outlet_link`.
- **Wizard outlet**: crea il **centro di costo gemello** (prima non lo faceva
  mai: l'outlet restava fuori da Budget, Confronto, Margini, Produttività,
  Personale), scrive `cost_center_key`, aggancia il **fornitore concedente**,
  chiede **decorrenza canone**, **scadenza fideiussione** e **caparra** come
  campo proprio (prima `deposit_amount` veniva sovrascritto con l'importo della
  fideiussione).
- **Scheda outlet**: badge «In apertura»; incidenza locazione «—» senza
  ricavi; riquadro «In apertura tra N giorni» (consegna, decorrenza, caparra,
  fideiussione, allestimento, costi mensili dall'apertura); riquadro
  «Contratto» che legge `contracts` + `contract_deadlines` (prima tabella
  orfana, nessuna pagina la leggeva); **alert scadenze riparati**: leggevano
  quattro colonne inesistenti (`contract_end_date`, `exit_clause_date`,
  `guarantee_expiry`, `contract_start_date`) e non comparivano mai.
- **Impostazioni → Centri di costo**: codice in minuscolo (prima forzato in
  MAIUSCOLO, non combaciava con nulla) e campo Ruolo.
- **Pagine analitiche**: Dashboard, Confronto outlet, Margini, Margini per
  categoria, Produttività, Scenario, Cashflow, Store manager, Analytics POS,
  Sell-through, Open-to-buy. Regola comune: l'outlet in apertura si vede con il
  badge, i suoi costi si vedono, i rapporti su ricavi sono `null`, è escluso da
  benchmark, classifiche, medie, allarmi, raccomandazioni e divisori di quota
  sede. Il Cashflow proietta il canone solo da `rent_start_date` (fallback
  `contract_start`, poi `opening_date`). Margini per categoria ora filtra anche
  per `company_id` (prima solo RLS).
- **Schema** (`20260914_219`, NZ → Made → Zago): `outlets.rent_start_date`,
  `outlets.guarantee_expiry`, `outlets.landlord_supplier_id` (FK suppliers).
- **Pixel test**: aggiunte `/outlet/operativi`, `/confronto-outlet`,
  `/margini`, `/margini-categoria`, `/budget`, `/cash-flow`, `/scenario`.

## Cosa cambia (dati, solo NZ: `NZ_ONLY_20260914_220`)

Outlet RSO con tutte le condizioni del contratto; centro di costo
`roma_soratte`; conto ricavi «Corrispettivi Roma Soratte» con codice
**provvisorio 510126** (da allineare al piano dei conti del commercialista);
fornitore Westi agganciato per P.IVA, profilo di pagamento addebito diretto
(`rid`, 3 rate dalla fattura trimestrale anticipata), categoria Locazione
outlet; contratto in `contracts` con rivalutazione ISTAT (min +1%) dal 2029,
variabile 10% con soglia 784.000 €, soglia di recesso 514.500 €; storico
canoni (78.400 → 88.200 dal 2028); 12 scadenze contrattuali; 3 costi
ricorrenti (canone 6.533,33, gestione 1.715, promozione 1.551,67 al mese dal
5/11/2026); template costi; legame outlet↔fornitore e allocazione DIRETTA;
checklist di 9 allegati (nessun file caricato); 5 canali di incasso standard;
caparra agganciata all'outlet; previsione costi iniziali 3.050 € alla stipula;
imposta di registro 784 € fra le scadenze fiscali; accesso all'outlet per chi
già vede tutti gli outlet.

**Ipotesi dichiarate** (da confermare quando arrivano le Condizioni Generali):
cadenza mensile di gestione e promozione (il contratto rinvia alle Condizioni
Generali); data di stipula stimata 28/10/2026; codice conto ricavi provvisorio.

**Deciso il 14/09/2026**: banca di addebito SEPA per Westi = conto MPS
(migration `NZ_ONLY_20260914_221`, applicata su NZ).

**Decisioni che restano a Patrizio**: fornitori dei beni entro i 90.000 €,
polizze (assicuratore, premi), banca della fideiussione, target di fatturato
anno 1/2/regime, `payroll_filiali` se il consulente paghe userà un nome diverso.

## Numeri di controllo del contratto

| Voce | Valore |
|---|---|
| SLP / vendita | 196 / 147 mq |
| Canone garantito anno 1-2 / anno 3 | 78.400 € / 88.200 € (+IVA) |
| Rata mensile anno 1 | 6.533,33 € |
| Gestione + promozione (acconto anno 1) | 20.580 + 18.620 = 39.200 € |
| Fisso annuo verso Westi | 117.600 € (+IVA) |
| Fatturato oltre cui scatta il variabile | 784.000 € (anno 1-2), 882.000 € (anno 3) |
| Soglia di uscita al 30° mese | 514.500 € (2.625 €/mq) |
| Fideiussione | 44.100 € fino al 5/5/2035 |
| Caparra | 20.000 € (versata 11/09/2026) |
| Primo anno pro rata (57 gg) | ≈ 12.243 € |

## Cosa NON esiste ancora (fuori da questa PR)

Motore del canone variabile e dei conguagli (10%, regola del 90%, ISTAT);
registro cespiti (i 90.000 € di beni comprati da Westi); scheda polizze;
comunicazione del fatturato al concedente (settimanale/mensile/annuale);
Scadenzario che legga `contract_deadlines` (oggi si vedono solo nella scheda
outlet); sidebar che non conti gli outlet in apertura per sbloccare Confronto.
