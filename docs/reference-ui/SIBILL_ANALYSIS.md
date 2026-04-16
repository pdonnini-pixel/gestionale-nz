# Analisi UI Reference — Sibill (Gestionale Bancario)

Data analisi: 16 aprile 2026
Fonte: Screenshots forniti da Patrizio (app Sibill con dati reali MPS)

---

## 1. CONTI (Dashboard Bancaria)

**Cosa mostra:**
- Saldo totale disponibile aggregato (1.969,41 EUR) in grande evidenza
- Conti raggruppati per istituto bancario (Monte dei Paschi Personal, Paypal, Conti manuali)
- Per ogni conto: nome, IBAN parziale mascherato, saldo
- Icona banca riconoscibile per ogni gruppo
- Pulsanti: "Nascondi saldi", "Esporta", "+ Aggiungi conto"
- Popup onboarding: "Collega tutti i tuoi conti" con CTA

**Idee per il nostro gestionale:**
- Mostrare i conti raggruppati per banca con logo/icona
- Saldo aggregato ben visibile in cima
- Supporto per conti manuali (cassa contanti: 300 EUR)
- IBAN parzialmente mascherato per sicurezza
- Possibilita di nascondere saldi (utile per screen sharing)

---

## 2. MOVIMENTI (Lista Transazioni)

**Cosa mostra:**
- Filtri potenti: Conto specifico (MPS | ***X417), Categoria, Data (Novembre 23), Status, Tipo
- KPI in cima: 102 risultati | -45.144,17 EUR (uscite) | 51.035,53 EUR (entrate) | 5.891,36 EUR (netto)
- Tab: Tutti / Entrate / Uscite / Da verificare / Non categorizzati
- Per ogni movimento: Data + tipo operazione, Controparte con avatar, Descrizione, Importo (rosso/verde), Categoria con badge colorato, Verificato (SI/NO toggle)
- Pulsanti: "Proposte di categorizzazione", "+ Aggiungi transazione", "Scarica"

**Idee per il nostro gestionale:**
- Tab "Da verificare" e "Non categorizzati" per workflow di riconciliazione
- Badge categoria colorato accanto all'importo
- Toggle "Verificato" SI/NO per ogni movimento
- Proposte di categorizzazione automatica (AI-driven)
- KPI sommario con entrate/uscite/netto
- Avatar/icona per la controparte
- "Regole in entrata" e "Regole in uscita" come tab separate

---

## 3. FATTURE — Situazione Annuale (2024)

**Cosa mostra:**
- Grafico a barre mensile "Imponibile 2024" (gen-dic, max ~63.000)
- Grafico separato "Calcolo IVA e ritenute 2024" con A Credito / A Debito / Tasse nette
- KPI: Ricavi 120.544,49 EUR | Costi 72.489,24 EUR | Differenza 48.055,25 EUR
- IVA: A Credito 13.471,52 | A Debito 21.629,70 | Tasse nette -8.158,18
- Tab: Situazione / Ricevute / Emesse / Corrispettivi
- Tabella Clienti: nome, ricavi imponibili, documenti, % anno
- Tabella Fornitori: nome, costi imponibili, documenti, % anno
- Filtro anno + divisione (Mensile)

**Idee per il nostro gestionale:**
- Dashboard fatturazione con vista annuale
- Calcolo IVA automatico da fatture XML importate
- Classificazione clienti/fornitori per peso % sul totale
- Grafici a barre mensili per imponibile
- Separazione Ricevute/Emesse/Corrispettivi

---

## 4. FATTURE — Creazione Nuova

**Cosa mostra:**
- Form strutturato: Da (azienda) → Invia a (cliente) → Prodotti e Servizi
- Tipo documento: TD01 - Fattura ordinaria, toggle Elettronica
- Campi prodotto: Descrizione, Codice, Quantita, Unita misura, Prezzo unitario, IVA %
- Dati pagamento: Metodo (Bonifico), Conto, Coordinate
- Riepilogo: Totale imponibile, Totale da pagare
- Data documento editabile
- "Aggiungi linea prodotto +"
- Sezione Scadenze in fondo

**Idee per il nostro gestionale:**
- Per ora non prioritario (non emettiamo fatture), ma utile come reference per il modulo fatturazione attiva futuro
- La struttura Scadenze legate alla fattura e interessante per il nostro Scadenzario

---

## 5. FATTURE — Situazione 2023

**Cosa mostra:**
- Stesso layout del 2024 ma con dati 2023 piu corposi
- Ricavi 435.848,60 EUR (vs 120K nel 2024 — possibile cambio regime o attivita)
- Clienti top: 96MKR019I56 (52%), 96MKR019I99 (39%) — codici fiscali come ID
- Fornitori top con lista piu lunga e percentuali
- A Debito 30.881,38 | Tasse nette 32.039,28
- Popup: "Sincronizza fatture e corrispettivi" + "registratori telematici"

**Idee per il nostro gestionale:**
- Sincronizzazione con SDI/AdE per fatture elettroniche (gia parzialmente implementato con XML parser)
- Corrispettivi telematici come fonte dati aggiuntiva
- Analisi trend anno su anno

---

## 6. MOVIMENTI — Dettaglio con Riconciliazione

