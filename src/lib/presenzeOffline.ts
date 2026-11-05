// Rende /timbra e /app usabili senza rete: service worker limitato a quella
// pagina, manifest per «Aggiungi a schermata Home», salvataggio dei file gia'
// caricati. Il resto del gestionale non viene toccato (scope dedicato).

export function attivaOffline(scope: '/timbra' | '/app', manifest: string): () => void {
  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = manifest
  document.head.appendChild(link)

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/presenze-sw.js', { scope }).then(async (reg) => {
      await navigator.serviceWorker.ready
      const urls = performance.getEntriesByType('resource').map((r) => r.name)
      ;(reg.active ?? reg.waiting ?? reg.installing)?.postMessage({ tipo: 'salva', urls })
    }).catch(() => { /* senza service worker la pagina funziona lo stesso online */ })
  }
  return () => { link.remove() }
}

type WakeLockSentinelLite = { release: () => Promise<void> }

/** Tiene acceso lo schermo finche' la pagina e' aperta (cellulare in carica alla cassa). */
export function schermoSempreAcceso(): () => void {
  let lock: WakeLockSentinelLite | null = null
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLite> } }
  const chiedi = () => {
    if (document.visibilityState === 'visible' && nav.wakeLock) {
      nav.wakeLock.request('screen').then((l) => { lock = l }).catch(() => { /* non supportato */ })
    }
  }
  chiedi()
  document.addEventListener('visibilitychange', chiedi)
  return () => {
    document.removeEventListener('visibilitychange', chiedi)
    lock?.release().catch(() => {})
  }
}
