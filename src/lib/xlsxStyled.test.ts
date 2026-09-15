import { describe, it, expect } from 'vitest'
import { Workbook } from 'exceljs'
import { addStyledSheet, firstTableRange, moneyColumns, tableRows, EURO_FMT, type StyledRow } from './xlsxStyled'

const rows: StyledRow[] = [
  { kind: 'title', cells: ['Estratto conto BCC'] },
  { kind: 'meta', cells: ['IBAN', 'IT00X'] },
  { kind: 'blank', cells: [] },
  { kind: 'header', cells: ['Data', 'Tipo movimento', 'Causale', 'Entrate', 'Uscite', 'Saldo'] },
  { kind: 'open', cells: ['Saldo iniziale', 'banca', '', '', '', 1000] },
  { kind: 'data_riba', cells: ['07/09/2026', 'Pagamento fornitore (RiBa)', 'RiBa · Fatt. 92; 119', '', 5866.19, -4866.19] },
  { kind: 'sub_riba', cells: ['', '↳ di cui fattura RiBa', 'Fatt. 92 · RiBa', '', '', ''] },
  { kind: 'subtotal', cells: ['', '↳ totale fatture', '2 fatture', '', '', ''] },
  { kind: 'data', cells: ['09/09/2026', 'Versamento contanti', 'cassa', 2110, '', -2756.19] },
  { kind: 'close', cells: ['Saldo finale', '2 movimenti', '', 2110, 5866.19, -2756.19] },
  { kind: 'ok', cells: ['Differenza', 'quadra', '', '', '', 0] },
]

async function roundTrip(spec: Parameters<typeof addStyledSheet>[1]): Promise<Workbook> {
  const wb = new Workbook()
  addStyledSheet(wb, spec)
  const buf = await wb.xlsx.writeBuffer()
  const back = new Workbook()
  await back.xlsx.load(buf as unknown as Buffer)
  return back
}

describe('firstTableRange / moneyColumns', () => {
  it('trova la prima tabella (dalla riga header all\'ultima riga tabellare) e le colonne di denaro', () => {
    expect(firstTableRange(rows)).toEqual({ header: 4, last: 11, cols: 6 })
    expect([...moneyColumns(rows, ['Entrate', 'Uscite', 'Saldo'])]).toEqual([4, 5, 6])
    expect(firstTableRange([{ kind: 'text', cells: ['x'] }])).toBeNull()
  })
})

describe('addStyledSheet: grafica letta dal file generato', () => {
  it('intestazione in neretto bianco su blu, riga bloccata, filtro, saldi in grigio, RiBa in ambra, esito verde, importi in euro', async () => {
    const back = await roundTrip({ name: 'BCC', rows, widths: [14, 26, 40, 14, 14, 14], moneyHeaders: ['Entrate', 'Uscite', 'Saldo'] })
    const ws = back.getWorksheet('BCC')!
    const header = ws.getRow(4)
    expect(header.getCell(1).font?.bold).toBe(true)
    expect(header.getCell(1).font?.color?.argb).toBe('FFFFFFFF')
    expect((header.getCell(1).fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FF1F3864')
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 })
    expect(ws.autoFilter).toBe('A4:F11')
    expect(ws.getRow(5).getCell(1).font?.bold).toBe(true)
    expect((ws.getRow(5).getCell(1).fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FFE7E6E6')
    expect((ws.getRow(6).getCell(2).fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FFFFF2CC')
    expect(ws.getRow(7).getCell(2).font?.italic).toBe(true)
    expect((ws.getRow(7).getCell(2).fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FFFFF2CC')
    expect((ws.getRow(11).getCell(1).fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FFE2EFDA')
    expect(ws.getRow(6).getCell(5).numFmt).toBe(EURO_FMT)
    expect(ws.getRow(6).getCell(5).value).toBe(5866.19)
    expect(ws.getRow(5).getCell(6).numFmt).toBe(EURO_FMT)
    expect(ws.getRow(6).getCell(3).numFmt ?? '').toBe('')
    expect(ws.getColumn(3).width).toBe(40)
  })
  it('first: true mette il foglio in testa al file anche se aggiunto per ultimo', async () => {
    const wb = new Workbook()
    addStyledSheet(wb, { name: 'Conto', rows, widths: [10] })
    addStyledSheet(wb, { name: 'Guida', rows: [{ kind: 'title', cells: ['Guida'] }], widths: [10], filter: false, first: true })
    const buf = await wb.xlsx.writeBuffer()
    const back = new Workbook()
    await back.xlsx.load(buf as unknown as Buffer)
    expect(back.worksheets.map(w => w.name)).toEqual(['Guida', 'Conto'])
  })
  it('tableRows: intestazione dalle chiavi, tipo riga a scelta', () => {
    const t = tableRows([{ Outlet: 'PLM', Importo: 10 }, { Outlet: '', Importo: 5 }], r => (r.Outlet ? 'data' : 'warn'))
    expect(t[0]).toEqual({ kind: 'header', cells: ['Outlet', 'Importo'] })
    expect(t[1].kind).toBe('data')
    expect(t[2]).toEqual({ kind: 'warn', cells: ['', 5] })
    expect(tableRows([])).toEqual([])
  })
})
