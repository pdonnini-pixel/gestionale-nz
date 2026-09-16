// Foglio «Guida» dell'Excel della Prima Nota: spiega foglio per foglio cosa
// c'è, come si legge e come si cerca. Scritto per chi tiene la contabilità
// (Studio Poli) e apre il file senza il gestionale davanti. Le righe usano i
// tipi di `xlsxStyled` (sezione, testo, meta), così il foglio ha la stessa
// grafica degli altri.
import type { StyledRow } from './xlsxStyled'

export type GuidaInput = {
  periodo: string
  dataUsata: string
  /** Nomi dei fogli per conto, nell'ordine in cui compaiono. */
  conti: string[]
  /** Nomi dei fogli per carta (estratti di credito e prepagata), nell'ordine in cui compaiono. */
  carte: string[]
  /** Nomi dei fogli per carta di debito (pagamenti POS dal conto). */
  carteDebito: string[]
  /** Quante disposizioni stipendi senza buste sono elencate in coda al foglio Dipendenti. */
  flussiSenzaBuste: number
}

const t = (label: string, text: string): StyledRow => ({ kind: 'text', cells: [label, text] })
const s = (title: string): StyledRow => ({ kind: 'section', cells: [title, ''] })
const b = (): StyledRow => ({ kind: 'blank', cells: [] })

export const GUIDA_WIDTHS = [34, 120]

