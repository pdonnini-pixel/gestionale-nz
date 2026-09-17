// Foglio «Codici negozi» della Prima Nota: gli estratti conto Nexi e Amex e gli
// accrediti in banca non riportano il nome del negozio ma un codice (punto
// vendita LN…, contratto PC…, codice esercente Amex, numero del terminale POS).
// Monica dello Studio Poli, il 17/09/2026: «gli estratti conto Nexi sono
// numerati ma senza il nome del negozio». Qui, per ogni negozio, tutti i codici
// che lo identificano, letti dai canali di incasso e dai contratti censiti nel
// gestionale: nessuna lista da compilare a mano.
import type { StyledRow } from './xlsxStyled'
import type { PnChannel, PnOutletInfo } from './primaNotaIncassi'

export type PnContratto = {
  outlet_id: string | null
  acquirer: string
  merchant_code: string
  payment_contract: string | null
  settlement_mode: string
  is_active: boolean
}

export const CODICI_WIDTHS = [30, 18, 16, 12, 34, 20, 20, 30]

export type CodiciRow = {
  Negozio: string
  'Nexi punto vendita': string
  'Nexi contratto': string
  'Nexi regime': string
  'Amex codici esercente': string
  'POS BCC terminale': string
  'POS MPS terminale': string
  'Contanti parola chiave': string
}

const regime = (mode: string | null | undefined): string => (mode === 'lordo' ? 'al lordo' : mode === 'netto' ? 'al netto' : '')

/** Una riga per negozio con tutti i codici che lo identificano nei documenti. */
export function buildCodiciRows(outlets: Map<string, PnOutletInfo>, channels: PnChannel[], contratti: PnContratto[], bankNameOf: (id: string | null) => string): CodiciRow[] {
  const ids = new Set<string>()
  for (const c of channels) if (c.is_active) ids.add(c.outlet_id)
  for (const c of contratti) if (c.is_active && c.outlet_id) ids.add(c.outlet_id)
  const rows: CodiciRow[] = []
  for (const id of ids) {
    const o = outlets.get(id)
    if (!o) continue
    const nexi = contratti.filter(c => c.is_active && c.outlet_id === id && c.acquirer === 'nexi')
    const amex = contratti.filter(c => c.is_active && c.outlet_id === id && c.acquirer === 'amex')
    const pos = channels.filter(c => c.is_active && c.outlet_id === id && c.kind === 'pos' && c.terminal_code)
    const byBank = (test: (bank: string) => boolean) => Array.from(new Set(pos.filter(c => test(bankNameOf(c.bank_account_id).toUpperCase())).map(c => c.terminal_code!))).join(', ')
    const cash = channels.find(c => c.is_active && c.outlet_id === id && c.kind === 'contanti' && c.terminal_code)
    rows.push({
      Negozio: o.code ? `${o.code} · ${o.name}` : o.name,
      'Nexi punto vendita': nexi.map(c => c.merchant_code).join(', '),
      'Nexi contratto': nexi.map(c => c.payment_contract ?? '').filter(Boolean).join(', '),
      'Nexi regime': nexi.map(c => regime(c.settlement_mode)).filter(Boolean).join(', '),
      'Amex codici esercente': amex.map(c => c.merchant_code).join(', '),
      'POS BCC terminale': byBank(b => b.includes('BCC')),
      'POS MPS terminale': byBank(b => b.includes('MPS') || b.includes('MONTE')),
      'Contanti parola chiave': cash?.terminal_code ?? '',
    })
  }
  return rows.sort((a, b) => a.Negozio.localeCompare(b.Negozio))
}

/** Il foglio intero: intestazione, tabella, e dove si legge ogni codice sui documenti. */
export function buildCodiciSheet(rows: CodiciRow[], periodo: string): StyledRow[] {
  const headers = Object.keys(rows[0] ?? { Negozio: '' }) as (keyof CodiciRow)[]
  const out: StyledRow[] = [
    { kind: 'title', cells: ['Codici dei negozi'] },
    { kind: 'meta', cells: ['Periodo', periodo] },
    { kind: 'meta', cells: ['Come si usa', 'Gli estratti conto Nexi e Amex e gli accrediti in banca non riportano il nome del negozio ma un codice. Cerca il codice che vedi sul documento in questa tabella (Ctrl+F) e leggi il negozio nella prima colonna. I codici non cambiano da un mese all\'altro.'] },
    { kind: 'blank', cells: [] },
  ]
  if (rows.length === 0) {
    out.push({ kind: 'text', cells: ['Nessun canale di incasso né contratto censito.'] })
    return out
  }
  out.push({ kind: 'header', cells: headers as string[] })
  for (const r of rows) out.push({ kind: 'data', cells: headers.map(h => r[h]) })
  out.push(
    { kind: 'blank', cells: [] },
    { kind: 'section', cells: ['Dove si legge il codice sui documenti'] },
    { kind: 'text', cells: ['Estratto conto Nexi', 'A pagina 2, la riga «VICOLO - punto vendita cod. LN…» seguita dall\'indirizzo del centro commerciale: è la colonna «Nexi punto vendita». Poco sotto, «Payment Contract PC…» è la colonna «Nexi contratto». «Al netto» vuol dire che in banca arriva il transato meno le commissioni; «al lordo» che arriva il transato pieno e le commissioni sono addebitate a parte.'] },
    { kind: 'text', cells: ['Estratto conto Amex', 'Ogni punto vendita ha il suo codice esercente di 10 cifre, stampato nell\'estratto accanto al nome. Lo stesso numero chiude la causale dell\'addebito delle commissioni sul conto («A FAVORE AMERICAN EXPRESS … CODICE MANDATO …»: le ultime 10 cifre).'] },
    { kind: 'text', cells: ['Accrediti POS in banca', 'Nella causale dell\'accredito c\'è il numero del terminale: per BCC/Numia «COD.SIA:6181087-00006», le ultime 5 cifre; per MPS lo stesso numero di terminale accanto alla data di riferimento. Sono le colonne «POS BCC terminale» e «POS MPS terminale».'] },
    { kind: 'text', cells: ['Versamenti di contante', 'La causale del versamento contiene la parola chiave del negozio (per esempio PALMANOVA, FOIANO, il numero dello sportello ATM): è la colonna «Contanti parola chiave».'] },
  )
  return out
}
