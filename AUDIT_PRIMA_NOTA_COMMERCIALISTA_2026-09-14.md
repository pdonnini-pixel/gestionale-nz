# audit prima nota per il commercialista (agosto 2026)

Domanda di Sabrina: dal sistema di prima nota si può tirare fuori tutto quello che serve al commercialista per la contabilità del mese? Vuole consegnare agosto 2026.

Audit fatto il 14/09/2026 sul DB vivo di New Zago (tenant NZ), mese di agosto 2026, più lettura del codice di `src/pages/PrimaNota.tsx`. Made e Zago in agosto non hanno movimenti né fatture (0 righe su Made, 1 fattura su Zago), quindi i numeri sono solo NZ; ogni sviluppo resta comunque per i tre tenant.

---

## risposta breve

In parte, e oggi non abbastanza. La pagina Prima Nota esporta l'estratto conto di tutti i conti (757 movimenti in agosto), ma quasi senza contropartite: il fornitore compare su 56 righe su 757, e su 7 di quelle è sbagliato perché un movimento che salda più fatture (RiBa, distinte CBI) viene esportato con una fattura sola. Le altre informazioni che un commercialista chiede per il mese (dettaglio dei pagamenti per fattura, incassi per punto vendita, F24 con codice tributo, contanti e carte) sono nel database, ma nessuna pagina le mette insieme.

