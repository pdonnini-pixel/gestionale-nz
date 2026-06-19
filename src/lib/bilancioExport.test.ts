import { describe, it, expect } from 'vitest'
import {
  buildSheets,
  buildMonthlySheets,
  scostamento,
  scostamentoPct,
  fmtEuroIt,
  type BudgetEntryLite,
  type MonthlyMap,
  type CoaNode,
} from './bilancioExport'

// Piano dei conti minimale, già ordinato per sort_order (come ceRaw*).
const coaCosti: CoaNode[] = [
  { code: '61', description: 'Costi della produzione', level: 1 },
  { code: '6101', description: 'Acquisti merci', level: 2 },
  { code: '610101', description: 'Merci A', level: 3 },
  { code: '63', description: 'Per servizi', level: 1 },
  { code: '630101', description: 'Utenze', level: 3 },
  { code: '69', description: 'Ammortamenti immateriali', level: 1 }, // resta a 0
]
const coaRicavi: CoaNode[] = [
  { code: '51', description: 'Valore della produzione', level: 1 },
  { code: '510107', description: 'Corrispettivi Valdichiana', level: 3 },
  { code: '510108', description: 'Corrispettivi Barberino', level: 3 },
  { code: '59', description: 'Altri ricavi e proventi', level: 1 }, // resta a 0
]

const budgetEntries: BudgetEntryLite[] = [
  // valdichiana costi (genn=100, febb=50) → annuale 150, Q1=150
  { cost_center: 'valdichiana', account_code: '610101', budget_amount: 100, actual_amount: 0, month: 1 },
  { cost_center: 'valdichiana', account_code: '610101', budget_amount: 50, actual_amount: 0, month: 2 },
  { cost_center: 'valdichiana', account_code: '630101', budget_amount: 30, actual_amount: 0, month: 6 }, // fuori da Q1
  // sede costi
  { cost_center: 'sede_magazzino', account_code: '630101', budget_amount: 200, actual_amount: 0, month: 1 },
  // placeholder bucket 'all' → DEVE essere escluso
  { cost_center: 'all', account_code: '610101', budget_amount: 99999, actual_amount: 0, month: 1, is_placeholder: true },
  // rettifica_bilancio → escluso
  { cost_center: 'rettifica_bilancio', account_code: '610101', budget_amount: 7777, actual_amount: 0, month: 1 },
]