export function buildGuidaRows(g: GuidaInput): StyledRow[] {
  const rows: StyledRow[] = [
    { kind: 'title', cells: ['Prima Nota: guida al file'] },
    { kind: 'meta', cells: ['Periodo', g.periodo] },
    { kind: 'meta', cells: ['Data usata per il periodo', g.dataUsata] },
    { kind: 'meta', cells: ['Fonte', 'Gestionale NZ, Banche → Prima Nota. I movimenti arrivano dallo scarico bancario (A-Cube), le fatture dallo Scadenzario, i netti dalle buste paga, le righe carta dagli estratti importati.'] },
    b(),
    s('Come è fatto il file'),
    t('Fogli per conto', `${g.conti.length === 0 ? 'Nessun conto nel periodo.' : g.conti.join(' · ')}. Un foglio per ogni conto corrente, impaginato come un estratto conto: saldo iniziale, movimenti con saldo progressivo, saldo finale calcolato e saldo della banca.`),
    t('Incassi per outlet', 'Le entrate in banca del periodo (POS, Amex, versamenti di contante, bonifici di clienti) attribuite al punto vendita.'),
    t('Dipendenti ed emolumenti', `Una riga per busta paga con il netto e la disposizione bancaria che l'ha pagata.${g.flussiSenzaBuste > 0 ? ` In coda, ${g.flussiSenzaBuste} disposizion${g.flussiSenzaBuste === 1 ? 'e' : 'i'} senza buste che le spieghino.` : ''}`),
    t('Fogli per carta', g.carte.length === 0 ? 'Nessun estratto carta importato per il periodo.' : `${g.carte.join(' · ')}. Un foglio per ogni estratto conto carta (credito e prepagata), riga per riga, con la fattura pagata e il riscontro in banca.`),
    t('Fogli per carta di debito', g.carteDebito.length === 0 ? 'Nessun pagamento con carta di debito nel periodo.' : `${g.carteDebito.join(' · ')}. Un foglio per ogni carta di debito con i pagamenti POS del periodo, letti dai movimenti del conto: stessa struttura degli estratti, ma ogni riga è già in banca.`),
    b(),
    s('Legenda dei colori'),
    t('Intestazione blu', 'Riga dei titoli di colonna. È bloccata: resta visibile scorrendo. Ha il filtro automatico: clicca la freccetta per filtrare o ordinare.'),
    t('Righe grigie in neretto', 'Saldo iniziale e saldo finale del conto (o totali dell\'estratto carta).'),
    t('Righe ambra', 'Fatture a RICEVUTA BANCARIA (RiBa): sia il movimento che le salda, sia le righe di dettaglio delle singole fatture RiBa.'),
    t('Righe in corsivo grigio', 'Dettaglio sotto un movimento che salda più fatture: una riga per fattura («↳ di cui fattura»), poi l\'eventuale resto e il totale.'),
    t('Riga verde / riga rossa', 'Esito della quadratura: verde se il saldo calcolato coincide con quello della banca, rosso se NON QUADRA.'),
    t('Importi', 'Tutti gli importi sono numeri in formato euro: si sommano e si filtrano. Cerca un importo come lo vedi scritto, per esempio 10.964,00.'),
    b(),
    s('Fogli per conto: cosa trovi'),
    t('Intestazione', 'Banca, IBAN e periodo, con la data usata (contabile o operazione).'),
    t('Saldo iniziale', 'Saldo del conto al giorno prima del periodo. Nella seconda colonna: il saldo letto dalla banca allo scarico e le rettifiche applicate.'),
    t('Data operazione / Data contabile', 'La data in cui il movimento è avvenuto e quella stampata dalla banca sull\'estratto. Di solito coincidono.'),
    t('Tipo movimento', 'Che cos\'è la riga: Pagamento fornitore (con «(RiBa)» se le fatture sono a ricevuta bancaria), F24 / imposte, Stipendi, Incasso POS, Versamento contanti, Carta di credito, Carta di debito (POS), Finanziamento, Spese e commissioni bancarie, Giroconto / prelievo, Incasso cliente, Rimborso, Da chiarire.'),
    t('Contropartita e P.IVA', 'Il fornitore (o «N fornitori (M fatture)» se sono più d\'uno), l\'outlet per incassi e versamenti, l\'ordinante per i bonifici in entrata.'),
    t('N. fatture e Causale', 'Quante fatture salda il movimento e i loro numeri. Per gli F24: titolo, codice tributo e periodo. Altrimenti la causale della banca, riportata per intero così come arriva. Le RiBa: «RiBa · Fatt. …».'),
    t('Causali corte', 'Alcune causali delle BCC arrivano dalla banca già tagliate a 34 caratteri (per esempio «Commissioni su bonifico tramite co»): non è un taglio del gestionale, il testo completo esiste solo sull\'estratto conto della banca.'),
    t('Entrate / Uscite / Saldo', 'Importo in entrata o in uscita e saldo progressivo del conto dopo il movimento.'),
    t('Di cui fattura', 'Solo nelle righe di dettaglio: l\'importo della singola fattura saldata dal movimento. La somma delle righe «↳ di cui fattura» più l\'eventuale «↳ resto» dà l\'uscita.'),
    t('Saldo finale e Differenza', 'Saldo calcolato (iniziale + movimenti), saldo della banca all\'ultimo giorno e differenza: zero vuol dire estratto completo, senza movimenti mancanti né doppi.'),
    b(),
    s('Fogli per conto: come si cerca'),
    t('Un importo', 'Ctrl+F (Cmd+F su Mac), scrivi l\'importo come appare (es. 1.713,90) e cerca nelle colonne Entrate o Uscite.'),
    t('Un fornitore o una fattura', 'Filtro sulla colonna Contropartita, oppure Ctrl+F sul numero di fattura: lo trovi nella Causale e, per i movimenti cumulativi, nelle righe «↳ di cui fattura».'),
    t('Tutte le RiBa', 'Filtro sulla colonna Tipo movimento → «Pagamento fornitore (RiBa)», oppure cerca «RiBa» con Ctrl+F.'),
    t('Solo un tipo di movimento', 'Filtro sulla colonna Tipo movimento (per esempio Stipendi, F24 / imposte, Incasso POS).'),
    b(),
    s('Incassi per outlet'),
    t('Cosa trovi', 'Data operazione, data di riferimento (il giorno di vendita), conto, outlet, canale, tipo (POS, Amex, Versamento contanti, Bonifico cliente, Altro incasso), terminale, importo, causale. Non ci sono giroconti né rimborsi: la restituzione di un fornitore o la liquidazione transattiva di un corriere non è un incasso, e sta solo nel foglio del conto come «Rimborso / restituzione».'),
    t('Come si cerca', 'Filtro sulla colonna Outlet per vedere gli incassi di un solo negozio; filtro su Tipo per separare POS, Amex e versamenti. Un outlet vuoto significa che l\'accredito non è stato attribuito.'),
    b(),
    s('Dipendenti ed emolumenti'),
    t('Cosa trovi', 'Per ogni busta paga: dipendente, outlet, mese di competenza, netto, data di pagamento, conto, ID della disposizione (flusso CBI), bonifici contati dalla banca, buste nel flusso, importo del flusso, commissioni, ADDEBITO IN BANCA, esito.'),
    t('Addebito in banca', 'È l\'importo del flusso più le commissioni, cioè la cifra esatta del movimento sull\'estratto conto. Per assegnare la distinta a un gruppo di dipendenti: prendi l\'addebito in banca, aprilo nel foglio del conto indicato in «Conto Banca» (colonna Uscite, con Ctrl+F) e quel movimento è la distinta di tutti i dipendenti con lo stesso ID flusso.'),
    t('Il gruppo di dipendenti', 'Filtro sulla colonna «Disposizione (ID flusso)»: le righe con lo stesso ID sono le buste pagate da quella disposizione. La somma dei loro netti è l\'importo del flusso.'),
    t('Esito', '«abbinata alla disposizione» quando i netti spiegano il flusso al centesimo. Se la banca conta più bonifici delle buste, un netto è stato pagato in più bonifici e l\'esito lo dice. «nessun pagamento trovato» (riga ambra) se nel periodo non c\'è una disposizione che copra quella busta.'),
    t('Disposizioni senza buste', 'In coda al foglio: i flussi stipendi usciti dalla banca che nessun gruppo di buste spiega (buste non ancora caricate o importo diverso). Da guardare con lo studio paghe.'),
    b(),
    s('Fogli per carta di debito'),
    t('Cosa trovi', 'Intestazione con carta, conto e periodo; poi una riga per pagamento POS: data di acquisto (dalla causale), data contabile, esercente, importo, commissioni, fornitore e fattura dello Scadenzario pagata con carta di debito, data di pagamento, riscontro in banca (la data del movimento sul conto).'),
    t('Come si legge', 'La carta di debito non ha un estratto a parte: ogni pagamento esce subito dal conto, quindi lo trovi anche nel foglio del conto come «Carta di debito (POS)», con la stessa data e lo stesso importo. Il totale in fondo è la somma dei pagamenti del periodo.'),
    b(),
    s('Fogli per carta'),
    t('Cosa trovi', 'Intestazione con carta, periodo e file; poi una riga per operazione: data di acquisto e registrazione, descrizione, importo (spese negative, storni e ricariche positive), commissioni, valuta, fornitore e fattura dello Scadenzario pagata con quella riga, data di pagamento, riscontro in banca.'),
    t('Totali e addebito', 'Totale delle righe lette, totale dichiarato dal documento, addebito unico in banca (per le carte di credito) o ricariche ritrovate (per la prepagata), differenza: sono le commissioni della banca.'),
    t('Prepagata: il saldo', 'La carta prepagata (Tasca) si ricarica dal conto e si spende: il foglio è un estratto conto della carta. In testa il SALDO INIZIALE, poi le righe in ordine cronologico con la colonna Saldo (saldo della carta dopo ogni riga: le ricariche lo alzano, spese e commissioni lo abbassano), in fondo il SALDO FINALE calcolato (iniziale + ricariche − spese − commissioni). Le ricariche sono le stesse che escono dal conto come «Ricarica carta prepagata TASCA»: la riga «Ricariche ritrovate in banca» dice quante hanno il movimento in banca.'),
    t('Prepagata: da dove viene il saldo', 'Il portale Tasca non stampa un saldo iniziale e finale: il PDF riporta solo la «Disponibilità» alla data di stampa. Il gestionale la usa come àncora: il primo estratto che la dichiara ha quel saldo finale, e i mesi prima e dopo si ricostruiscono a catena sommando o togliendo il netto di ogni mese («dal documento», «a catena»). Se nessun estratto la dichiara, la catena parte da zero al primo estratto e il foglio lo segnala («da zero»): basta importare un PDF del portale per ancorare tutto. Se il PDF è stampato settimane dopo la chiusura del mese, la sua Disponibilità include anche i movimenti successivi: in quel caso il foglio la mostra a parte e non la usa come saldo finale.'),
    t('Come si cerca', 'Ctrl+F sull\'importo o sul nome dell\'esercente nella Descrizione; filtro su Fornitore per vedere le righe agganciate a una fattura.'),
  ]
  return rows
}
