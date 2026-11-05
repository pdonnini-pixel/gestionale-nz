// App del dipendente (/app): conti delle schede Turni, Ferie e Ore.
// Logica pura e testata; le pagine stanno in src/components/app/.
//
// Regole (PIANO_FERIE_NOTES.md, TIMBRATURE_NOTES.md):
//   - le ore di ferie si dicono in ore con i decimali («42,50 ore»), mai in
//     minuti: si confrontano riga per riga con il modulo delle ferie;
//   - al dipendente due righe sole, Ferie e Permessi (ex festivita' + ROL):
//     le due borse dei permessi le distinguono le paghe;
//   - niente parole interne (vedi PAROLE_INTERNE e il test).

import { riepilogoGiorno, type Timbratura, type TipoTimbratura } from './timbrature'

/** Parole che il dipendente non deve leggere (stessa regola di ferieExport). */
export const PAROLE_INTERNE = /paghe|tabulato|gestionale|dedott|da confermare|anagrafica|ripiego/i

// ─── Date (stringhe YYYY-MM-DD, senza fusi) ────────────────────────────

export function aggiungiGiorni(data: string, n: number): string {
  const [y, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Lunedi' della settimana della data. */
export function lunediDi(data: string): string {
  const [y, m, d] = data.split('-').map(Number)
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // 0 = lunedi'
  return aggiungiGiorni(data, -dow)
}

export function giorniTra(dal: string, al: string): string[] {
  const out: string[] = []
  for (let d = dal; d <= al && out.length < 400; d = aggiungiGiorni(d, 1)) out.push(d)
  return out
}

export function primoDelMese(data: string): string { return `${data.slice(0, 7)}-01` }

export function ultimoDelMese(data: string): string {
  const [y, m] = data.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

/** «lun 10 nov» */
export function giornoBreve(data: string): string {
  const [y, m, d] = data.split('-').map(Number)
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return `${GIORNI[dow]} ${d} ${MESI_BREVI[m - 1]}`
}

/** «novembre 2026» */
export function meseLungo(data: string): string {
  const [y, m] = data.split('-').map(Number)
  return `${MESI_LUNGHI[m - 1]} ${y}`
}

/** «10/11/2026» */
export function dataItaliana(data: string): string {
  const [y, m, d] = data.split('-')
  return `${d}/${m}/${y}`
}

// ─── Ore ────────────────────────────────────────────────────────────────

/** «7,50 ore», «1 ora», «nessuna». Minuti → ore con due decimali. */
export function oreDaMinuti(minuti: number): string {
  const ore = Math.round((minuti / 60) * 100) / 100
  if (Math.abs(ore) < 0.005) return 'nessuna'
  if (Math.abs(ore - 1) < 0.005) return '1 ora'
  return `${ore.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ore`
}

/** Minuti di un turno «09:00»-«13:00», pausa esclusa. */
export function minutiTurno(inizio: string, fine: string, pausaMinuti?: number | null): number {
  const [hi, mi] = inizio.split(':').map(Number)
  const [hf, mf] = fine.split(':').map(Number)
  return Math.max(0, hf * 60 + mf - (hi * 60 + mi) - (pausaMinuti ?? 0))
}

// ─── Turni ──────────────────────────────────────────────────────────────

export interface TurnoApp { data: string; inizio: string; fine: string; pausa_minuti: number | null; negozio?: string | null }
export interface GiornoFerieApp { data: string; tipo: string; ore: number; stato: string; voce: 'ferie' | 'permesso' }

export interface GiornoTurni {
  data: string
  turni: TurnoApp[]
  ferie: GiornoFerieApp[]
  minutiInTurno: number
}

/** I giorni di un periodo con i loro turni e le ferie, per la scheda Turni. */
export function giorniConTurni(dal: string, al: string, turni: TurnoApp[], ferie: GiornoFerieApp[]): GiornoTurni[] {
  return giorniTra(dal, al).map((data) => {
    const t = turni.filter((x) => x.data === data).sort((a, b) => a.inizio.localeCompare(b.inizio))
    return {
      data,
      turni: t,
      ferie: ferie.filter((f) => f.data === data),
      minutiInTurno: t.reduce((s, x) => s + minutiTurno(x.inizio, x.fine, x.pausa_minuti), 0),
    }
  })
}

// ─── Ore lavorate ───────────────────────────────────────────────────────

export interface GiornoOre {
  data: string
  turno: { inizio: string; fine: string } | null
  minutiLavorati: number
  minutiPausa: number
  minutiOltreTurno: number
  straordinario: boolean
  timbrato: boolean
  /** Giorno passato rimasto senza uscita: le ore dopo l'ultima timbratura non si contano. */
  uscitaMancante: boolean
  ferie: GiornoFerieApp[]
}

export interface SettimanaOre {
  lunedi: string
  giorni: GiornoOre[]
  minutiLavorati: number
  /** La settimana e' tutta dentro al periodo: si confronta con il contratto. */
  intera: boolean
}

/**
 * Ore lavorate giorno per giorno (dalle timbrature) e per settimana.
 * Con il turno spezzato vale l'intera giornata, dal primo inizio all'ultima fine.
 */
export function oreDelPeriodo(
  dal: string,
  al: string,
  timbrature: { tipo: TipoTimbratura; ora: string }[],
  turni: TurnoApp[],
  ferie: GiornoFerieApp[],
  dataDi: (iso: string) => string,
  adessoMs: number,
  margineMinuti: number,
): SettimanaOre[] {
  const perGiorno = new Map<string, Timbratura[]>()
  for (const t of timbrature) {
    const d = dataDi(t.ora)
    perGiorno.set(d, [...(perGiorno.get(d) ?? []), { tipo: t.tipo, ora: t.ora }])
  }
  const oggi = dataDi(new Date(adessoMs).toISOString())
  const giorni: GiornoOre[] = giorniTra(dal, al).map((data) => {
    const del = turni.filter((x) => x.data === data).sort((a, b) => a.inizio.localeCompare(b.inizio))
    const turno = del.length ? { data, inizio: del[0].inizio, fine: del[del.length - 1].fine } : null
    const ts = [...(perGiorno.get(data) ?? [])].sort((a, b) => a.ora.localeCompare(b.ora))
    const ultima = ts[ts.length - 1]
    // Un giorno passato rimasto aperto (uscita dimenticata) non deve contare
    // le ore fino a oggi: si ferma all'ultima timbratura e si segnala.
    const aperto = data < oggi && !!ultima && ultima.tipo !== 'uscita'
    const r = riepilogoGiorno(ts, turno, aperto ? Date.parse(ultima.ora) : adessoMs, margineMinuti)
    return {
      data,
      turno: turno ? { inizio: turno.inizio, fine: turno.fine } : null,
      minutiLavorati: r.minutiLavorati,
      minutiPausa: r.minutiPausa,
      minutiOltreTurno: r.minutiOltreTurno,
      straordinario: r.straordinario,
      timbrato: ts.length > 0,
      uscitaMancante: aperto,
      ferie: ferie.filter((f) => f.data === data),
    }
  })
  const settimane = new Map<string, GiornoOre[]>()
  for (const g of giorni) {
    const l = lunediDi(g.data)
    settimane.set(l, [...(settimane.get(l) ?? []), g])
  }
  return [...settimane.entries()].map(([lunedi, gs]) => ({
    lunedi,
    giorni: gs,
    minutiLavorati: gs.reduce((s, g) => s + g.minutiLavorati, 0),
    intera: gs.length === 7,
  }))
}

// ─── Ferie e permessi ───────────────────────────────────────────────────

export interface SaldoVoce {
  voce: 'F01' | 'F02' | 'F03'
  residuo_disponibile: number | null
  da_fruire_disponibile: number | null
  ore_in_attesa: number | null
  saldo_alla_data: string | null
  ore_giornata_dedotte: number | null
}

export interface SaldoApp {
  /** Ore disponibili oggi. */
  oggi: number
  /** Contando anche quelle che maturano. */
  conMaturazione: number
  inAttesa: number
}

/** Le due righe che vede il dipendente: Ferie (F01) e Permessi (F02 + F03). */
export function saldiApp(saldi: SaldoVoce[]): { ferie: SaldoApp | null; permessi: SaldoApp | null; aggiornatoAl: string | null } {
  const somma = (voci: string[]): SaldoApp | null => {
    const r = saldi.filter((s) => voci.includes(s.voce))
    if (!r.length) return null
    const n = (x: number | null | undefined) => Number(x ?? 0)
    return {
      oggi: r.reduce((s, x) => s + n(x.residuo_disponibile), 0),
      conMaturazione: r.reduce((s, x) => s + n(x.da_fruire_disponibile ?? x.residuo_disponibile), 0),
      inAttesa: r.reduce((s, x) => s + n(x.ore_in_attesa), 0),
    }
  }
  return {
    ferie: somma(['F01']),
    permessi: somma(['F02', 'F03']),
    aggiornatoAl: saldi.find((s) => s.saldo_alla_data)?.saldo_alla_data ?? null,
  }
}

export const STATO_RICHIESTA: Record<string, { testo: string; colore: string }> = {
  inviata: { testo: 'In attesa di risposta', colore: 'bg-amber-100 text-amber-800' },
  approvata: { testo: 'Approvata', colore: 'bg-emerald-100 text-emerald-800' },
  approvata_parziale: { testo: 'Approvata in parte', colore: 'bg-emerald-100 text-emerald-800' },
  respinta: { testo: 'Non approvata', colore: 'bg-rose-100 text-rose-800' },
  ritirata: { testo: 'Ritirata', colore: 'bg-slate-100 text-slate-600' },
  chiusa: { testo: 'Chiusa', colore: 'bg-slate-100 text-slate-600' },
}

/** Il giorno cade in un periodo senza ferie del negozio? Restituisce il nome. */
export function eventoSenzaFerie(data: string, periodi: { nome: string; dal: string; al: string }[]): string | null {
  return periodi.find((p) => data >= p.dal && data <= p.al)?.nome ?? null
}