const revMonthly: MonthlyMap = {
  valdichiana: { '510107': [10, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, // annuale 30, Q1 30
  barberino: { '510108': [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5] },     // annuale 10, Q1 5
}
const consMonthly: MonthlyMap = {
  valdichiana: { '510107': [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
}

const outlets = [
  { code: 'valdichiana', label: 'Valdichiana' },
  { code: 'barberino', label: 'Barberino' },
]
const hq = { code: 'sede_magazzino', label: 'Sede / Magazzino' }

describe('buildSheets', () => {
  it('Totale azienda include la Sede ed esclude placeholder/rettifica', () => {
    const sheets = buildSheets({
      selection: '__all__', operativeOutlets: outlets, hq,
      fromMonth: 1, toMonth: 12, budgetEntries, revMonthly, consMonthly, coaCosti, coaRicavi,
    })
    // ordine: Totale, valdichiana, barberino, sede
    expect(sheets.map((s) => s.title)).toEqual(['Totale azienda', 'Valdichiana', 'Barberino', 'Sede / Magazzino'])
    const tot = sheets[0]
    // costi: valdichiana 150+30 + sede 200 = 380 (placeholder 99999 e rettifica 7777 esclusi)
    expect(tot.costi.totalPrev).toBe(380)
    expect(tot.costi.totalCons).toBe(0)
    // ricavi: 30 + 10 = 40 prev ; cons 4
    expect(tot.ricavi.totalPrev).toBe(40)
    expect(tot.ricavi.totalCons).toBe(4)
  })

  it('macro tutte presenti anche a 0 e roll-up corretto', () => {
    const [tot] = buildSheets({
      selection: '__all__', operativeOutlets: outlets, hq,
      fromMonth: 1, toMonth: 12, budgetEntries, revMonthly, consMonthly, coaCosti, coaRicavi,
    })
    const macros = tot.costi.rows.filter((r) => r.isMacro).map((r) => r.code)
    expect(macros).toEqual(['61', '63', '69']) // 69 mostrata anche se 0
    const m69 = tot.costi.rows.find((r) => r.code === '69')!
    expect(m69.prev).toBe(0)
    const m61 = tot.costi.rows.find((r) => r.code === '61')!
    expect(m61.prev).toBe(150) // 610101 = 100+50
    // label macro = code + name
    expect(m61.label).toBe('61 Costi della produzione')
  })

  it('filtro periodo Q1 somma solo i mesi in range', () => {
    const [tot] = buildSheets({
      selection: '__all__', operativeOutlets: outlets, hq,
      fromMonth: 1, toMonth: 3, budgetEntries, revMonthly, consMonthly, coaCosti, coaRicavi,
    })
    // 630101 valdichiana (mese 6) escluso → costi = 150 (vald) + 200 (sede) = 350
    expect(tot.costi.totalPrev).toBe(350)
    // ricavi Q1: vald 30 + barberino 5 = 35
    expect(tot.ricavi.totalPrev).toBe(35)
  })

  it('singolo outlet genera un solo foglio', () => {
    const sheets = buildSheets({
      selection: 'valdichiana', operativeOutlets: outlets, hq,
      fromMonth: 1, toMonth: 12, budgetEntries, revMonthly, consMonthly, coaCosti, coaRicavi,
    })
    expect(sheets).toHaveLength(1)
    expect(sheets[0].title).toBe('Valdichiana')
    expect(sheets[0].costi.totalPrev).toBe(180) // 150 + 30
    expect(sheets[0].ricavi.totalPrev).toBe(30)
  })

  it('scostamento e percentuale', () => {
    expect(scostamento(100, 40)).toBe(-60)
    expect(scostamentoPct(100, 40)).toBeCloseTo(-60)
    expect(scostamentoPct(0, 40)).toBeNull()
  })

  it('valuta euro con simbolo €', () => {
    expect(fmtEuroIt(2000)).toBe('2.000,00 €')
    expect(fmtEuroIt(-270187.06)).toBe('-270.187,06 €')
    expect(fmtEuroIt(null)).toBe('—')
  })
})

describe('buildMonthlySheets', () => {
  const args = {
    selection: '__all__', operativeOutlets: outlets, hq,
    fromMonth: 1, toMonth: 12, budgetEntries, revMonthly, consMonthly, coaCosti, coaRicavi,
  }
  it('12 mesi + total, e i mesi sommano al totale', () => {
    const [tot] = buildMonthlySheets(args)
    // costi: valdichiana 610101 gen=100 feb=50, 630101 mese6=30; sede 630101 gen=200
    const c61 = tot.costi.rows.find((r) => r.code === '61')!
    expect(c61.months).toHaveLength(12)
    expect(c61.months[0]).toBe(100) // gennaio: solo 610101 valdichiana
    expect(c61.months[1]).toBe(50)  // febbraio
    expect(c61.total).toBe(150)
    // 630101: sede gen 200 + valdichiana giu 30 sotto macro 63
    const c63 = tot.costi.rows.find((r) => r.code === '63')!
    expect(c63.months[0]).toBe(200) // gennaio (sede)
    expect(c63.months[5]).toBe(30)  // giugno (valdichiana)
    expect(c63.total).toBe(230)
    // ricavi gennaio: vald 510107 gen 10 + barberino 510108 gen 5 = 15
    expect(tot.ricavi.rows.find((r) => r.code === '51')!.months[0]).toBe(15)
    expect(tot.ricavi.total).toBe(40)
    // somma mesi == totale di sezione
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
    expect(sum(tot.costi.totals)).toBe(tot.costi.total)
    expect(sum(tot.ricavi.totals)).toBe(tot.ricavi.total)
  })
})
