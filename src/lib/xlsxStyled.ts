// Fogli Excel con grafica: intestazioni in neretto su fondo blu, righe di saldo
// in grigio, dettaglio fattura in corsivo, RiBa in ambra, esiti verdi o rossi,
// riga di intestazione bloccata e filtro automatico. Costruito su ExcelJS
// (caricata solo al momento dell'export): la SheetJS community non scrive stili.
//
// Chi esporta descrive il foglio come una lista di righe tipizzate (`StyledRow`):
// il tipo dice come va vestita la riga, i valori restano numeri (si sommano in
// Excel). Il formato euro si applica per titolo di colonna, in qualsiasi riga.
import type { Workbook, Worksheet, Fill, Borders, Alignment } from 'exceljs'

export type CellValue = string | number | null | undefined

export type RowKind =
  | 'title'      // titolo del foglio: grande, neretto
  | 'meta'       // etichetta + valore (etichetta in neretto)
  | 'blank'
  | 'header'     // intestazione tabella: neretto bianco su blu; riga bloccata e filtro
  | 'data'       // riga normale
  | 'data_riba'  // movimento che salda fatture a ricevuta bancaria: fondo ambra
  | 'sub'        // dettaglio sotto un movimento (↳ di cui fattura): corsivo grigio
  | 'sub_riba'   // dettaglio di una fattura RiBa: corsivo, fondo ambra
  | 'subtotal'   // ↳ totale fatture: corsivo con bordo sopra
  | 'open'       // saldo iniziale: neretto su grigio chiaro
  | 'close'      // saldo finale: neretto su grigio chiaro
  | 'ok'         // esito positivo (quadra): neretto su verde
  | 'ko'         // esito negativo (NON QUADRA): neretto su rosso
  | 'warn'       // avviso: fondo ambra
  | 'section'    // titolo di sezione dentro il foglio: neretto su azzurro
  | 'text'       // paragrafo di testo a capo automatico (foglio Guida)

export type StyledRow = { kind: RowKind; cells: CellValue[] }

export type SheetSpec = {
  name: string
  rows: StyledRow[]
  /** Larghezza colonne (caratteri). */
  widths: number[]
  /** Titoli delle colonne che contengono denaro: le celle numeriche prendono il formato euro. */
  moneyHeaders?: string[]
  /** Filtro automatico sulla prima tabella (dalla prima riga header all'ultima riga). Default true. */
  filter?: boolean
  /** Colore della linguetta (esadecimale RRGGBB). */
  tabColor?: string
  /** Mette il foglio per primo nel file (la lista dei fogli è ordinata per orderNo). */
  first?: boolean
}

export const EURO_FMT = '#,##0.00 "€"'

const C = {
  headerBg: '1F3864', headerFg: 'FFFFFF',
  grey: 'E7E6E6', greyText: '595959',
  amber: 'FFF2CC', green: 'E2EFDA', red: 'F8CBAD', blue: 'D9E1F2',
  border: 'BFBFBF', title: '1F3864',
} as const

const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + argb } })
const thin = (): Partial<Borders> => {
  const side = { style: 'thin' as const, color: { argb: 'FF' + C.border } }
  return { top: side, left: side, bottom: side, right: side }
}

const TABLE_KINDS = new Set<RowKind>(['header', 'data', 'data_riba', 'sub', 'sub_riba', 'subtotal', 'open', 'close', 'ok', 'ko', 'warn'])

/** Righe (1-based) della prima tabella: dalla prima intestazione all'ultima riga tabellare consecutiva. */
export function firstTableRange(rows: StyledRow[]): { header: number; last: number; cols: number } | null {
  const h = rows.findIndex(r => r.kind === 'header')
  if (h < 0) return null
  let last = h
  while (last + 1 < rows.length && TABLE_KINDS.has(rows[last + 1].kind)) last += 1
  return { header: h + 1, last: last + 1, cols: rows[h].cells.length }
}

/** Colonne (1-based) il cui titolo, in qualsiasi riga header, è fra quelli indicati. */
export function moneyColumns(rows: StyledRow[], moneyHeaders: string[]): Set<number> {
  const cols = new Set<number>()
  if (moneyHeaders.length === 0) return cols
  for (const r of rows) {
    if (r.kind !== 'header') continue
    r.cells.forEach((c, i) => { if (typeof c === 'string' && moneyHeaders.includes(c)) cols.add(i + 1) })
  }
  return cols
}

