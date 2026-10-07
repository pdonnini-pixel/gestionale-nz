import { describe, it, expect } from 'vitest';
import { normalizeDocumentType, documentTypeLabel } from './helpers';

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
