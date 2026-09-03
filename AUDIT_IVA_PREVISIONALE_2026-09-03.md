# audit previsionale IVA mensile (3 settembre 2026)

> Domanda di Patrizio: «abbiamo tutte le informazioni per avere un previsionale IVA ogni mese?»
> Risposta breve: **no, non ancora**. Il lato acquisti (IVA a credito) c'è quasi tutto. Il lato vendite (IVA a debito, che per un retailer è la voce grossa) esiste solo come totale mensile inserito a mano, senza aliquote e senza dato giornaliero. Mancano poi cinque informazioni strutturali: credito IVA riportato, parametri fiscali del tenant, quote indetraibili, data di ricezione affidabile per lo storico, generazione delle scadenze future. Il dettaglio sotto.

Metodo: lettura del codice (parser XML, bridge A-Cube, Scadenze Fiscali, Cashflow Prospettico) e interrogazione del DB vivo dei 3 tenant via connettore Supabase, sull'anno corrente 2026. Nessuna modifica a dati o codice: solo questo documento.

---

## 1. cosa serve per una liquidazione IVA mensile

La liquidazione del mese M (da versare con F24 entro il 16 di M+1, codici tributo 6001–6012) si calcola così:

```
IVA a debito del mese
    = IVA sui corrispettivi (incassi outlet, per aliquota)
    + IVA sulle fatture attive emesse nel mese
    + IVA "a debito" delle integrazioni reverse charge (TD16/TD17/TD18/TD19)
IVA a credito del mese
    = IVA delle fatture passive RICEVUTE (data SDI) e registrate nel mese
    - IVA delle note di credito ricevute
    + IVA "a credito" delle stesse integrazioni reverse charge (neutre, se detraibili)
    - quota indetraibile (auto, telefonia, vitto/alloggio, omaggi, pro-rata)
Liquidazione = debito - credito - credito riportato dal mese precedente
    > 0  → F24 da pagare
    < 0  → credito da riportare al mese dopo
```

In più: **acconto IVA del 27 dicembre** (88% con metodo storico, oppure previsionale/analitico) e conguaglio a gennaio. I record già presenti in Scadenze Fiscali (codici 6003, 6005, 6006, 6007) confermano che New Zago è **mensile**.

---

## 2. inventario: cosa abbiamo davvero (tenant NZ)

Legenda: ✅ c'è ed è usabile · 🔶 c'è ma con limiti · ❌ manca

