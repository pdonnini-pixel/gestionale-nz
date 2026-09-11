import { describe, it, expect } from 'vitest'
import {
  buildLiquidazioni, dueDateLiquidazione, f24CodeIvaMensile, parseTaxPeriod, taxPeriod, titoloScadenzaIva,
  leggiScadenzeIva, monthKey,
  type IvaComponentiMese, type IvaSettings, type IvaMeseConfermato,
} from './ivaLiquidazione'

// Numeri reali NZ agosto/settembre 2026 (vista v_iva_componenti_mensili, 7/9/2026).
function comp(year: number, month: number, over: Partial<IvaComponentiMese> = {}): IvaComponentiMese {
  return {
    year, month,
    chiusure_netto: 0, giorni_chiusura: 0, consuntivo_netto: 0, preventivo_netto: 0,
    iva_fatture_attive: 0, n_fatture_attive: 0, iva_fatture_passive: 0, iva_note_credito: 0,
    iva_integrazioni: 0, n_fatture_passive: 0, n_note_credito: 0, n_integrazioni: 0,
    ...over,
  }
}

const settings: IvaSettings = { salesVatRate: 22, startYear: 2026, startMonth: 8, openingCredit: 0 }
const today = new Date(2026, 8, 7) // 7 settembre 2026

const componenti: IvaComponentiMese[] = [
  comp(2026, 6, { consuntivo_netto: 319081, preventivo_netto: 315227, iva_fatture_passive: 31000, n_fatture_passive: 150 }),
  comp(2026, 7, { consuntivo_netto: 465330, preventivo_netto: 430323, iva_fatture_attive: 942, iva_fatture_passive: 68000, iva_note_credito: 870, n_fatture_passive: 180 }),
  comp(2026, 8, { preventivo_netto: 360652, iva_fatture_attive: 93.51, iva_fatture_passive: 42056.16, iva_note_credito: 651.83, iva_integrazioni: 444.25, n_fatture_passive: 97, n_note_credito: 10, n_integrazioni: 7 }),
  comp(2026, 9, { preventivo_netto: 278685, iva_fatture_passive: 25745.76, iva_note_credito: 7.70, n_fatture_passive: 68, chiusure_netto: 40000, giorni_chiusura: 4 }),
  comp(2026, 10, { preventivo_netto: 340160 }),
]

describe('dueDateLiquidazione', () => {
  it('16 del mese successivo', () => {
    expect(dueDateLiquidazione(2026, 8)).toBe('2026-09-16') // mercoledì
  })
  it('proroga di Ferragosto: la liquidazione di luglio scade il 20 agosto', () => {
    expect(dueDateLiquidazione(2026, 7)).toBe('2026-08-20')
  })
  it('sabato/domenica → lunedì', () => {
    expect(dueDateLiquidazione(2026, 4)).toBe('2026-05-18') // 16/5/2026 è sabato
    expect(dueDateLiquidazione(2027, 9)).toBe('2027-10-18') // 16/10/2027 è sabato
  })
  it('dicembre → 16 gennaio dell anno dopo', () => {
    expect(dueDateLiquidazione(2026, 12)).toBe('2027-01-18') // 16/1/2027 è sabato
  })
})

describe('helper periodo / codici', () => {
  it('codice tributo e periodo', () => {
    expect(f24CodeIvaMensile(8)).toBe('6008')
    expect(taxPeriod(2026, 8)).toBe('08/2026')
    expect(parseTaxPeriod('08/2026')).toEqual({ year: 2026, month: 8 })
    expect(parseTaxPeriod('2026-08')).toBeNull()
    expect(titoloScadenzaIva(2026, 8)).toBe('IVA mensile Agosto 2026')
  })
})

