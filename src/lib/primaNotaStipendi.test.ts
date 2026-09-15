import { describe, it, expect } from 'vitest'
import {
  parseFlusso, competenzeCandidate, abbinaStipendi, buildStipendioRow, nomeDipendente, competenzaLabel,
  type PnFlusso, type PnSlip,
} from './primaNotaStipendi'

// Dati reali NZ (agosto 2026): le disposizioni per emolumenti del 10/08
// pagano i netti di luglio, outlet per outlet. La sede ha due flussi: uno
// per Gallo da solo (10.959,00) e uno per gli altri sei (7.946,36).
const flusso = (id: string, importo: string, n: number, comm: string, amount: number, date = '2026-08-10'): PnFlusso => ({
  id, transaction_date: date, amount, bank_account_id: 'bcc',
  description: `Causale: DISPOSIZ.PER EMOLUMENTI - Descrizione: FILIALE DISPONENTE 2430 ID FLUSSO CBI: ${id} NUM. TOT. PAGAMENTI: ${n} IMPORTO BONIFICI: ${importo} IMPORTO COMMISSIONI: ${comm} ORD.ORIG:`,
})
let seq = 0
const slip = (cognome: string, nome: string, netto: number, outlet: string, month = 7, year = 2026): PnSlip => ({
  id: `s${++seq}`, employee_id: `e${seq}`, year, month, tipo: 'normale', netto, outlet_code: outlet, cognome, nome,
})

const valmontone = [
  slip('CACCIOTTI', 'DANIELA', 1491, 'VALMONTONE'), slip('GERMANI', 'MARIA LETIZIA', 1123, 'VALMONTONE'),
  slip('MELE', 'FRANCESCA', 974, 'VALMONTONE'), slip('NUNZIANTE', 'SILVIA', 1151, 'VALMONTONE'),
  slip('PARIS', 'AURORA', 801, 'VALMONTONE'), slip('TALONE', 'FRANCESCA', 1153, 'VALMONTONE'),
]
const sede = [
  slip('CENI', 'LORENZO', 1476, 'SEDE / MAGAZZINO'), slip('FOCARDI', "NICCOLO'", 913.36, 'SEDE / MAGAZZINO'),
  slip('GALLO', 'MASSIMO', 10959, 'SEDE / MAGAZZINO'), slip('ROSSETI', 'VERONICA', 2476, 'SEDE / MAGAZZINO'),
  slip('SCANU', 'SABRINA', 892, 'SEDE / MAGAZZINO'), slip('SCANU', 'DENISE', 1046, 'SEDE / MAGAZZINO'),
  slip('SESTINI', 'MATTIA', 1143, 'SEDE / MAGAZZINO'),
]
const brugnato = [
  slip('BURATTA', 'SARA', 1653, 'BRUGNATO'), slip('FALCHI', 'MARTINA', 509, 'BRUGNATO'),
  slip('KACORRI', 'GJULJANA', 1856, 'BRUGNATO'), slip('ROSSINI', 'SERENA', 1339, 'BRUGNATO'),
]

describe('parseFlusso', () => {
  it('legge id flusso, numero pagamenti, importo bonifici e commissioni (numeri italiani)', () => {
    const f = parseFlusso('Causale: DISPOSIZ.PER EMOLUMENTI - Descrizione: FILIALE DISPONENTE 2430 ID FLUSSO CBI: 136472521 NUM. TOT. PAGAMENTI: 6 IMPORTO BONIFICI: 6.693,00 IMPORTO COMMISSIONI: 10,50 ORD.ORIG:')
    expect(f).toEqual({ id_flusso: '136472521', n_pagamenti: 6, importo_bonifici: 6693, commissioni: 10.5 })
  })
  it('importi sopra i diecimila con il punto delle migliaia', () => {
    expect(parseFlusso('ID FLUSSO CBI: 1 NUM. TOT. PAGAMENTI: 4 IMPORTO BONIFICI: 10.959,00 IMPORTO COMMISSIONI: 5,00').importo_bonifici).toBe(10959)
  })
  it('causale senza il blocco CBI: tutto null', () => {
    expect(parseFlusso('BONIFICO STIPENDIO ROSSI')).toEqual({ id_flusso: null, n_pagamenti: null, importo_bonifici: null, commissioni: null })
    expect(parseFlusso(null)).toEqual({ id_flusso: null, n_pagamenti: null, importo_bonifici: null, commissioni: null })
  })
})