| Componente | Dove vive | Stato al 3/9/2026 | Verdetto |
|---|---|---|---|
| Fatture passive con IVA | `electronic_invoices` | 1.250 fatture 2026 (gen→2 set), tutte con `vat_amount` e XML completo. Sync A-Cube ogni ora, ok. | ✅ |
| Riepiloghi IVA per aliquota / natura / esigibilità | XML in `electronic_invoices.xml_content` | Presenti in tutte. Aliquote viste: 22% (5.538 righe), 10% (926), 0% (383), 4% e 5% (residuali). Nature: N1, N2.2, N4, N6.7. Esigibilità sempre «I» (immediata): nessun split payment, nessuna differita. **Attenzione**: fino a giugno il contenuto è XML FatturaPA, da luglio è il JSON di A-Cube (`fattura_elettronica_body[0].dati_beni_servizi.dati_riepilogo`). Il parser deve gestire entrambi. | 🔶 |
| Note di credito passive (TD04) | `electronic_invoices` | 89 nel 2026, segno già gestito dal bridge. | ✅ |
| Integrazioni reverse charge (TD16 52, TD17 13, TD18 2) | `electronic_invoices` (archiviate), escluse dallo scadenzario (migration 131) | Ci sono. Ma nessuna logica le tratta come «neutre» ai fini IVA: oggi il loro `vat_amount` verrebbe sommato al credito come una fattura normale. | 🔶 |
| Data di ricezione SDI (mese di detraibilità) | `acube_sdi_invoices.acube_created_at` (join con `electronic_invoices.sdi_id` = `sdi_file_id`) | Ricezione media 50 giorni dopo la data fattura; 907 fatture su 1.250 cambiano mese. **Per le 924 fatture importate col backfill del 3 giugno la data è quella del backfill**, non quella reale: lo storico gen→mag non è ricostruibile per mese di ricezione. Da luglio in poi il dato è affidabile. | 🔶 |
| Fatture attive con IVA | `active_invoices` | 45 nel 2026, tutte 22%, con imponibile e imposta. Importi piccoli (IVA 50–1.700 €/mese). | ✅ |
| **Corrispettivi giornalieri con dettaglio IVA** | `corrispettivi_log`, `daily_revenue` | **0 righe** su tutti e 3 i tenant. Il feed A-Cube «receipts» è spento (`receipts_enabled = false`, stage sandbox). La funzione `sdi-sync` ha un ramo corrispettivi che chiama l'API AdE, ma non è mai stato eseguito (nessun run in `sync_runs`). | ❌ |
| Corrispettivi mensili (totale) | `budget_confronto`, `entry_type = cons_monthly` | Un totale per outlet e mese, gen→lug 2026, inserito a mano nella tabella «Inserimento rapido corrispettivi». Nessuna aliquota. Agosto non ancora inserito. Dal confronto con le liquidazioni pagate risulta **al netto IVA** (vedi §3): va confermato. | 🔶 |
| Aliquote di vendita per outlet | nessuna configurazione | Non esiste. L'ipotesi «tutto al 22%» regge sui numeri ma non è scritta da nessuna parte. | ❌ |
| Liquidazioni storiche 2026 | `fiscal_deadlines` (`iva_periodica`) | Marzo 3.850 · aprile 0 (annullata: era a credito) · maggio 25.325 · giugno 28.612 · luglio 39.064. Gennaio e febbraio esistono solo in banca (F24 12.077 a gennaio; «IVA FEBBRAIO 2026» 14.553 a marzo). | 🔶 |
| Liquidazioni future (agosto in poi) | `fiscal_deadlines` | **Nessuna riga**: né agosto (scade 16/9), né i mesi seguenti, né l'acconto del 27/12. Le righe hanno `is_recurring = true` ma non esiste nessun generatore di ricorrenze (né cron né trigger). | ❌ |
| Credito IVA riportato | da nessuna parte | Quando un mese è a credito (aprile) la riga viene annullata a 0 e l'importo del credito si perde. Serve anche il credito al 1/1/2026. | ❌ |
| Quote indetraibili | `cost_categories`, `suppliers` | Nessun campo di detraibilità. `electronic_invoices.cost_category_id` è nullo su tutte le 1.250 fatture (la categoria vive sul payable/fornitore). Ci sono fatture di ristoranti, hotel, Trenitalia, carburante: senza il flag l'IVA a credito viene sovrastimata. | ❌ |
| Parametri fiscali tenant | `companies.settings` | Contiene solo `email_scadenzario`. Niente periodicità, metodo acconto, pro-rata, saldo credito. | ❌ |
| Pagamenti F24 in banca | `bank_transactions` | Deleghe F24 visibili ogni mese (es. 39.063,80 il 20/8 = IVA luglio). Riconciliazione scadenza↔banca già prevista in Scadenze Fiscali («in banca»). | ✅ |
| Cashflow prospettico | `CashflowProspettico.tsx` | Le uscite fiscali vengono SOLO dal residuo non pagato di `fiscal_deadlines`. Senza righe IVA future, **il cashflow oggi non prevede nessuna uscita IVA da settembre in poi**. | 🔶 |

### Made e Zago
Vuoti: Made ha 4 fatture passive (lug→ago), Zago nessuna. Zero corrispettivi, zero scadenze fiscali, zero movimenti bancari. Il previsionale IVA per loro non è calcolabile finché non partono i flussi A-Cube (fatture, banche) e l'inserimento corrispettivi. Il motore, quando ci sarà, va comunque deployato su tutti e 3 (Regola #0).

---

## 3. verifica numerica: i dati che abbiamo bastano a ricostruire le liquidazioni pagate?

Ricostruzione con «IVA vendite = corrispettivi consuntivo × 22% + IVA fatture attive» e «IVA acquisti = fatture passive nette di NC, integrazioni escluse», tenant NZ, euro arrotondati.

| Mese 2026 | Corrispettivi (cons.) | IVA vendite se netto | IVA acquisti per data fattura | IVA acquisti per ricezione | Liquidazione stimata | Liquidazione reale |
|---|---|---|---|---|---|---|
| marzo | 176.928 | 39.661 | 49.182 | n.d. (backfill) | −9.521 | 3.850 pagata |
| aprile | 305.496 | 68.142 | 75.119 | n.d. | −6.977 | 0 (a credito) ✔ |
| maggio | 339.034 | 75.014 | 46.787 | n.d. | 28.227 | 25.325 ✔ |
| giugno | 319.081 | 70.272 | 31.063 | n.d. | 39.209 | 28.612 |
| luglio | 465.330 | 103.314 | 84.109 | 67.130 | 19.205 / **36.184** | 39.064 ✔ (per ricezione) |

Cosa dice la tabella:
- L'ipotesi «corrispettivi al lordo IVA» non regge: darebbe maggio 14.776 e luglio 17.724 contro 25.325 e 39.064 reali. Quella «al netto» si avvicina in 3 mesi su 5. I consuntivi in Budget & Controllo sono quindi imponibili, non incassi lordi (da confermare con Patrizio).
- Luglio torna solo usando la **data di ricezione** e non la data fattura: conferma che il mese di detraibilità è la ricezione SDI, e che senza quel dato lo storico gen→giu non può quadrare.
- Gli scarti residui (marzo, giugno, ~3.000 € a luglio) sono spiegabili con credito riportato, quota indetraibile e fatture registrate dal commercialista in mesi diversi. Sono esattamente le informazioni che mancano.

---

## 4. gap in ordine di priorità

