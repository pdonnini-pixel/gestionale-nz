import { describe, it, expect } from 'vitest'
import { buildCodiciRows, buildCodiciSheet, type PnContratto } from './primaNotaCodici'
import type { PnChannel, PnOutletInfo } from './primaNotaIncassi'

const ch = (p: Partial<PnChannel> & { id: string; outlet_id: string; kind: string }): PnChannel =>
  ({ label: p.kind, terminal_code: null, bank_account_id: null, is_active: true, ...p })

const OUTLETS = new Map<string, PnOutletInfo>([['plm', { code: 'PLM', name: 'PALMANOVA' }], ['vdc', { code: 'VDC', name: 'VALDICHIANA' }], ['rso', { code: 'RSO', name: 'ROMA SORATTE' }]])
const CHANNELS: PnChannel[] = [
  ch({ id: '1', outlet_id: 'plm', kind: 'pos', label: 'POS BCC', terminal_code: '00005', bank_account_id: 'bcc' }),
  ch({ id: '2', outlet_id: 'plm', kind: 'pos', label: 'POS MPS', terminal_code: '00007', bank_account_id: 'mps' }),
  ch({ id: '3', outlet_id: 'plm', kind: 'pos', label: 'Pay by link', terminal_code: '00007', bank_account_id: 'mps' }),
  ch({ id: '4', outlet_id: 'plm', kind: 'contanti', label: 'Contanti', terminal_code: 'PALMANOVA' }),
  ch({ id: '5', outlet_id: 'vdc', kind: 'pos', label: 'POS BCC', terminal_code: '00001', bank_account_id: 'bcc' }),
  ch({ id: '6', outlet_id: 'vdc', kind: 'pos', label: 'POS vecchio', terminal_code: '00099', bank_account_id: 'bcc', is_active: false }),
  ch({ id: '7', outlet_id: 'rso', kind: 'pos', label: 'POS' }),
]
const CONTRATTI: PnContratto[] = [
  { outlet_id: 'plm', acquirer: 'nexi', merchant_code: 'LN0005475974', payment_contract: 'PC0001392693', settlement_mode: 'netto', is_active: true },
  { outlet_id: 'plm', acquirer: 'amex', merchant_code: '7378034250', payment_contract: null, settlement_mode: 'lordo', is_active: true },
  { outlet_id: 'plm', acquirer: 'amex', merchant_code: '7379455439', payment_contract: null, settlement_mode: 'lordo', is_active: false },
  { outlet_id: 'vdc', acquirer: 'nexi', merchant_code: 'LN0004777495', payment_contract: 'PC0001000583', settlement_mode: 'lordo', is_active: true },
  { outlet_id: 'vdc', acquirer: 'amex', merchant_code: '7373035260', payment_contract: null, settlement_mode: 'lordo', is_active: true },
]
const bankNameOf = (id: string | null) => (id === 'bcc' ? 'BCC Valdarno Fiorentino' : id === 'mps' ? 'MPS - Banca Monte dei Paschi' : '')

describe('buildCodiciRows: una riga per negozio con tutti i codici', () => {
  const rows = buildCodiciRows(OUTLETS, CHANNELS, CONTRATTI, bankNameOf)
  it('Nexi, Amex, terminali per banca e parola chiave dei contanti; i canali e i contratti disattivi non contano', () => {
    expect(rows.map(r => r.Negozio)).toEqual(['PLM · PALMANOVA', 'RSO · ROMA SORATTE', 'VDC · VALDICHIANA'])
    const plm = rows[0]
    expect(plm['Nexi punto vendita']).toBe('LN0005475974')
    expect(plm['Nexi contratto']).toBe('PC0001392693')
    expect(plm['Nexi regime']).toBe('al netto')
    expect(plm['Amex codici esercente']).toBe('7378034250')
    expect(plm['POS BCC terminale']).toBe('00005')
    expect(plm['POS MPS terminale']).toBe('00007')
    expect(plm['Contanti parola chiave']).toBe('PALMANOVA')
    const vdc = rows[2]
    expect(vdc['Nexi regime']).toBe('al lordo')
    expect(vdc['POS BCC terminale']).toBe('00001')
    expect(vdc['POS MPS terminale']).toBe('')
  })
  it('il foglio ha titolo, tabella e la sezione su dove leggere i codici', () => {
    const sheet = buildCodiciSheet(rows, 'Settembre 2026')
    expect(sheet[0]).toEqual({ kind: 'title', cells: ['Codici dei negozi'] })
    const header = sheet.find(r => r.kind === 'header')!
    expect(header.cells).toEqual(['Negozio', 'Nexi punto vendita', 'Nexi contratto', 'Nexi regime', 'Amex codici esercente', 'POS BCC terminale', 'POS MPS terminale', 'Contanti parola chiave'])
    expect(sheet.filter(r => r.kind === 'data').length).toBe(3)
    const text = sheet.map(r => r.cells.join(' | ')).join('\n')
    expect(text).toContain('punto vendita cod. LN')
    expect(text).toContain('CODICE MANDATO')
    expect(text).toContain('COD.SIA')
  })
  it('senza canali né contratti lo dice', () => {
    const sheet = buildCodiciSheet([], 'x')
    expect(sheet.some(r => r.kind === 'text' && String(r.cells[0]).startsWith('Nessun canale'))).toBe(true)
  })
})
