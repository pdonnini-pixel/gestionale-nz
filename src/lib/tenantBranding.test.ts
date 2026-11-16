import { describe, it, expect } from 'vitest'
import { nomeBreveTenant, inizialiTenant, iconaTenantSvg } from './tenantBranding'

describe('marchio del tenant', () => {
  it('toglie la forma societaria dal nome breve', () => {
    expect(nomeBreveTenant('New Zago Srl')).toBe('New Zago')
    expect(nomeBreveTenant('Zago Srl')).toBe('Zago')
    expect(nomeBreveTenant('Made Retail Srl')).toBe('Made Retail')
  })

  it('distingue le iniziali dei due gestionali', () => {
    expect(inizialiTenant('New Zago Srl')).toBe('NZ')
    expect(inizialiTenant('Zago Srl')).toBe('ZA')
  })

  it('usa il colore del tenant e ripiega su un grigio se il colore non è valido', () => {
    expect(iconaTenantSvg({ displayName: 'Zago Srl', accentBg: '#c2410c' })).toContain('fill="#c2410c"')
    expect(iconaTenantSvg({ displayName: 'Zago Srl', accentBg: 'red;"' })).toContain('fill="#334155"')
  })
})