Due cose invece mancano proprio nei dati di agosto e non si possono ricostruire: le chiusure di cassa giornaliere (partono dal 1° settembre) e i lordi delle buste paga (importati solo i netti). Per entrambe il commercialista ha già la fonte diretta (corrispettivi telematici dall'Agenzia delle Entrate, prospetto paghe dal consulente del lavoro).

La proposta è un «pacchetto mensile» in un solo Excel a più fogli, generato dalla pagina Prima Nota. La parte più urgente è un bug: l'export perde le fatture raggruppate. Dettagli e stime in fondo.

---

## cosa fa oggi la pagina prima nota

Codice: `src/pages/PrimaNota.tsx`, scheda «Prima Nota» dentro Banche (`TesoreriaManuale.tsx`). Sorgente unica: `bank_transactions` (Open Banking A-Cube). Filtri anno, mese, conto. Export CSV e Excel con un foglio di riepilogo (conteggio, entrate, uscite, saldo).

Colonne esportate: Data, Conto banca, IBAN (mascherato, ultime 6 cifre), Tipo (entrata/uscita), Importo, Valuta, Contropartita, P.IVA contropartita, Causale, Categoria.

### come vengono riempite le colonne, misurato su agosto

| colonna | da dove la prende il codice | agosto 2026 |
|---|---|---|
| Contropartita | `suppliers` via `supplier_id`, poi `payables.supplier_name`, poi `counterpart`, poi `merchant_name` | `supplier_id` valorizzato su 0 righe su 757; `counterpart`, `merchant_name` e `counterpart_name` vuoti su tutte le 757. Resta solo il fornitore della fattura agganciata: 56 righe |
| P.IVA | `suppliers.partita_iva` oppure `payables.supplier_vat` | 56 righe |
| Causale | `Fatt. <numero>` se c'è una fattura, altrimenti `reference`, altrimenti `description` | `reference` vuoto su tutte; quindi numero fattura su 56 righe, causale bancaria grezza sulle altre 701 |
| Categoria | `bank_transactions.category` (etichetta della banca/AI: `incassi_pos`, `versamenti`, `stipendi`, `tasse`, `carte`, `spese_banca`...) | 670 righe con etichetta, 87 senza. Non è il piano dei conti |

### difetti trovati nel codice

1. **Un movimento, una fattura sola.** L'export carica le fatture agganciate con `payMap.set(bank_transaction_id, ...)`: se un movimento salda più fatture, l'ultima sovrascrive le altre. In agosto 7 movimenti coprono 141 fatture. I tre effetti RiBa del 31/08 (53.311,75, 49.190,23 e 6.896,19 euro) chiudono rispettivamente 31, 31 e 16 fatture: nell'export escono con una fattura e un fornitore a caso. Per il commercialista è un'informazione sbagliata, non solo incompleta.
2. **Nessun tipo di movimento.** Stipendi, F24, POS, versamenti contanti, commissioni, giroconti e pagamenti fornitori escono tutti come «Entrata» o «Uscita» con la causale della banca. L'informazione esiste (`category`, aggancio a `payables`, aggancio a `fiscal_deadlines`) ma non viene usata per dire «che cosa è» il movimento.
3. **Fuori dalla banca non esiste niente.** Le fatture pagate in contanti (6 in agosto, 353,64 euro) o con carta (6, 947,80 euro) non passano dal conto e non compaiono. Il commercialista le deve registrare lo stesso.
4. **F24 senza dettaglio.** L'addebito del 20/08 di 39.063,80 euro esce come «IMPOSTE,TASSE SU DELEGHE»; in `fiscal_deadlines` c'è già scritto che è l'IVA di luglio, codice 6007. L'export non lo dice.
5. **IBAN mascherato.** Per il commercialista serve sapere su quale conto è passato il movimento; le ultime 6 cifre bastano a distinguere i conti, ma il nome banca più IBAN completo eviterebbe domande.

---

## fotografia di agosto 2026 (tenant NZ)

### movimenti bancari

| | righe | importo |
|---|---|---|
| Movimenti totali (4 conti attivi su 7 censiti) | 757 | |
| Entrate | 626 | 437.188,44 |
| Uscite | 131 | 470.270,11 |

Entrate, per natura:

| tipo | righe | importo | attribuibile al punto vendita? |
|---|---|---|---|
| Accrediti POS (MPS, BCC, Amex/Numia, PagoBancomat) | 585 | 360.477,34 | sì: il codice terminale in causale (`6181087-000NN`) corrisponde a `outlet_payment_channels.terminal_code`; 468 righe con `COD.SIA`, 55 Amex Numia, 62 PagoBancomat/Amex BCC, tutte con il codice |
| Versamenti contanti | 35 | 76.015,50 | sì: le parole chiave dei canali «Contanti» (ATM 9750, FOIANO, PALMANOVA, BRUGNATO, cassa contin...) mappano 35 su 35 |
| Altri bonifici in entrata | 6 | 695,60 | rimborsi vari, da leggere a mano |

Versamenti contanti per outlet (ricavati dalla causale, senza chiusure di cassa): BRB 10.775,00 (5), BRG 11.500,00 (6), FRC 9.665,00 (4), PLM 10.335,00 (5), TRN 6.710,00 (5), VDC 16.540,50 (5), VLM 10.490,00 (5).

Uscite, per quanto il sistema le spiega:

| copertura | righe | importo | contenuto |
|---|---|---|---|
| Fattura agganciata (`payables.bank_transaction_id`) | 56 | 268.034,70 | 141 fatture: bonifici singoli, distinte CBI, RiBa, SDD utenze |
| F24 agganciato (`fiscal_deadlines.bank_transaction_id`) | 2 | 48.228,80 | IVA luglio 39.063,80 (6007), IRES/IRAP rata 2/5 9.165,00 |
| Solo etichetta banca, nessun aggancio | 48 | 111.406,68 | 9 disposizioni emolumenti 70.311,20; delega I24 del 20/08 37.454,77 (INPS, non censita in Scadenze fiscali); due deleghe del 07/08 (720,00 e 1.491,00); estratto carta CCP 2.415,80 e ricariche prepagata 500,00; spese e commissioni bancarie |
| Niente, né etichetta né aggancio | 25 | 42.599,93 | vedi sotto |

Le 25 righe orfane: 39.445,90 sono il bonifico Wolf Group del 07/08, che in realtà è registrato come acconto sulla fattura 218 (`reconciliation_log`, importo applicato 0 «solo aggancio»), ma la fattura non porta il `bank_transaction_id`, quindi la prima nota non lo vede. Poi la rata di finanziamento del 31/08 (1.177,41; la tabella `loans` è vuota, nessun finanziamento censito), le commissioni su fideiussione (905,19), gli SDD Nexi e Global Blue (circa 850), canoni e commissioni spicciole. Il motore di riconciliazione dal 10/09 sa già riconoscere questi movimenti dalla causale come «addebiti della banca per conto proprio»: quella stessa lettura può etichettarli in prima nota, senza chiederlo a Sabrina.

### fatture passive del mese (`electronic_invoices`, data fattura agosto)

| tipo | n. | imponibile | IVA | totale |
|---|---|---|---|---|
| TD01 fatture | 91 | 141.768,12 | 29.165,30 | 170.933,41 |
| TD04 note di credito | 10 | 2.609,35 | 574,06 | 3.183,41 |
| TD24 fatture differite | 8 | 9.654,32 | 2.121,29 | 11.775,61 |
| TD16/17/18 integrazioni reverse charge | 15 | 8.380,85 | 1.843,80 | 10.224,65 |
| totale | 124 | 162.412,64 | 33.704,45 | 196.117,08 |

Tutte e 124 hanno l'XML in archivio. 109 hanno una scadenza nello Scadenzario; le 15 senza sono tutte integrazioni reverse charge (TD16/17/18), ed è corretto che non generino un pagamento. Tutti i 69 fornitori del mese sono in anagrafica.

Categoria di costo: sulle 142 righe di scadenzario del mese, 96 hanno la categoria, 7 la possono ereditare dal fornitore, 39 non ce l'hanno (99.757,71 euro). La categoria porta al conto del CE (`cost_categories.ce_account_code`, compilato su 28 categorie su 32): è la voce che il commercialista può usare per la registrazione, se gli interessa il nostro piano dei conti.

Outlet sulla fattura: 0 su 124. Le regole di allocazione (24) coprono 6 dei 69 fornitori del mese. Per la contabilità generale non serve; serve per l'analitica per punto vendita.

### fatture attive

4 fatture emesse via SDI in agosto, 418,56 euro in totale, tutte con stato `SENT` e XML.

### corrispettivi

Nessuna chiusura di cassa giornaliera in agosto: `outlet_daily_closings` ha 98 righe, tutte di settembre. `daily_revenue`, `daily_receipts_ade` e `corrispettivi_log` sono vuote. L'unico ricavo di agosto nel sistema è il consuntivo mensile per outlet in `budget_confronto` (netto 364.015,83 su 7 outlet: VDC 77.127,37, FRC 52.587,61, VLM 49.607,12, BRG 49.295,95, PLM 46.479,76, BRB 45.727,55, TRN 43.190,47). Non è un registro corrispettivi. I corrispettivi giornalieri il commercialista li prende dai registratori telematici tramite l'Agenzia delle Entrate.

### personale

42 buste paga di agosto importate, ma solo il netto (66.655,39): retribuzione lorda, contributi, INAIL e TFR sono a zero (import «elenco netti»). In banca ci sono 9 disposizioni per emolumenti del 10/08 per 70.311,20. La differenza di 3.655,81 non è spiegata dai dati (anticipi, collaboratori, TFR?). Il prospetto contabile delle paghe lo manda il consulente del lavoro; il gestionale non lo sostituisce.

### scadenze fiscali

Tre righe con scadenza o pagamento in agosto: TARI II rata 2.911,00 (pagata il 07/08, non agganciata al movimento), IRES/IRAP rata 2/5 9.165,00 e IVA luglio 39.063,80 (entrambe agganciate). In banca però ci sono 6 addebiti di deleghe: mancano all'appello la delega I24 INPS da 37.454,77 del 20/08 e le due deleghe del 07/08 da 720,00 e 1.491,00 (una terza, 700,00, è nello Scadenzario come rata f24 di una fattura).

### IVA

La vista `v_iva_componenti_mensili` per agosto dà IVA acquisti 31.286,59, note di credito 574,06, integrazioni 1.857,00, IVA vendite da fatture 93,51. L'IVA sui corrispettivi non è calcolabile dalle chiusure (zero in agosto); la pagina Liquidazione IVA usa il consuntivo. La liquidazione la fa il commercialista: qui è un controllo, non un deliverable.

---

## cosa chiede un commercialista per il mese, e dove sta nel gestionale

| documento | serve per | lo abbiamo? | dove | stato per agosto |
|---|---|---|---|---|
| Estratti conto di tutti i conti | prima nota banca | sì | Prima Nota | 757 righe, 4 conti, esportabili oggi |
| Contropartita di ogni movimento (quale fattura, quale F24, stipendi, POS, giroconto) | registrare i pagamenti e chiudere le partite fornitori | in parte | `payables`, `fiscal_deadlines`, `category` | 58 righe spiegate da un aggancio, 48 da un'etichetta, 25 da niente; le RiBa raggruppate escono sbagliate |
| Dettaglio dei pagamenti per fattura | chiusura partite | sì nei dati, no in export | `payables` (141 righe con numero, P.IVA, imponibile, IVA su 141) | nessuna pagina lo esporta per mese |
| Fatture passive XML | registro acquisti | sì, ma il commercialista le riceve già dallo SDI | `electronic_invoices` | 124/124 con XML, download singolo dalla pagina Fatturazione, nessuno ZIP mensile |
| Fatture attive | registro vendite | sì | `active_invoices` | 4 |
| Corrispettivi giornalieri per punto vendita | registro corrispettivi | no per agosto | `outlet_daily_closings` dal 01/09 | il commercialista li ha dall'AdE; ricostruibile solo il mensile per outlet |
| Prima nota cassa (incassi contanti, versamenti, spese di cassa) | cassa | in parte | versamenti 35/35 attribuibili all'outlet; 6 fatture pagate in contanti | nessuna chiusura di cassa in agosto |
| Prospetto paghe (lordi, contributi, TFR) | costo del personale | no, solo netti | `employee_cost_slips` | lo manda il consulente del lavoro |
| F24 pagati con codice tributo e periodo | imposte | in parte | `fiscal_deadlines` | 2 addebiti su 6 spiegati |
| Estratto carta di credito con giustificativi | spese carta | no | | addebito carta CCP 2.415,80 contro 947,80 di fatture pagate con carta |
| Piano dei finanziamenti (quota capitale e interessi) | interessi passivi | no | `loans` vuota | rata 1.177,41 orfana |
| Note di credito e compensazioni | partite | sì | `payable_credit_note_links` | 4 note di credito chiuse in agosto |
| Ritenute d'acconto su parcelle | certificazioni | quasi mai valorizzate | `payables.withholding_amount` | 1 riga in agosto |

---

## proposta: il pacchetto mensile per il commercialista

Un solo file Excel per mese e per tenant, scaricato dalla pagina Prima Nota, con questi fogli. Tutto lato frontend (nessuna migration), quindi la parità sui tre tenant è automatica via Netlify.

1. **Banca.** Il foglio di oggi, corretto: contropartita e P.IVA reali; colonna «Tipo movimento» (fornitore, F24, stipendi, POS, versamento contanti, carta, spese bancarie, finanziamento, giroconto, da chiarire) ricavata da aggancio, etichetta e causale; colonna «N. fatture» e, se più di una, il rimando al foglio Pagamenti; IBAN in chiaro; per gli F24 il codice tributo e il periodo.
2. **Pagamenti fornitori.** Una riga per fattura pagata nel mese (141 in agosto): data pagamento, conto, fornitore, P.IVA, numero e data fattura, imponibile, IVA, lordo, importo applicato, metodo, categoria e conto CE, outlet se c'è. Comprende i pagamenti in contanti e con carta, che non passano dalla banca. Una RiBa da 31 effetti diventa 31 righe leggibili.
3. **Incassi per outlet.** POS e versamenti contanti per punto vendita e per giorno, letti dal codice terminale e dalle parole chiave dei canali (in agosto la copertura è totale), più le commissioni di incasso. Da settembre, con le chiusure di cassa, il foglio si arricchisce di contanti incassati, spese di cassa e differenze (la pagina Incassi giornalieri ha già l'export nel formato del vecchio Excel).
4. **Fatture ricevute.** Registro del mese con tipo documento, fornitore, P.IVA, imponibile, IVA, totale, categoria e conto CE, stato del pagamento, con la stessa regola di competenza della pagina Liquidazione IVA (giorno limite del mese successivo). Uno ZIP degli XML è facoltativo: il commercialista li ha già.
5. **F24 e stipendi.** Le deleghe del mese con codice tributo e periodo (da Scadenze fiscali) affiancate agli addebiti in banca; le disposizioni per emolumenti affiancate ai netti delle buste paga, con la differenza in evidenza.
6. **Da chiarire.** Solo i movimenti che nessuna fonte spiega. Vale la regola della casa: prima si ricava, poi si chiede. In agosto, applicando le letture della causale che il motore di riconciliazione già conosce (rata finanziamento, fideiussione, Nexi, Global Blue, canoni) e l'acconto Wolf già registrato nel log, le 25 righe orfane si riducono a zero.

### ordine dei lavori

| passo | contenuto | dimensione |
|---|---|---|
| A | Bug dell'export: tutte le fatture per movimento, contropartita corretta, tipo movimento, F24 con codice tributo | piccolo, una PR su `PrimaNota.tsx` più guida |
| B | Foglio Pagamenti fornitori con contanti e carta | medio, riusa `payables` e `payable_credit_note_links` |
| C | Foglio Incassi per outlet dal codice terminale | medio, riusa `outlet_payment_channels` come già fa la verifica banca delle chiusure |
| D | Foglio Fatture ricevute con conto CE | piccolo, riusa `v_electronic_invoices_list` e la regola di competenza di `ivaLiquidazione.ts` |
| E | Fogli F24/stipendi e Da chiarire | piccolo |
| F | Categorie mancanti sulle fatture (39 righe, 99.757,71 in agosto): 7 ereditabili subito dal fornitore; per le altre serve un default di categoria sul fornitore, proposto dallo storico | dati, non codice: una sessione con Sabrina sui fornitori senza categoria |

Tempo indicativo per A+B+C+D+E: due o tre sessioni di lavoro, con un solo `npm run build` e l'aggiornamento della guida in `src/data/pageGuides.ts`.

### cosa può consegnare Sabrina oggi, senza aspettare

- L'export Prima Nota attuale, con l'avvertenza che i 7 movimenti raggruppati (RiBa del 31/08, distinte CBI del 07/08) riportano una fattura sola: il dettaglio degli effetti sta in Storico distinte.
- Le fatture XML, che lo studio riceve già dallo SDI.
- Per corrispettivi e paghe, le fonti dirette (Agenzia delle Entrate e consulente del lavoro): il gestionale per agosto non le ha.

### cose che il gestionale deve ancora imparare (dati, non codice)

- Le deleghe I24 INPS e le altre deleghe del 07/08 non sono in Scadenze fiscali: se ci fossero, l'aggancio in banca e il codice tributo uscirebbero da soli.
- La rata di finanziamento del 31/08 non ha un finanziamento censito: la scheda Finanziamenti serve a questo.
- L'estratto carta CCP (2.415,80) copre spese di cui solo 947,80 sono fatture nel sistema: il resto sono scontrini che il commercialista chiederà comunque.
- La differenza tra emolumenti disposti (70.311,20) e netti importati (66.655,39) va spiegata una volta, poi il foglio F24/stipendi la mostrerà ogni mese.

---

## domande aperte per Patrizio e Sabrina

1. Lo studio ha un tracciato di import proprio (TeamSystem, Zucchetti, Profis) per la prima nota banca? Se sì, il foglio Banca va costruito su quel tracciato, non su un formato nostro. È la prima cosa da chiedere al commercialista.
2. Al commercialista serve il nostro conto CE sulle fatture (foglio 4) o registra con il suo piano dei conti? Cambia se vale la pena chiudere le 39 categorie mancanti prima di consegnare.
3. Va bene procedere con il passo A subito (è un bug) e con B, C, D, E a seguire, tutti sulla pagina Prima Nota?

Riferimenti letti: `src/pages/PrimaNota.tsx`, `src/pages/LiquidazioneIva.tsx`, `src/lib/ivaLiquidazione.ts`, `src/lib/cashClosingsExport.ts`, `src/pages/IncassiGiornalieri.tsx`, `GUIDA_DISTINTA_Sabrina.md`, `SPECCHIETTO_INCASSI_ANALISI.md`, vista `v_iva_componenti_mensili`, tabelle `bank_transactions`, `payables`, `electronic_invoices`, `active_invoices`, `fiscal_deadlines`, `employee_cost_slips`, `outlet_daily_closings`, `outlet_payment_channels`, `reconciliation_log`, `budget_confronto`.
