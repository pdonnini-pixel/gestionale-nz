// Distinta di rimborso (migration 390).
//
// Fatture intestate all'azienda ma pagate di tasca propria da una persona
// (trasferte, piccoli acquisti): il rimborso è UN bonifico a quella persona e
// chiude tutte le fatture della distinta, anche di fornitori diversi. Qui stanno
// i controlli e il testo della disposizione; l'aggancio al movimento bancario lo
// fa il database (try_match_rimborso_bank_transaction).

export interface RigaRimborso {
  fornitore: string
  fattura: string
  importo: number
  bankId: string
  /** La riga scala note di credito: in un rimborso non ha senso. */
  conNoteCredito?: boolean
  /** Scadenza fiscale (F24): non è una fattura anticipata da qualcuno. */
  fiscale?: boolean
}

export interface DatiRimborso {
  nome: string
  iban: string
}

/** IBAN senza spazi e in maiuscolo. */
export const normalizzaIban = (iban: string): string => (iban || '').replace(/\s+/g, '').toUpperCase()

/** Controllo formale dell'IBAN (lunghezza e cifre di controllo, ISO 13616). */
export function ibanValido(iban: string): boolean {
  const s = normalizzaIban(iban)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false
  if (s.startsWith('IT') && s.length !== 27) return false
  const girato = s.slice(4) + s.slice(0, 4)
  let resto = 0
  for (const ch of girato) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch
    for (const c of v) resto = (resto * 10 + Number(c)) % 97
  }
  return resto === 1
}

/**
 * Cosa impedisce di salvare la distinta come rimborso, in parole per chi la sta
 * compilando. `null` quando è tutto a posto.
 */
export function controllaRimborso(dati: DatiRimborso, righe: RigaRimborso[]): string | null {
  if (righe.length === 0) return 'Nessuna fattura nella distinta.'
  if (righe.some(r => r.fiscale)) return 'Un rimborso riguarda solo fatture: togli le scadenze fiscali dalla distinta.'
  if (righe.some(r => r.conNoteCredito)) return 'Un rimborso non scala note di credito: togli la compensazione o prepara una distinta normale.'
  if (righe.some(r => !r.bankId)) return 'Scegli la banca da cui parte il bonifico per tutte le fatture.'
  if (new Set(righe.map(r => r.bankId)).size > 1) return 'Il rimborso è un solo bonifico: tutte le fatture devono partire dalla stessa banca.'
  if (righe.some(r => !(r.importo > 0))) return 'Ogni fattura deve avere un importo maggiore di zero.'
  if ((dati.nome || '').trim().length < 3) return 'Scrivi nome e cognome di chi riceve il rimborso.'
  if (!ibanValido(dati.iban)) return 'L’IBAN di chi riceve il rimborso non è valido: controllalo.'
  return null
}

export const totaleRimborso = (righe: RigaRimborso[]): number =>
  +righe.reduce((s, r) => s + (Number(r.importo) || 0), 0).toFixed(2)

/** Causale del bonifico, entro i 140 caratteri di un bonifico SEPA. */
export function causaleRimborso(righe: RigaRimborso[]): string {
  const base = 'Rimborso fatture anticipate: '
  const voci = righe.map(r => `${(r.fornitore || '').trim().split(/\s+/).slice(0, 2).join(' ')} ${r.fattura || ''}`.trim())
  let testo = base + voci.join(', ')
  if (testo.length <= 140) return testo
  testo = base + righe.map(r => r.fattura || '').filter(Boolean).join(', ')
  return testo.length <= 140 ? testo : `Rimborso ${righe.length} fatture anticipate`
}

/** Oggetto e testo della mail di disposizione per una distinta di rimborso. */
export function emailRimborso(args: {
  dataStr: string
  dati: DatiRimborso
  banca: { nome: string; iban: string }
  righe: RigaRimborso[]
  fmt: (n: number) => string
}): { subject: string; body: string } {
  const { dataStr, dati, banca, righe, fmt } = args
  const nome = dati.nome.trim()
  const totale = totaleRimborso(righe)
  const elenco = righe
    .map((r, i) => `  ${i + 1}. ${r.fornitore}, fattura ${r.fattura}: ${fmt(r.importo)} €`)
    .join('\n')
  const body =
    `Buongiorno,\n\ndi seguito il rimborso da eseguire in data odierna (${dataStr}) con UN SOLO bonifico.\n\n` +
    `Beneficiario: ${nome}\n` +
    `IBAN beneficiario: ${normalizzaIban(dati.iban)}\n` +
    `Importo del bonifico: ${fmt(totale)} €\n` +
    `Da: ${banca.nome}${banca.iban ? ` (IBAN ${banca.iban})` : ''}\n` +
    `Causale: ${causaleRimborso(righe)}\n\n` +
    `Fatture anticipate da ${nome} e chiuse da questo bonifico:\n${elenco}\n\n` +
    `Il bonifico va fatto per l'importo esatto: quando arriva in banca il gestionale chiude da solo tutte le fatture elencate.\n\nCordiali saluti`
  return { subject: `Rimborso a ${nome} - ${dataStr}`, body }
}