describe('competenzeCandidate', () => {
  it('mese prima e stesso mese, con il cambio d\'anno', () => {
    expect(competenzeCandidate('2026-08-10')).toEqual([{ year: 2026, month: 7 }, { year: 2026, month: 8 }])
    expect(competenzeCandidate('2027-01-11')).toEqual([{ year: 2026, month: 12 }, { year: 2027, month: 1 }])
  })
})

describe('abbinaStipendi', () => {
  it('un flusso per outlet: tutte le buste del gruppo abbinate, netti = bonifici', () => {
    const res = abbinaStipendi([flusso('136472521', '6.693,00', 6, '10,50', -6703.5)], valmontone)
    expect(res.n_flussi).toBe(1)
    expect(res.n_buste_abbinate).toBe(6)
    expect(res.n_buste_non_abbinate).toBe(0)
    expect(res.flussi_non_abbinati).toEqual([])
    expect(res.totale_netti_abbinati).toBe(6693)
    expect(res.totale_bonifici).toBe(6693)
    expect(res.totale_commissioni).toBe(10.5)
    expect(res.rows.every(r => r.flusso?.id === '136472521' && r.info?.id_flusso === '136472521')).toBe(true)
  })

  it('sede in due flussi: uno per Gallo da solo, uno per gli altri sei', () => {
    const res = abbinaStipendi([
      flusso('136498058', '10.959,00', 4, '5,00', -10964),
      flusso('136470208', '7.946,36', 6, '10,50', -7956.86),
    ], sede)
    expect(res.n_buste_abbinate).toBe(7)
    expect(res.flussi_non_abbinati).toEqual([])
    const gallo = res.rows.find(r => r.slip.cognome === 'GALLO')
    expect(gallo?.flusso?.id).toBe('136498058')
    const altri = res.rows.filter(r => r.slip.cognome !== 'GALLO')
    expect(altri).toHaveLength(6)
    expect(altri.every(r => r.flusso?.id === '136470208')).toBe(true)
    expect(res.totale_netti_abbinati).toBe(18905.36)
    expect(res.totale_bonifici).toBe(18905.36)
    expect(res.totale_commissioni).toBe(15.5)
  })

  it('più outlet insieme: ogni flusso prende il proprio gruppo, anche con importi vicini', () => {
    const res = abbinaStipendi([
      flusso('A', '6.693,00', 6, '10,50', -6703.5),
      flusso('B', '5.357,00', 4, '5,00', -5362),
    ], [...brugnato, ...valmontone])
    expect(res.rows.filter(r => r.flusso?.id === 'A').map(r => r.slip.outlet_code)).toEqual(Array(6).fill('VALMONTONE'))
    expect(res.rows.filter(r => r.flusso?.id === 'B').map(r => r.slip.outlet_code)).toEqual(Array(4).fill('BRUGNATO'))
  })

  it('flusso senza buste che lo spieghino resta in evidenza, le buste del mese prima senza pagamento pure', () => {
    const res = abbinaStipendi([flusso('X', '1.000,00', 1, '1,75', -1001.75)], brugnato)
    expect(res.flussi_non_abbinati.map(x => x.flusso.id)).toEqual(['X'])
    expect(res.n_buste_abbinate).toBe(0)
    expect(res.n_buste_non_abbinate).toBe(4)
    expect(res.rows.every(r => r.flusso === null)).toBe(true)
    expect(res.totale_bonifici).toBe(1000)
  })

  it('senza causale CBI usa l\'importo del movimento come target', () => {
    const f: PnFlusso = { id: 'M', transaction_date: '2026-08-10', amount: -5357, description: 'BONIFICO STIPENDI AGOSTO', bank_account_id: 'bcc' }
    const res = abbinaStipendi([f], brugnato)
    expect(res.n_buste_abbinate).toBe(4)
    expect(res.totale_bonifici).toBe(5357)
    expect(res.totale_commissioni).toBe(0)
  })

  it('buste dello stesso mese del pagamento (anticipo) si abbinano se il mese prima non spiega', () => {
    const agosto = [slip('ROSSI', 'MARIO', 1200, 'TORINO', 8), slip('BIANCHI', 'ANNA', 800, 'TORINO', 8)]
    const res = abbinaStipendi([flusso('S', '2.000,00', 2, '3,50', -2003.5)], agosto)
    expect(res.n_buste_abbinate).toBe(2)
    expect(res.n_buste_non_abbinate).toBe(0)
  })

  it('righe ordinate per outlet e cognome', () => {
    const res = abbinaStipendi([flusso('A', '6.693,00', 6, '10,50', -6703.5), flusso('B', '5.357,00', 4, '5,00', -5362)], [...valmontone, ...brugnato])
    expect(res.rows.map(r => `${r.slip.outlet_code}/${r.slip.cognome}`)).toEqual([
      'BRUGNATO/BURATTA', 'BRUGNATO/FALCHI', 'BRUGNATO/KACORRI', 'BRUGNATO/ROSSINI',
      'VALMONTONE/CACCIOTTI', 'VALMONTONE/GERMANI', 'VALMONTONE/MELE', 'VALMONTONE/NUNZIANTE', 'VALMONTONE/PARIS', 'VALMONTONE/TALONE',
    ])
  })
})