describe('buildLiquidazioni', () => {
  it('parte dal mese di partenza e arriva al mese richiesto', () => {
    const rows = buildLiquidazioni({ componenti, settings, toYear: 2026, toMonth: 10, today })
    expect(rows.map(r => r.key)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('agosto (passato, senza chiusure né consuntivo): preventivo × 22% + attive − credito ricevuto', () => {
    const [ago] = buildLiquidazioni({ componenti, settings, toYear: 2026, toMonth: 8, today })
    expect(ago.fonteCorrispettivi).toBe('preventivo')
    expect(ago.ivaDebitoCorrispettivi).toBe(79343.44)
    expect(ago.ivaCredito).toBe(41404.33) // 42056.16 − 651.83, integrazioni escluse
    expect(ago.riportoPrecedente).toBe(0)
    expect(ago.importo).toBe(38032.62) // 79343.44 + 93.51 − 41404.33
    expect(ago.stato).toBe('stima')
    expect(ago.dueDate).toBe('2026-09-16')
    expect(ago.f24Code).toBe('6008')
  })

  it('settembre (in corso): chiusure fino a oggi + preventivo pro-rata; credito mai sotto la media recente', () => {
    const rows = buildLiquidazioni({ componenti, settings, toYear: 2026, toMonth: 9, today })
    const set = rows[1]
    expect(set.fonteCorrispettivi).toBe('chiusure_parziali')
    // 40000 + 278685 × (30 − 7) / 30
    expect(set.corrispettiviNetti).toBe(253658.5)
    expect(set.stato).toBe('in_corso')
    // media dei mesi chiusi con fatture DAL MESE DI PARTENZA (solo agosto: 41404.33) > ricevuto finora 25738.06
    expect(set.ivaCredito).toBe(41404.33)
    expect(set.ivaCreditoStimato).toBe(true)
  })

  it('ottobre (futuro): preventivo e credito medio, stato previsione', () => {
    const rows = buildLiquidazioni({ componenti, settings, toYear: 2026, toMonth: 10, today })
    const ott = rows[2]
    expect(ott.stato).toBe('futura')
    expect(ott.fonteCorrispettivi).toBe('preventivo')
    expect(ott.ivaCredito).toBe(41404.33)
    expect(ott.ivaCreditoStimato).toBe(true)
  })

  it('il credito di un mese diventa riporto del mese dopo', () => {
    const rows = buildLiquidazioni({
      componenti: [comp(2026, 8, { preventivo_netto: 100000, iva_fatture_passive: 30000, n_fatture_passive: 10 }), comp(2026, 9, { preventivo_netto: 100000 })],
      settings, toYear: 2026, toMonth: 9, today,
    })
    expect(rows[0].importo).toBe(-8000) // 22000 − 30000
    expect(rows[1].riportoPrecedente).toBe(8000)
    expect(rows[1].importo).toBe(22000 - 30000 - 8000) // credito medio = 30000 (unico mese chiuso con fatture)
  })

  it('credito iniziale nelle impostazioni = riporto del primo mese', () => {
    const rows = buildLiquidazioni({ componenti, settings: { ...settings, openingCredit: 5000 }, toYear: 2026, toMonth: 8, today })
    expect(rows[0].riportoPrecedente).toBe(5000)
    expect(rows[0].importo).toBe(33032.62)
  })

  it('un mese confermato sostituisce la stima e alimenta la catena', () => {
    const rows = buildLiquidazioni({
      componenti, settings, toYear: 2026, toMonth: 9, today,
      confermati: [{ year: 2026, month: 8, corrispettivi_netti: 350000, iva_debito_corrispettivi: 77000, iva_debito_fatture_attive: 93.51, iva_credito: 90000, note: 'dal commercialista' }],
    })
    expect(rows[0].stato).toBe('confermata')
    expect(rows[0].fonteCorrispettivi).toBe('confermata')
    expect(rows[0].importo).toBe(-12906.49)
    expect(rows[0].note).toBe('dal commercialista')
    expect(rows[1].riportoPrecedente).toBe(12906.49)
  })

  it('un mese pagato usa l importo versato come risultato', () => {
    const rows = buildLiquidazioni({
      componenti, settings, toYear: 2026, toMonth: 9, today,
      pagati: [{ year: 2026, month: 8, amount: 38500 }],
    })
    expect(rows[0].stato).toBe('pagata')
    expect(rows[0].importo).toBe(38500)
    expect(rows[1].riportoPrecedente).toBe(0)
  })

  it('mese passato con chiusure di cassa: le chiusure vincono sul consuntivo', () => {
    const rows = buildLiquidazioni({
      componenti: [comp(2026, 8, { chiusure_netto: 300000, giorni_chiusura: 31, consuntivo_netto: 350000, preventivo_netto: 360652 })],
      settings, toYear: 2026, toMonth: 8, today,
    })
    expect(rows[0].fonteCorrispettivi).toBe('chiusure')
    expect(rows[0].ivaDebitoCorrispettivi).toBe(66000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTO DEFINITIVO SCRITTO A MANO
// ─────────────────────────────────────────────────────────────────────────────

describe('importo scritto a mano su un mese confermato', () => {
  const settings: IvaSettings = {
    salesVatRate: 22, periodicity: 'mensile',
    startYear: 2026, startMonth: 8, openingCredit: 0,
  }
  const componenti: IvaComponentiMese[] = [{
    year: 2026, month: 8,
    chiusure_netto: 0, chiusure_lordo: 0, giorni_chiusura: 0, outlet_chiusura: 0,
    consuntivo_netto: 364_015.83, preventivo_netto: 360_652,
    iva_fatture_attive: 93.51, n_fatture_attive: 4,
    iva_fatture_passive: 42_056.16, iva_note_credito: 651.83,
    iva_integrazioni: 0, n_fatture_passive: 97, n_note_credito: 0, n_integrazioni: 0,
  }]
  const base = {
    year: 2026, month: 8,
    corrispettivi_netti: 364_015.83,
    iva_debito_corrispettivi: 80_083.48,
    iva_debito_fatture_attive: 93.51,
    iva_credito: 41_404.33,
  }
  const oggi = new Date('2026-09-11T12:00:00')

  const riga = (confermato: IvaMeseConfermato) => buildLiquidazioni({
    componenti, settings, confermati: [confermato], pagati: [],
    toYear: 2026, toMonth: 8, today: oggi,
  })[0]

  it('senza importo a mano il totale resta quello della formula', () => {
    const r = riga({ ...base })
    expect(r.importo).toBe(38_772.66)
    expect(r.importoManuale).toBe(false)
  })

  it('con importo a mano vince il numero del commercialista', () => {
    const r = riga({ ...base, importo: 38_500, importo_manuale: true })
    expect(r.importo).toBe(38_500)
    expect(r.importoManuale).toBe(true)
  })

  it('i componenti restano leggibili accanto al totale forzato', () => {
    const r = riga({ ...base, importo: 38_500, importo_manuale: true })
    expect(r.corrispettiviNetti).toBe(364_015.83)
    expect(r.ivaCredito).toBe(41_404.33)
    expect(r.stato).toBe('confermata')
  })

  it('un importo a mano a credito resta negativo e si riporta al mese dopo', () => {
    const r = riga({ ...base, importo: -1_200, importo_manuale: true })
    expect(r.importo).toBe(-1_200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SCADENZE IVA GIÀ REGISTRATE (niente doppi conteggi)
// ─────────────────────────────────────────────────────────────────────────────

describe('leggiScadenzeIva', () => {
  it('legge il periodo nel formato MM/YYYY con cui viene scritto', () => {
    // Riga vera NZ: «IVA mensile Agosto 2026», tax_period 08/2026, 38.772,66
    const r = leggiScadenzeIva([{ tax_period: '08/2026', amount: 38_772.66, status: 'pending' }])
    expect(r.giaAScadenzario.has('2026-08')).toBe(true)
    expect(r.pagati).toHaveLength(0)
  })

  it('la chiave combacia con quella delle righe di liquidazione', () => {
    const r = leggiScadenzeIva([{ tax_period: '08/2026', amount: 1, status: 'pending' }])
    expect(r.giaAScadenzario.has(monthKey(2026, 8))).toBe(true)
  })

  it('un mese pagato entra fra i pagati e non fra quelli a scadenzario', () => {
    const r = leggiScadenzeIva([{ tax_period: '07/2026', amount: 39_063.80, status: 'paid' }])
    expect(r.pagati).toEqual([{ year: 2026, month: 7, amount: 39_063.80 }])
    expect(r.giaAScadenzario.size).toBe(0)
  })

  it('gli stati diversi da pending e paid non contano', () => {
    const r = leggiScadenzeIva([{ tax_period: '04/2026', amount: 0, status: 'cancelled' }])
    expect(r.pagati).toHaveLength(0)
    expect(r.giaAScadenzario.size).toBe(0)
  })

  it('un periodo scritto male o mancante viene ignorato senza rompere', () => {
    const r = leggiScadenzeIva([
      { tax_period: '2026-08', amount: 10, status: 'pending' },
      { tax_period: null, amount: 10, status: 'pending' },
      { tax_period: '13/2026', amount: 10, status: 'pending' },
    ])
    expect(r.giaAScadenzario.size).toBe(0)
  })

  it('mette insieme più mesi senza confonderli', () => {
    const r = leggiScadenzeIva([
      { tax_period: '06/2026', amount: 28_611.96, status: 'paid' },
      { tax_period: '07/2026', amount: 39_063.80, status: 'paid' },
      { tax_period: '08/2026', amount: 38_772.66, status: 'pending' },
    ])
    expect(r.pagati.map(p => p.month)).toEqual([6, 7])
    expect([...r.giaAScadenzario]).toEqual(['2026-08'])
  })
})
