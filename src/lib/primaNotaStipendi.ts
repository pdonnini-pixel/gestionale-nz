// Foglio «Dipendenti ed emolumenti» della Prima Nota.
//
// Richiesta di Patrizio (15/09/2026): per il mese, la lista con nome e cognome
// e il netto pagato, riconducibile al pagamento in banca, così lo studio fa il
// collegamento. Dato misurato su NZ: le disposizioni CBI di emolumenti del 10
// del mese (una per outlet, la sede ne ha due) corrispondono al centesimo ai
// netti delle buste paga del mese precedente, outlet per outlet: 9 flussi del
// 10/08 = 70.235,70 = netti di luglio (37 buste), più 75,50 di commissioni.
//
// La causale della disposizione porta tutto ciò che serve:
//   "ID FLUSSO CBI: 136472521 NUM. TOT. PAGAMENTI: 6 IMPORTO BONIFICI: 6.693,00 IMPORTO COMMISSIONI: 10,50"
// L'abbinamento cerca, fra le buste paga del mese prima (o dello stesso mese)
// raggruppate per outlet, il sottoinsieme che somma esattamente all'importo
// dei bonifici. Niente da chiedere a nessuno; ciò che non si abbina resta in
// evidenza.

export type PnSlip = {
  id: string
  employee_id: string | null
  year: number
  month: number
  tipo: string | null
  netto: number | null
  outlet_code: string | null
  cognome: string | null
  nome: string | null
}

export type PnFlusso = {
  id: string
  transaction_date: string
  amount: number
  description: string | null
  bank_account_id: string | null
}

export type FlussoInfo = {
  id_flusso: string | null
  n_pagamenti: number | null
  importo_bonifici: number | null
  commissioni: number | null
}

const r2 = (n: number): number => Math.round(n * 100) / 100
const itNum = (s: string): number => Number(s.replace(/\./g, '').replace(',', '.'))

/** Legge id flusso, numero pagamenti, importo bonifici e commissioni dalla causale della disposizione. */
export function parseFlusso(descr: string | null | undefined): FlussoInfo {
  const d = descr ?? ''
  const id = /ID FLUSSO CBI:\s*(\d+)/i.exec(d)?.[1] ?? null
  const n = /NUM\.?\s*TOT\.?\s*PAGAMENTI:\s*(\d+)/i.exec(d)?.[1]
  const imp = /IMPORTO BONIFICI:\s*([\d.]+,\d{2})/i.exec(d)?.[1]
  const comm = /IMPORTO COMMISSIONI:\s*([\d.]+,\d{2})/i.exec(d)?.[1]
  return {
    id_flusso: id,
    n_pagamenti: n ? Number(n) : null,
    importo_bonifici: imp ? itNum(imp) : null,
    commissioni: comm ? itNum(comm) : null,
  }
}

export const nomeDipendente = (s: PnSlip): string => [s.cognome, s.nome].filter(Boolean).join(' ').trim() || '—'

/** Mese e anno di competenza candidati per un pagamento fatto il giorno D: il mese prima e lo stesso mese. */
export function competenzeCandidate(paymentDate: string): Array<{ year: number; month: number }> {
  const y = Number(paymentDate.slice(0, 4))
  const m = Number(paymentDate.slice(5, 7))
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 }
  return [prev, { year: y, month: m }]
}

/** Sottoinsieme di buste (stesso outlet) che somma esattamente al target; preferisce il gruppo intero, poi il più numeroso. */
function subsetSum(slips: PnSlip[], target: number): PnSlip[] | null {
  const total = r2(slips.reduce((s, x) => s + (Number(x.netto) || 0), 0))
  if (Math.abs(total - target) < 0.005) return slips
  if (slips.length > 16) return null
  let best: PnSlip[] | null = null
  const n = slips.length
  for (let mask = 1; mask < (1 << n); mask++) {
    let sum = 0
    let count = 0
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { sum += Number(slips[i].netto) || 0; count++ }
    if (Math.abs(r2(sum) - target) < 0.005 && (!best || count > best.length)) {
      best = slips.filter((_, i) => mask & (1 << i))
    }
  }
  return best
}

