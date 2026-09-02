import { describe, it, expect } from 'vitest';
import {
  isAdminEmployee, personKey, lastGranitedPeriod, resolvePeriod,
  paidEmployeeIds, companyHeadcount, headcountByOutlet, headcountCountByOutlet,
  periodLabel,
  type HeadcountCost, type HeadcountEmployee, type HeadcountAllocation,
} from './headcount';

const emp = (id: string, extra: Partial<HeadcountEmployee> = {}): HeadcountEmployee =>
  ({ id, cognome: id.toUpperCase(), nome: 'X', ...extra });

const cost = (employee_id: string, year: number, month: number, netto: number | null = 1000): HeadcountCost =>
  ({ employee_id, year, month, netto });

describe('headcount — regola dell organico granitico', () => {
  const employees = [
    emp('a', { codice_fiscale: 'AAA' }),
    emp('b', { codice_fiscale: 'BBB' }),
    emp('c', { codice_fiscale: 'CCC' }),
    emp('adm', { role_description: 'Amministratore Unico', codice_fiscale: 'DDD' }),
  ];
  const allocs: HeadcountAllocation[] = [
    { employee_id: 'a', outlet_code: 'PALMANOVA' },
    { employee_id: 'b', outlet_code: 'PALMANOVA' },
    { employee_id: 'c', outlet_code: 'TORINO' },
    { employee_id: 'adm', outlet_code: 'SEDE' },
  ];

  it('il carico del mese fa il numero: 2 a giugno, 1 a luglio', () => {
    const costs = [
      cost('a', 2026, 6), cost('b', 2026, 6),
      cost('a', 2026, 7),
    ];
    expect(headcountCountByOutlet(costs, employees, allocs, { year: 2026, month: 6 })['PALMANOVA']).toBe(2);
    expect(headcountCountByOutlet(costs, employees, allocs, { year: 2026, month: 7 })['PALMANOVA']).toBe(1);
  });

  it('conta solo le righe con netto valorizzato', () => {
    const costs = [cost('a', 2026, 7), cost('b', 2026, 7, null)];
    expect(companyHeadcount(costs, employees, { year: 2026, month: 7 })).toBe(1);
  });

  it('esclude gli amministratori', () => {
    const costs = [cost('a', 2026, 7), cost('adm', 2026, 7)];
    expect(companyHeadcount(costs, employees, { year: 2026, month: 7 })).toBe(1);
    expect(headcountCountByOutlet(costs, employees, allocs, { year: 2026, month: 7 })['SEDE']).toBeUndefined();
  });

  it('un cessato resta contato nei mesi in cui è stato pagato', () => {
    // is_active non entra nel calcolo: il dato del mese non si riscrive.
    const cessato = emp('z', { codice_fiscale: 'ZZZ' });
    const costs = [cost('z', 2026, 3)];
    const withZ = [...employees, cessato];
    const allocsZ = [...allocs, { employee_id: 'z', outlet_code: 'VALDICHIANA' }];
    expect(companyHeadcount(costs, withZ, { year: 2026, month: 3 })).toBe(1);
    expect(headcountCountByOutlet(costs, withZ, allocsZ, { year: 2026, month: 3 })['VALDICHIANA']).toBe(1);
  });

  it('deduplica la stessa persona con due matricole', () => {
    const doppio = [emp('m1', { codice_fiscale: 'SAME' }), emp('m2', { codice_fiscale: 'same' })];
    const costs = [cost('m1', 2026, 7), cost('m2', 2026, 7)];
    expect(companyHeadcount(costs, doppio, { year: 2026, month: 7 })).toBe(1);
  });

  it('senza codice fiscale deduplica per cognome+nome', () => {
    const a = { id: '1', cognome: 'Rossi', nome: 'Mario' };
    const b = { id: '2', last_name: 'ROSSI', first_name: ' mario ' };
    expect(personKey(a)).toBe(personKey(b));
  });

  it('chi è su due outlet conta in entrambi ma una volta sola nel totale', () => {
    const costs = [cost('a', 2026, 7)];
    const due = [{ employee_id: 'a', outlet_code: 'PALMANOVA' }, { employee_id: 'a', outlet_code: 'TORINO' }];
    const byOutlet = headcountCountByOutlet(costs, employees, due, { year: 2026, month: 7 });
    expect(byOutlet['PALMANOVA']).toBe(1);
    expect(byOutlet['TORINO']).toBe(1);
    expect(companyHeadcount(costs, employees, { year: 2026, month: 7 })).toBe(1);
  });

  it('lastGranitedPeriod prende il mese più recente, anche entro un anno', () => {
    const costs = [cost('a', 2025, 12), cost('a', 2026, 3), cost('a', 2026, 1)];
    expect(lastGranitedPeriod(costs)).toEqual({ year: 2026, month: 3 });
    expect(lastGranitedPeriod(costs, 2025)).toEqual({ year: 2025, month: 12 });
    expect(lastGranitedPeriod([], 2026)).toBeNull();
  });

  it('resolvePeriod ripiega sull ultimo mese granito e lo dichiara', () => {
    const costs = [cost('a', 2026, 3)];
    const own = resolvePeriod(costs, { year: 2026, month: 3 });
    expect(own).toEqual({ period: { year: 2026, month: 3 }, isGranited: true, requested: { year: 2026, month: 3 } });

    const fall = resolvePeriod(costs, { year: 2026, month: 9 });
    expect(fall.isGranited).toBe(false);
    expect(fall.period).toEqual({ year: 2026, month: 3 });
    expect(fall.requested).toEqual({ year: 2026, month: 9 });

    expect(resolvePeriod([], { year: 2026, month: 9 }).period).toBeNull();
  });

  it('periodo nullo o senza dati: nessun numero inventato', () => {
    expect(companyHeadcount([], [], null)).toBe(0);
    expect(headcountByOutlet([], [], [], null)).toEqual({});
    expect(paidEmployeeIds([cost('a', 2026, 7)], [], null).size).toBe(0);
  });

  it('isAdminEmployee riconosce le varianti del ruolo', () => {
    expect(isAdminEmployee({ role_description: 'Amministratore' })).toBe(true);
    expect(isAdminEmployee({ role_description: 'amministratrice delegata' })).toBe(true);
    expect(isAdminEmployee({ role_description: 'Impiegato' })).toBe(false);
    expect(isAdminEmployee({ role_description: null })).toBe(false);
  });

  it('periodLabel è leggibile in italiano', () => {
    expect(periodLabel({ year: 2026, month: 3 })).toBe('marzo 2026');
    expect(periodLabel(null)).toBe('—');
  });
});