**Cosa mostra:**
- 1608 risultati totali per il conto
- Click su movimento apre pannello laterale destro con:
  - Data, tipo operazione, controparte, numero riferimento
  - Importo grande (-2.538,80 EUR)
  - Toggle "Verifica" + "Nascondi" + "+ Crea ricorrenza"
  - Sezione "Giustificativi" con "Carica allegati"
  - Campo "Cerca una fattura da riconciliare"
  - "Proposte di riconciliazione" (evidenziato in arancione)
  - Match trovato: "BANCA MONTE DEI PASCHI DI SIEN... | Da pagare | -2.538,80 EUR" con pulsante "Riconcilia"
- Popup: "Riconcilia ed esporta la prima nota in un clic"

**Idee CRITICHE per il nostro gestionale:**
- Pannello laterale per dettaglio movimento (non modal)
- Riconciliazione semi-automatica: suggerisce match tra movimento e fattura
- "Proposte di riconciliazione" basate su importo/data/fornitore
- Creazione ricorrenze da movimenti (es. affitto mensile)
- Upload giustificativi/allegati per movimento
- Esportazione prima nota
- Workflow: Movimento → Match Fattura → Riconcilia → Verificato

---

## 7. SCADENZARIO (Proiezione Scadenze)

**Cosa mostra:**
- Grafico a linea "Proiezione scadenze" su timeline (dic-mar)
- KPI in cima: Saldo oggi 1.969,41 | Pagamenti 23.750,33 (di cui 16.800 ricorrenti) | Incassi 23.307,00 (di cui 22.500 ricorrenti) | Saldo finale 1.526,08 (al 3 marzo)
- KPI secondari: Scaduto da pagare 99.273,87 | Scaduto da incassare 19.083,89 | Saldo finale incluso scaduto -78.663,90
- Tab: Tutte / Scadute / Da saldare / Saldate / Conto non assegnato
- Filtri: Ricerca, Data, Tipo (Incassi), Conto, Pagamento, Tipo documento
- Per ogni scadenza: Data pagamento, Controparte, Importo, Stato (badge colorato: Incassato/Da pagare), Conto di pagamento
- Pannello laterale destro per dettaglio scadenza con: Importo, Valuta, Scadenza, Modalita pagamento, Conto in fattura, Conto di pagamento, pulsanti Sollecita/Rimuovi

**Idee CRITICHE per il nostro gestionale:**
- Proiezione grafica del saldo nel tempo (linea temporale)
- Distinzione Pagamenti/Incassi con evidenza ricorrenti
- "Saldo finale incluso scaduto" come KPI chiave per tesoreria
- Tab "Conto non assegnato" per scadenze senza banca collegata
- Pulsante "Sollecita" per inviare reminder
- Pulsante "Cerca movimenti" per riconciliazione rapida

---

## 8. CASHFLOW — Flussi di Cassa (2023)

**Cosa mostra:**
- Grafico a barre mensile: entrate (verde) + uscite (rosso) + linea netto
- Filtri: Conti (3), anno 2023
- Tabella dettagliata mese per mese con stato "Realizzato" per ogni mese
- Riga "Flusso di cassa netto" con valori mensili
- Espandibile: "Tutte le entrate" con sotto-categorie: Incassi Extra, Punto vendita, Non categorizzata
- Espandibile: "Tutte le uscite" con sotto-categorie: Fornitori, Marketing, Rimborso mutuo, Servizi, Spese bancarie, Spese di gestione
- Colonna Totale annuo a destra
- Pulsanti: "Mostra analisi", "Esporta"

**Idee CRITICHE per il nostro gestionale:**
- Cashflow consuntivo con categorie espandibili
- Distinzione Realizzato vs Previsto per mese
- Sotto-categorie per entrate e uscite
- Riga netto evidenziata
- Esportazione dati
- Layout tabellare molto leggibile

---

## 9. CASHFLOW — Previsionale (lug 2023 - giu 2024)

**Cosa mostra:**
- Stesso layout ma con mix Realizzato + Previsto
- Mesi passati: "Realizzato", mesi futuri: "Previsto"
- Grafico con linea tratteggiata per previsioni
- Budget per categorie future editabili (celle bianche con bordo)
- Stesse categorie ma con valori previsionali
- Range date personalizzabile (luglio 2023 → giugno 2024)
- Pulsante "Personalizza"

**Idee CRITICHE per il nostro gestionale:**
- Transizione visiva Realizzato → Previsto nella stessa vista
- Celle editabili per budget previsionali
- Linea tratteggiata nel grafico per distinguere consuntivo da forecast
- Range temporale personalizzabile
- Possibilita di impostare budget per categoria

---

## PRIORITA DI IMPLEMENTAZIONE (per il nostro gestionale)

### Alta priorita (impatto immediato):
1. **Movimenti bancari con riconciliazione** — pannello laterale, match fatture, verificato SI/NO
2. **Cashflow consuntivo** — tabella mese per mese con categorie espandibili da cash_movements
3. **Proiezione saldo** — grafico timeline con scadenze + movimenti reali

### Media priorita (prossime iterazioni):
4. **Categorizzazione automatica** — regole + proposte AI per movimenti
5. **Cashflow previsionale** — Realizzato vs Previsto nella stessa vista
6. **Dashboard conti** — saldo aggregato, conti raggruppati

### Bassa priorita (futuro):
7. **Fatturazione attiva** — emissione fatture
8. **Corrispettivi** — sincronizzazione registratori telematici
9. **Solleciti automatici** — invio reminder per scadenze
