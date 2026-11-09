import { describe, it, expect } from 'vitest';
import { normalizeDocumentType, documentTypeLabel, notaDistintaNC, isRibaMethod, provisionalRatesByInvoice, provisionalSiblingsOf } from './helpers';

describe('normalizeDocumentType', () => {
  it('riconosce la proforma anche scritta come «fattura proforma»', () => {
    expect(normalizeDocumentType('proforma')).toBe('proforma');
    expect(normalizeDocumentType('Fattura Pro-forma')).toBe('proforma');
    expect(normalizeDocumentType('pro forma')).toBe('proforma');
  });
  it('notula, parcella, fattura', () => {
    expect(normalizeDocumentType('progetto di notula')).toBe('notula');
    expect(normalizeDocumentType('Parcella')).toBe('parcella');
    expect(normalizeDocumentType('fattura')).toBe('fattura');
  });
  it('vuoto = fattura, sconosciuto = altro', () => {
    expect(normalizeDocumentType(null)).toBe('fattura');
    expect(normalizeDocumentType('')).toBe('fattura');
    expect(normalizeDocumentType('avviso di pagamento')).toBe('altro');
  });
});

describe('documentTypeLabel', () => {
  it('NULL resta «Fatt.»', () => {
    expect(documentTypeLabel(null)).toBe('Fatt.');
    expect(documentTypeLabel('proforma')).toBe('Proforma');
    expect(documentTypeLabel('proforma', 'long')).toBe('Proforma');
    expect(documentTypeLabel(undefined, 'long')).toBe('Fattura');
  });
});

describe('notaDistintaNC', () => {
  const nc = [
    { num: '92', date: '2026-08-05', amt: 67.22 },
    { num: '109', date: '2026-09-14', amt: 237.9 },
  ];
  it('saldo con due note di credito, nel formato della mail', () => {
    expect(notaDistintaNC('SALDO', '285', '2026-06-30', nc)).toBe(
      'Saldo fattura N. 285 del 30/06/2026 — al netto NC n.92 del 05/08/2026 (67,22) e NC n.109 del 14/09/2026 (237,90)',
    );
  });
  it('acconto e importi oltre mille', () => {
    expect(notaDistintaNC('ACCONTO', '12/A', '2026-07-01', [{ num: '5', date: '2026-07-10', amt: 1234.5 }])).toBe(
      'Acconto fattura N. 12/A del 01/07/2026 — al netto NC n.5 del 10/07/2026 (1.234,50)',
    );
  });
  it('senza note di credito resta vuoto', () => {
    expect(notaDistintaNC('SALDO', '285', '2026-06-30', [])).toBe('');
  });
});

describe('RiBa provvisorie', () => {
  it('riconosce solo i metodi RiBa', () => {
    expect(isRibaMethod('riba_60')).toBe(true)
    expect(isRibaMethod('riba')).toBe(true)
    expect(isRibaMethod('RIBA_90')).toBe(true)
    expect(isRibaMethod('carta_credito')).toBe(false)
    expect(isRibaMethod('sdd_core')).toBe(false)
    expect(isRibaMethod('ribalta')).toBe(false)
    expect(isRibaMethod(null)).toBe(false)
  })

  it('raggruppa le rate provvisorie per fattura e trova quelle sorelle', () => {
    const rows = [
      { id: 'a1', supplier_id: 'S1', invoice_number: '100/26', status: 'pagato_provvisorio', due_date: '2026-10-31', gross_amount: 10, installment_number: 1 },
      { id: 'a2', supplier_id: 'S1', invoice_number: '100/26', status: 'da_pagare', due_date: '2026-11-30', gross_amount: 10, installment_number: 2 },
      { id: 'b1', supplier_id: 'S2', invoice_number: '100/26', status: 'da_pagare', due_date: '2026-11-30', gross_amount: 5, installment_number: 1 },
      { id: 'c1', supplier_id: 'S1', invoice_number: '-', status: 'pagato_provvisorio', due_date: '2026-10-31', gross_amount: 1, installment_number: 1 },
    ]
    const map = provisionalRatesByInvoice(rows)
    expect(map.size).toBe(1)
    expect(provisionalSiblingsOf(rows[1], map).map(r => r.id)).toEqual(['a1'])
    // la rata provvisoria non conta se stessa
    expect(provisionalSiblingsOf(rows[0], map)).toEqual([])
    // stesso numero di un altro fornitore: niente
    expect(provisionalSiblingsOf(rows[2], map)).toEqual([])
  })
})