describe('buildStipendioRow', () => {
  const fmtDate = (d: string) => d.split('-').reverse().join('/')
  const bankName = (id: string | null) => (id === 'bcc' ? 'BCC Figline' : '—')
  it('riga abbinata: nome, outlet, competenza, netto e il collegamento alla disposizione', () => {
    const res = abbinaStipendi([flusso('136472521', '6.693,00', 6, '10,50', -6703.5)], valmontone)
    const r = buildStipendioRow(res.rows[0], bankName, fmtDate)
    expect(r).toEqual({
      Dipendente: 'CACCIOTTI DANIELA', Outlet: 'VALMONTONE', Competenza: 'luglio 2026', Netto: 1491,
      'Pagato il': '10/08/2026', 'Conto Banca': 'BCC Figline', 'Disposizione (ID flusso)': '136472521',
      'Bonifici nel flusso (banca)': 6, 'Buste nel flusso': 6, 'Importo flusso': 6693, 'Commissioni flusso': 10.5, Esito: 'abbinata alla disposizione',
    })
  })
  it('riga senza pagamento: campi del flusso vuoti', () => {
    const r = buildStipendioRow({ slip: slip('VERDI', 'LUCA', 1000, 'TORINO'), flusso: null, info: null, buste_nel_flusso: 0 }, bankName, fmtDate)
    expect(r['Pagato il']).toBe('')
    expect(r['Disposizione (ID flusso)']).toBe('')
    expect(r['Importo flusso']).toBe('')
    expect(r.Esito).toBe('nessun pagamento trovato nel periodo')
  })
  it('Gallo: 1 busta da 10.959,00 pagata con 4 bonifici (la banca ne conta 4, 5,00 di commissioni)', () => {
    const res = abbinaStipendi([flusso('136498058', '10.959,00', 4, '5,00', -10964)], sede)
    const gallo = res.rows.find(r => r.slip.cognome === 'GALLO')!
    expect(gallo.buste_nel_flusso).toBe(1)
    const r = buildStipendioRow(gallo, bankName, fmtDate)
    expect(r['Bonifici nel flusso (banca)']).toBe(4)
    expect(r['Buste nel flusso']).toBe(1)
    expect(r.Esito).toBe('abbinata alla disposizione (4 bonifici in banca per 1 busta: netto pagato in più bonifici)')
  })
  it('nome e competenza', () => {
    expect(nomeDipendente({ ...slip('ROSSI', 'MARIO', 1, 'X'), nome: null })).toBe('ROSSI')
    expect(nomeDipendente({ ...slip('', '', 1, 'X'), cognome: null, nome: null })).toBe('—')
    expect(competenzaLabel({ year: 2026, month: 12 })).toBe('dicembre 2026')
  })
})
