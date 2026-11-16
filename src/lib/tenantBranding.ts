// Segni del tenant fuori dalle pagine: nome della scheda del browser e icona.
// Chi lavora su New Zago e Zago apre i due gestionali uno accanto all'altro
// (Patrizio, 16/11/2026: «non si differenzia e ci si confonde»): titolo e
// icona prendono nome e colore del tenant attivo, mai valori scritti a mano.
import type { TenantConfig } from './tenants'

/** Nome breve per la scheda: «New Zago Srl» → «New Zago». */
export function nomeBreveTenant(displayName: string): string {
  return displayName.replace(/\s+(s\.?r\.?l\.?|s\.?p\.?a\.?)$/i, '').trim() || displayName
}

/** Iniziali del tenant: «New Zago Srl» → «NZ», «Zago Srl» → «ZA» (una parola sola: prime due lettere). */
export function inizialiTenant(displayName: string): string {
  const parole = nomeBreveTenant(displayName).split(/\s+/).filter(Boolean)
  const base = parole.length >= 2 ? parole.slice(0, 2).map((p) => p[0]).join('') : (parole[0] ?? '').slice(0, 2)
  return base.toUpperCase()
}

/** Icona SVG con le iniziali bianche sul colore del tenant. */
export function iconaTenantSvg(tenant: Pick<TenantConfig, 'displayName' | 'accentBg'>): string {
  const iniziali = inizialiTenant(tenant.displayName).replace(/[^A-Z0-9]/g, '')
  const colore = /^#[0-9a-fA-F]{3,8}$/.test(tenant.accentBg) ? tenant.accentBg : '#334155'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${colore}"/>` +
    `<text x="32" y="42" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" ` +
    `fill="#ffffff" text-anchor="middle">${iniziali}</text></svg>`
  )
}

/**
 * Titolo e icona della scheda del gestionale. Le pagine del dipendente
 * (/app, /timbra) hanno i loro e non si toccano.
 */
export function applicaMarchioTenant(tenant: TenantConfig, path: string = window.location.pathname): void {
  if (path.startsWith('/app') || path.startsWith('/timbra')) return
  document.title = `Gestionale ${nomeBreveTenant(tenant.displayName)}`
  const href = `data:image/svg+xml,${encodeURIComponent(iconaTenantSvg(tenant))}`
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/svg+xml'
  link.href = href
}