export type StipendioRow = {
  slip: PnSlip
  flusso: PnFlusso | null
  info: FlussoInfo | null
  /** Quante buste paga spiega lo stesso flusso (per confronto con i bonifici contati dalla banca). */
  buste_nel_flusso: number
}

export type StipendiResult = {
  /** Una riga per busta paga pagata nel periodo (abbinata a un flusso) o del periodo ma non abbinata. */
  rows: StipendioRow[]
  /** Flussi del periodo senza buste che li spieghino (o spiegati solo in parte). */
  flussi_non_abbinati: Array<{ flusso: PnFlusso; info: FlussoInfo }>
  totale_netti_abbinati: number
  totale_bonifici: number
  totale_commissioni: number
  n_flussi: number
  n_buste_abbinate: number
  n_buste_non_abbinate: number
}

/**
 * Abbina le disposizioni di emolumenti del periodo alle buste paga.
 * @param flussi movimenti del periodo classificati «stipendi»
 * @param slips buste paga dei mesi candidati (mese prima e mese del pagamento), tipo normale e non
 */
export function abbinaStipendi(flussi: PnFlusso[], slips: PnSlip[]): StipendiResult {
  const used = new Set<string>()
  const rows: StipendioRow[] = []
  const flussi_non_abbinati: StipendiResult['flussi_non_abbinati'] = []
  let totale_netti_abbinati = 0
  let totale_bonifici = 0
  let totale_commissioni = 0

  const ordered = [...flussi].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || b.amount - a.amount)
  for (const f of ordered) {
    const info = parseFlusso(f.description)
    const target = info.importo_bonifici ?? r2(-f.amount)
    totale_bonifici += info.importo_bonifici ?? r2(-f.amount)
    totale_commissioni += info.commissioni ?? 0
    const cands = competenzeCandidate(f.transaction_date)
    let match: PnSlip[] | null = null
    for (const c of cands) {
      const pool = slips.filter(s => !used.has(s.id) && s.year === c.year && s.month === c.month)
      const byOutlet = new Map<string, PnSlip[]>()
      for (const s of pool) {
        const k = s.outlet_code ?? '?'
        byOutlet.set(k, [...(byOutlet.get(k) ?? []), s])
      }
      for (const group of byOutlet.values()) {
        match = subsetSum(group, target)
        if (match) break
      }
      if (!match) match = subsetSum(pool, target)
      if (match) break
    }
    if (match) {
      for (const s of match) { used.add(s.id); rows.push({ slip: s, flusso: f, info, buste_nel_flusso: match.length }); totale_netti_abbinati += Number(s.netto) || 0 }
    } else {
      flussi_non_abbinati.push({ flusso: f, info })
    }
  }
  // Buste dei mesi candidati rimaste senza pagamento nel periodo: si mostrano solo
  // quelle del mese prima del primo flusso (le altre sono di competenza futura)
  const firstMonth = ordered[0] ? competenzeCandidate(ordered[0].transaction_date)[0] : null
  const orfane = firstMonth ? slips.filter(s => !used.has(s.id) && s.year === firstMonth.year && s.month === firstMonth.month) : []
  for (const s of orfane) rows.push({ slip: s, flusso: null, info: null, buste_nel_flusso: 0 })

  rows.sort((a, b) => {
    const oa = a.slip.outlet_code ?? '', ob = b.slip.outlet_code ?? ''
    return oa.localeCompare(ob, 'it') || nomeDipendente(a.slip).localeCompare(nomeDipendente(b.slip), 'it')
  })
  return {
    rows, flussi_non_abbinati,
    totale_netti_abbinati: r2(totale_netti_abbinati), totale_bonifici: r2(totale_bonifici), totale_commissioni: r2(totale_commissioni),
    n_flussi: flussi.length, n_buste_abbinate: rows.filter(r => r.flusso).length, n_buste_non_abbinate: orfane.length,
  }
}

