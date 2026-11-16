import { describe, it, expect } from 'vitest'
import { annoFinePeriodo } from './bilancioParser'

describe('anno del periodo del bilancio', () => {
  it('legge l\'anno di fine, non quello di inizio («DAL» contiene «AL»)', () => {
    expect(annoFinePeriodo('PERIODO DAL 01/01/2025 AL 31/12/2025')).toBe(2025)
    expect(annoFinePeriodo('PERIODO DAL 01/01/2026 AL 30/09/2026')).toBe(2026)
    expect(annoFinePeriodo('PERIODO DAL 01/07/2025 AL 30/06/2026')).toBe(2026)
  })
  it('senza periodo non blocca niente', () => {
    expect(annoFinePeriodo('')).toBeNull()
    expect(annoFinePeriodo(undefined)).toBeNull()
  })
})
