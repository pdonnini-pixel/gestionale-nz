// Helper date in fuso orario LOCALE.
//
// Perché: `new Date().toISOString()` produce sempre la data in UTC. In Italia
// (UTC+1/+2) questo sposta il giorno indietro tra mezzanotte e le ~2 di notte,
// e converte l'ultimo giorno del mese al giorno prima. Risultato: pagamenti e
// chiusure registrati "ieri", scadenze di oggi mostrate come scadute, l'ultimo
// giorno del mese escluso dai filtri. Questi helper lavorano sui componenti
// LOCALI della data, così il "giorno" è sempre quello che vede l'utente.

// Formatta una Date nei suoi componenti LOCALI come 'YYYY-MM-DD'.
export function toLocalYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Data di oggi (locale) come 'YYYY-MM-DD'. Sostituisce
// `new Date().toISOString().split('T')[0]` per le date salvate/mostrate.
export function todayYMD(): string {
  return toLocalYMD(new Date())
}

// Ultimo giorno del mese (1-12) come 'YYYY-MM-DD', in locale.
export function lastDayOfMonthYMD(year: number, month: number): string {
  // new Date(year, month, 0) = ultimo giorno del mese `month` (mese 1-indexed);
  // getDate() è locale, quindi niente slittamento UTC.
  const last = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

// Giorni (interi) da oggi alla data `d` ('YYYY-MM-DD' o ISO). Entrambe le date
// normalizzate a mezzanotte LOCALE, così una scadenza di "oggi" resta 0 tutto il
// giorno (non diventa scaduta dal pomeriggio). Ritorna null se `d` non è valida.
export function daysUntilLocal(d: string | null | undefined): number | null {
  if (!d) return null
  const due = new Date(String(d).slice(0, 10) + 'T00:00:00')
  if (isNaN(due.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}