1. **Corrispettivi con dettaglio per aliquota, giornalieri o almeno mensili.** È la voce più grande (70–100 mila €/mese di IVA a debito) ed è quella meno strutturata. Tre strade, dalla più solida alla più rapida: (a) attivare il feed «receipts» A-Cube e popolare `corrispettivi_log.vat_breakdown`; (b) import CSV/XML dei registratori telematici da Import Hub (la fonte «Corrispettivi» esiste già ma scrive solo gross/net in `daily_revenue`, senza aliquote); (c) nel frattempo, usare `cons_monthly × aliquota outlet` con l'aliquota salvata in configurazione.
2. **Parametri fiscali per tenant** (`companies.settings` o tabella `company_fiscal_settings`): periodicità (mensile/trimestrale), aliquota vendite per outlet, metodo acconto, credito IVA iniziale, pro-rata. Senza questi il motore non sa nemmeno da dove partire.
3. **Credito IVA riportato**: registrare l'esito di ogni liquidazione (anche negativa) invece di annullare la riga. Serve una tabella `vat_settlements` (mese, debito, credito, riporto, importo, stato, F24 collegato).
4. **Motore di liquidazione** (vista SQL `v_iva_liquidazione_mensile` con `security_invoker = on`, come da regola viste): legge i riepiloghi (XML e JSON), usa la data di ricezione, gestisce NC, tratta TD16/17/18/19 come neutre, applica la quota indetraibile.
5. **Generazione automatica delle scadenze IVA future** in `fiscal_deadlines` (stima azzurra, come le altre uscite «≈» del cashflow), più l'acconto del 27/12. Così Cashflow Prospettico e Scadenzario le vedono senza inserimento manuale. Alla chiusura del mese la stima diventa importo confermato e si riconcilia con l'F24 in banca (flusso già esistente).
6. **Quota indetraibile per categoria** (`cost_categories.vat_deductible_pct`, default 100) e propagazione alle fatture via fornitore. Impatto stimato piccolo ma sistematico (qualche migliaio di euro al mese).
7. **Parser unico dei riepiloghi**: oggi `xmlInvoiceParser.ts` legge solo XML; le fatture da luglio sono JSON. Va gestito prima di qualsiasi calcolo, altrimenti da luglio in poi aliquote e nature risultano vuote.

---

## 5. domande per Patrizio (risposta binaria, poi si parte)

1. I consuntivi corrispettivi in Budget & Controllo sono **al netto** dell'IVA? (i numeri dicono sì)
2. Tutte le vendite negli outlet sono al **22%**? Ci sono vendite esenti o ad altre aliquote?
3. La liquidazione è **mensile** (confermato dai codici 6003–6007). Il commercialista usa il **metodo storico** per l'acconto di dicembre?
4. Qual è il **credito IVA** al 1/1/2026 e dopo la liquidazione di luglio? (basta il dato del commercialista, una volta)
5. Per i corrispettivi: possiamo avere l'**export giornaliero dei registratori telematici** (o attivare i receipts A-Cube), oppure per ora ci basta il totale mensile per outlet?

Con le risposte 1–4 si può costruire subito un previsionale «buono» (totale mensile × aliquota, fatture passive per ricezione, riporto credito). Con la 5 diventa un previsionale «vero», aggiornato ogni giorno.

---

## appendice: query usate (tenant NZ, `xfvfxsvqpnpvibgeqpqp`)

```sql
-- presenza dati per tabella
select 'electronic_invoices', count(*), count(vat_amount), count(xml_content), min(invoice_date), max(invoice_date) from electronic_invoices
union all select 'corrispettivi_log', count(*), count(vat_breakdown), count(xml_content), min(date), max(date) from corrispettivi_log
union all select 'daily_revenue', count(*), count(net_revenue), count(gross_revenue), min(date), max(date) from daily_revenue;

-- liquidazioni registrate
select title, due_date, tax_period, amount, amount_paid, status, f24_code from fiscal_deadlines where deadline_type like 'iva%' order by due_date;

-- aliquote e nature nei riepiloghi (XML fino a giugno, JSON da luglio)
select m[1], count(*) from electronic_invoices, regexp_matches(xml_content, '<AliquotaIVA>([0-9.]+)</AliquotaIVA>', 'g') m where xml_content like '<%' group by 1;
select a->>'aliquota_iva', count(*) from electronic_invoices, jsonb_array_elements(xml_content::jsonb->'fattura_elettronica_body'->0->'dati_beni_servizi'->'dati_riepilogo') a where xml_content like '{%' group by 1;

-- ritardo tra data fattura e ricezione SDI
select count(*), count(*) filter (where date_trunc('month',acube_created_at) <> date_trunc('month',invoice_date)), avg(acube_created_at::date - invoice_date) from acube_sdi_invoices where direction='passive';

-- feed corrispettivi A-Cube
select receipts_enabled, supplier_invoice_enabled, customer_invoice_enabled, stage from acube_sdi_business_registry_configs;
```