export function addStyledSheet(wb: Workbook, spec: SheetSpec): Worksheet {
  const ws = wb.addWorksheet(spec.name, spec.tabColor ? { properties: { tabColor: { argb: 'FF' + spec.tabColor } } } : undefined)
  ws.columns = spec.widths.map(w => ({ width: w }))
  const money = moneyColumns(spec.rows, spec.moneyHeaders ?? [])
  const ncols = Math.max(spec.widths.length, ...spec.rows.map(r => r.cells.length))

  spec.rows.forEach(r => {
    const row = ws.addRow(r.cells.map(c => (c == null ? null : c)))
    const styleAll = (fn: (col: number) => void) => { for (let c = 1; c <= Math.max(r.cells.length, TABLE_KINDS.has(r.kind) ? ncols : 0); c++) fn(c) }
    switch (r.kind) {
      case 'title':
        row.font = { bold: true, size: 14, color: { argb: 'FF' + C.title } }
        row.height = 22
        break
      case 'meta':
        row.getCell(1).font = { bold: true }
        break
      case 'header':
        styleAll(c => {
          const cell = row.getCell(c)
          cell.font = { bold: true, color: { argb: 'FF' + C.headerFg } }
          cell.fill = solid(C.headerBg)
          cell.border = thin()
          cell.alignment = { vertical: 'middle', wrapText: true }
        })
        row.height = 30
        break
      case 'data':
      case 'data_riba':
        styleAll(c => {
          const cell = row.getCell(c)
          cell.border = thin()
          if (r.kind === 'data_riba') cell.fill = solid(C.amber)
        })
        break
      case 'sub':
      case 'sub_riba':
        styleAll(c => {
          const cell = row.getCell(c)
          cell.border = thin()
          cell.font = { italic: true, color: { argb: 'FF' + C.greyText } }
          if (r.kind === 'sub_riba') cell.fill = solid(C.amber)
        })
        break
      case 'subtotal':
        styleAll(c => {
          const cell = row.getCell(c)
          cell.border = { ...thin(), top: { style: 'medium', color: { argb: 'FF' + C.greyText } } }
          cell.font = { italic: true, bold: true, color: { argb: 'FF' + C.greyText } }
        })
        break
      case 'open':
      case 'close':
        styleAll(c => {
          const cell = row.getCell(c)
          cell.border = thin()
          cell.font = { bold: true }
          cell.fill = solid(C.grey)
        })
        break
      case 'ok':
      case 'ko':
      case 'warn':
        styleAll(c => {
          const cell = row.getCell(c)
          cell.border = thin()
          cell.font = { bold: r.kind !== 'warn' }
          cell.fill = solid(r.kind === 'ok' ? C.green : r.kind === 'ko' ? C.red : C.amber)
        })
        break
      case 'section':
        for (let c = 1; c <= ncols; c++) {
          const cell = row.getCell(c)
          cell.font = { bold: true, size: 12, color: { argb: 'FF' + C.title } }
          cell.fill = solid(C.blue)
        }
        row.height = 20
        break
      case 'text':
        r.cells.forEach((_, i) => {
          const cell = row.getCell(i + 1)
          const al: Partial<Alignment> = { wrapText: true, vertical: 'top' }
          cell.alignment = al
          if (i === 0 && r.cells.length > 1) cell.font = { bold: true }
        })
        break
      case 'blank':
        break
    }
    // Formato euro sulle celle numeriche delle colonne di denaro, in qualsiasi riga
    for (const c of money) {
      const cell = row.getCell(c)
      if (typeof cell.value === 'number') {
        cell.numFmt = EURO_FMT
        cell.alignment = { ...(cell.alignment ?? {}), horizontal: 'right' }
      }
    }
  })

  if (spec.first) (ws as unknown as { orderNo: number }).orderNo = 0
  const range = firstTableRange(spec.rows)
  if (range) {
    ws.views = [{ state: 'frozen', ySplit: range.header }]
    if (spec.filter !== false && range.last > range.header) {
      ws.autoFilter = { from: { row: range.header, column: 1 }, to: { row: range.last, column: range.cols } }
    }
  }
  return ws
}

/** Scarica il workbook nel browser. */
export async function downloadWorkbook(wb: Workbook, fileName: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** Tabella da righe-oggetto (come json_to_sheet): intestazione dalle chiavi del primo oggetto. */
export function tableRows<T extends Record<string, CellValue>>(rows: T[], kindOf?: (r: T) => RowKind): StyledRow[] {
  if (rows.length === 0) return []
  const headers = Object.keys(rows[0])
  return [
    { kind: 'header', cells: headers },
    ...rows.map(r => ({ kind: kindOf ? kindOf(r) : 'data' as RowKind, cells: headers.map(h => r[h]) })),
  ]
}