export type StipendioExportRow = {
  Dipendente: string
  Outlet: string
  Competenza: string
  Netto: number | ''
  'Pagato il': string
  'Conto Banca': string
  'Disposizione (ID flusso)': string
  /** Bonifici contati dalla banca nella causale (NUM. TOT. PAGAMENTI): possono essere piu' delle buste se un netto e' pagato in piu' bonifici. */
  'Bonifici nel flusso (banca)': number | ''
  'Buste nel flusso': number | ''
  'Importo flusso': number | ''
  'Commissioni flusso': number | ''
  /** Importo che la banca addebita per la disposizione (bonifici + commissioni): e' la cifra da cercare sull'estratto conto per assegnare la distinta a quel gruppo di dipendenti. */
  'Addebito in banca': number | ''
  Esito: string
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
export const competenzaLabel = (s: { year: number; month: number }): string => `${MESI[s.month - 1] ?? s.month} ${s.year}`

/**
 * Esito leggibile. Se la banca conta piu' bonifici delle buste spiegate dal
 * flusso (Gallo: 1 busta da 10.959,00, 4 bonifici e 5,00 di commissioni), il
 * netto e' stato versato in piu' bonifici: lo si dice, non lo si nasconde.
 */
export function esitoStipendio(r: StipendioRow): string {
  if (!r.flusso) return 'nessun pagamento trovato nel periodo'
  const n = r.info?.n_pagamenti
  if (n != null && n !== r.buste_nel_flusso) {
    return n > r.buste_nel_flusso
      ? `abbinata alla disposizione (${n} bonifici in banca per ${r.buste_nel_flusso} ${r.buste_nel_flusso === 1 ? 'busta' : 'buste'}: netto pagato in più bonifici)`
      : `abbinata alla disposizione (${n} bonifici in banca per ${r.buste_nel_flusso} buste: un bonifico copre più buste)`
  }
  return 'abbinata alla disposizione'
}

export function buildStipendioRow(r: StipendioRow, bankName: (id: string | null) => string, fmtDate: (d: string) => string): StipendioExportRow {
  return {
    Dipendente: nomeDipendente(r.slip),
    Outlet: r.slip.outlet_code ?? '',
    Competenza: competenzaLabel(r.slip),
    Netto: r.slip.netto == null ? '' : r2(Number(r.slip.netto)),
    'Pagato il': r.flusso ? fmtDate(r.flusso.transaction_date) : '',
    'Conto Banca': r.flusso ? bankName(r.flusso.bank_account_id) : '',
    'Disposizione (ID flusso)': r.info?.id_flusso ?? '',
    'Bonifici nel flusso (banca)': r.info?.n_pagamenti ?? '',
    'Buste nel flusso': r.flusso ? r.buste_nel_flusso : '',
    'Importo flusso': r.info?.importo_bonifici ?? (r.flusso ? r2(-r.flusso.amount) : ''),
    'Commissioni flusso': r.info?.commissioni ?? '',
    'Addebito in banca': addebitoBanca(r.flusso, r.info),
    Esito: esitoStipendio(r),
  }
}

/**
 * Addebito unico in banca per la disposizione: l'importo del movimento (che
 * gia' comprende le commissioni), altrimenti bonifici + commissioni letti
 * dalla causale. Monica (Studio Poli) cerca questa cifra sull'estratto conto.
 */
export function addebitoBanca(flusso: { amount: number } | null, info: FlussoInfo | null): number | '' {
  if (flusso) return r2(-flusso.amount)
  if (info?.importo_bonifici != null) return r2(info.importo_bonifici + (info.commissioni ?? 0))
  return ''
}

export const STIPENDI_COLUMN_WIDTHS = [32, 18, 16, 12, 12, 28, 22, 12, 10, 14, 12, 16, 40]
