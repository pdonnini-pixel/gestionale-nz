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

export interface TurnoApp { data: string; inizio: string; fine: string; pausa_minuti: number | null; /** pausa timbrata ma non tolta dalle ore (migration 401); puo' mancare */ pausa_pagata_minuti?: number | null; negozio?: string | null }
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
    const turno = del.length ? { data, inizio: del[0].inizio, fine: del[del.length - 1].fine, pausa_pagata_minuti: del.reduce((s, x) => s + (x.pausa_pagata_minuti ?? 0), 0) } : null
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
  /** Ore del saldo alla data (prima delle richieste successive). */
  residuo?: number | null
  residuo_disponibile: number | null
  da_fruire_disponibile: number | null
  ore_in_attesa: number | null
  ore_approvate?: number | null
  saldo_alla_data: string | null
  ore_giornata_dedotte: number | null
}

export interface SaldoApp {
  /** Ore disponibili oggi (tolte quelle chieste o approvate dopo il saldo). */
  oggi: number
  /** Contando anche quelle che maturano. */
  conMaturazione: number
  inAttesa: number
  /** Ore gia' approvate dopo la data del saldo. */
  approvate: number
  /** Ore del saldo alla data: libere + in attesa + approvate. */
  totale: number
  /** Ore di una giornata (per dire «circa N giornate»). */
  giornata: number | null
}

/** Le due righe che vede il dipendente: Ferie (F01) e Permessi (F02 + F03). */
export function saldiApp(saldi: SaldoVoce[]): { ferie: SaldoApp | null; permessi: SaldoApp | null; aggiornatoAl: string | null } {
  const somma = (voci: string[]): SaldoApp | null => {
    const r = saldi.filter((s) => voci.includes(s.voce))
    if (!r.length) return null
    const n = (x: number | null | undefined) => Number(x ?? 0)
    const oggi = r.reduce((s, x) => s + n(x.residuo_disponibile), 0)
    const inAttesa = r.reduce((s, x) => s + n(x.ore_in_attesa), 0)
    const approvate = r.reduce((s, x) => s + n(x.ore_approvate), 0)
    const giornata = r.map((x) => Number(x.ore_giornata_dedotte)).find((g) => g > 0) ?? null
    return {
      oggi,
      conMaturazione: r.reduce((s, x) => s + n(x.da_fruire_disponibile ?? x.residuo_disponibile), 0),
      inAttesa,
      approvate,
      totale: r.some((x) => x.residuo != null) ? r.reduce((s, x) => s + n(x.residuo), 0) : oggi + inAttesa + approvate,
      giornata,
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

// ─── Richieste: cosa sono e quanto valgono ──────────────────────────────

export interface GiornoRichiesta { data: string; voce: string; tipo: string; ore: number; stato: string }

/** Ferie (F01) o Permesso (F02/F03): come lo legge il dipendente. */
export function voceRichiesta(giorni: GiornoRichiesta[]): 'Ferie' | 'Permesso' | 'Ferie e permesso' {
  const ferie = giorni.some((g) => g.voce === 'F01')
  const perm = giorni.some((g) => g.voce !== 'F01')
  return ferie && perm ? 'Ferie e permesso' : ferie ? 'Ferie' : 'Permesso'
}

/** «2 giornate», «1 giornata e mezza», «mezza giornata», «2,00 ore». Un giorno con due voci conta una volta. */
export function quantoRichiesta(giorni: GiornoRichiesta[]): string {
  const perData = new Map<string, { tipi: Set<string>; ore: number }>()
  for (const g of giorni) {
    const x = perData.get(g.data) ?? { tipi: new Set<string>(), ore: 0 }
    x.tipi.add(g.tipo); x.ore += Number(g.ore)
    perData.set(g.data, x)
  }
  let mezze = 0; let intere = 0; let ore = 0
  for (const x of perData.values()) {
    if (x.tipi.has('giornata')) intere++
    else if (x.tipi.has('mezza_giornata')) mezze++
    else ore += x.ore
  }
  const parti: string[] = []
  const gg = intere + mezze / 2
  if (gg > 0) {
    const interi = Math.floor(gg)
    const mezzo = gg - interi >= 0.5
    if (interi === 0) parti.push('mezza giornata')
    else parti.push(`${interi} ${interi === 1 ? 'giornata' : 'giornate'}${mezzo ? ' e mezza' : ''}`)
  }
  if (ore > 0.005) parti.push(oreDaMinuti(Math.round(ore * 60)))
  return parti.join(' e ') || 'nessuna'
}

export interface GiornoPianificato { data: string; voce: 'Ferie' | 'Permesso'; tipo: string; ore: number; approvato: boolean }

/** I giorni di ferie e permesso da oggi in poi, chiesti o approvati, in ordine di data. */
export function giorniPianificati(
  richieste: { stato: string; giorni: GiornoRichiesta[] | null }[],
  oggi: string,
): GiornoPianificato[] {
  const out: GiornoPianificato[] = []
  for (const r of richieste) {
    if (!['inviata', 'approvata', 'approvata_parziale', 'chiusa'].includes(r.stato)) continue
    for (const g of r.giorni ?? []) {
      if (g.data < oggi || g.stato === 'respinto') continue
      const approvato = r.stato !== 'inviata' && g.stato === 'approvato'
      if (r.stato !== 'inviata' && !approvato) continue
      out.push({ data: g.data, voce: g.voce === 'F01' ? 'Ferie' : 'Permesso', tipo: g.tipo, ore: Number(g.ore), approvato })
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data))
}

/** «circa 13 giornate e mezza» da ore e ore per giornata. */
export function giornateCirca(ore: number, giornata: number | null): string | null {
  if (!giornata || giornata <= 0 || ore <= 0.005) return null
  const gg = Math.round((ore / giornata) * 2) / 2
  const interi = Math.floor(gg)
  const mezzo = gg - interi >= 0.5
  if (interi === 0) return mezzo ? 'circa mezza giornata' : null
  return `circa ${interi} ${interi === 1 ? 'giornata' : 'giornate'}${mezzo ? ' e mezza' : ''}`
}
