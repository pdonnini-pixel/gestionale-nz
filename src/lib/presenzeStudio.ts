// Presenze del mese per lo studio paghe (Studio Signorini, mail del 18/11/2026).
//
// Ogni mese il gestionale produce un file Excel con le presenze di tutti i
// dipendenti, giorno per giorno, divise per causale, con la stessa struttura del
// modello di novembre 2026 mandato dallo studio (RILXLS_071041_11-2026.xls).
// Qui ci sono solo i conti, senza rete: la pagina carica i dati e chiama
// `presenzeDelMese`, poi `foglioStudio` per le righe del file.
//
// Regole dello studio (citate dalla mail):
//  - giorni feriali lavorati: le ore nelle ore ordinarie; giorno di riposo: cella vuota;
//  - domenica lavorata: stesse ore in «Lavoro domenicale (LDM)» e nelle ore ordinarie;
//  - festivo: «F» nelle ore ordinarie; se quel giorno la persona lavorava, le ore in LFS
//    (anche di domenica: allora LDM resta vuota);
//  - assenze a giornata (ferie, malattia, maternità...): le ore teoriche nella riga della
//    causale, ore ordinarie vuote; nei riposi dentro il periodo di assenza si scrive 0;
//  - prima dell'assunzione e dopo la cessazione: «AH» con le ore teoriche del calendario,
//    0 nei riposi;
//  - a chiamata: 1 nella riga LC nei giorni del rapporto non lavorati, le ore nelle
//    ordinarie nei giorni lavorati;
//  - straordinario: full time sempre ST; part time LS fino alle 40 ore della settimana,
//    oltre le 40 ST;
//  - le ore si scrivono come numeri ore,minuti: la mezz'ora è 0,30 (7 ore e mezza = 7,30).
//
// Da dove vengono i dati:
//  - ore lavorate: i turni ufficiali (la stessa regola di `timbrature_turni_ufficiali`,
//    migration 395: del piano scelto solo i pubblicati; senza piano scelto i pubblicati o
//    messi a mano), corretti con i casi confermati delle timbrature (uscite e pause senza
//    permesso tolte, malattia in MA, straordinari aggiunti);
//  - ferie e permessi approvati: F01 -> FE, F02 -> PF, F03 -> RL;
//  - assenze lunghe dell'organico (employee_events): maternità -> MT, malattia -> MA;
//  - festivi nazionali più il patrono del negozio (outlets.festa_patrono, migration 466).
//
// Le ore teoriche del calendario, quando il turno non c'è, sono le ore settimanali
// divise per 5 dal lunedì al venerdì e 0 il sabato e la domenica: è il calendario che
// lo studio usa nel modello (AH e MT di novembre). In attesa della conferma dello studio.

import { festivitaItaliane } from './ferieRichiesta'

// ─── Righe del file ─────────────────────────────────────────────────────

export type CodiceRiga = 'ORD' | 'AH' | 'LC' | 'LDM' | 'FE' | 'LFS' | 'LNM' | 'LS' | 'M2' | 'M9' | 'MA' | 'MF' | 'MT' | 'PF' | 'RL' | 'ST'

/** Etichette esattamente come nel modello dello studio (apostrofi compresi). */
export const ETICHETTA_RIGA: Record<CodiceRiga, string> = {
  ORD: 'Ore ordinarie',
  AH: 'Assenza assunti/dimessi (AH)',
  LC: 'Assenza lavoratori a chiamata (LC)',
  LDM: 'Lavoro domenicale (LDM)',
  FE: 'Ferie (FE)',
  LFS: 'Lavoro festivo (LFS)',
  LNM: 'Lavoro notturno (LNM)',
  LS: 'Supplementare diurno (LS)',
  M2: 'Cong.parentale a HH da 7 a 9 mesi (M2)',
  M9: 'Congedo parentale 80% a giorni (M9)',
  MA: 'Malattia (MA)',
  MF: 'Cong.parentale a GG entro 6 mesi (MF)',
  MT: "Maternita' obbligatoria (MT)",
  PF: "Permessi ex festivita' (PF)",
  RL: 'Riduzione orario di lavoro (RL)',
  ST: 'Straordinario diurno (ST)',
}

/** Ordine del modello. AH, LC e LDM compaiono solo se la persona ha almeno un valore. */
export const ORDINE_RIGHE: CodiceRiga[] = ['ORD', 'AH', 'LC', 'LDM', 'FE', 'LFS', 'LNM', 'LS', 'M2', 'M9', 'MA', 'MF', 'MT', 'PF', 'RL', 'ST']
const RIGHE_FACOLTATIVE: CodiceRiga[] = ['AH', 'LC', 'LDM']

/** Ore (decimali) o «F». null = cella vuota. */
export type Cella = number | 'F' | null

// ─── Dati in ingresso ───────────────────────────────────────────────────

export interface PersonaStudio {
  id: string
  matricola: string
  cognome: string
  nome: string
  assunzione: string | null
  cessazione: string | null
  oreSettimanali: number | null
  /** contratto_tipo dell'anagrafica: 'a_chiamata' attiva le regole LC */
  contratto: string | null
  outletId: string | null
}

export interface TurnoStudio {
  employee_id: string
  data: string
  inizio: string
  fine: string
  /** pausa non pagata, già tolta dalle ore (shifts.pausa_minuti) */
  pausa_minuti: number | null
  /** ore di straordinario segnate sul turno (shifts.ore_straordinario) */
  ore_straordinario: number | null
}

export interface GiornoAssenzaStudio {
  employee_id: string
  data: string
  /** F01 ferie, F02 permessi ex festività, F03 ROL */
  voce: string
  tipo: string
  ore: number
}

export interface AssenzaLungaStudio {
  employee_id: string
  motivo: string | null
  dal: string
  al: string | null
}

export interface EventoStudio {
  employee_id: string
  data: string
  tipo: string
  esito: string | null
  /** minuti confermati (o proposti se la conferma non li ha cambiati) */
  minuti: number
}

export interface DatiStudio {
  /** 'YYYY-MM' */
  mese: string
  persone: PersonaStudio[]
  /** turni ufficiali da lunedì della prima settimana a fine mese (servono le 40 ore della settimana) */
  turni: TurnoStudio[]
  /** solo giorni approvati */
  assenze: GiornoAssenzaStudio[]
  assenzeLunghe: AssenzaLungaStudio[]
  /** solo casi confermati */
  eventi: EventoStudio[]
  /** negozio -> 'MM-DD' della festa del patrono */
  patroni: Map<string, string>
}

export interface PresenzePersona {
  persona: PersonaStudio
  righe: Map<CodiceRiga, Cella[]>
  /** giorni in cui le ore vengono solo dal turno, senza timbrature confermate */
  avvisi: string[]
}

export interface EsitoStudio {
  giorni: string[]
  persone: PresenzePersona[]
  /** cose che il file non può dire e che vanno guardate prima dell'invio */
  avvisi: string[]
}

// ─── Utilità di calendario ──────────────────────────────────────────────

const NOMI_MESE = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
const SIGLE_GIORNO = ['Do', 'Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa']

export function giorniDelMese(mese: string): string[] {
  const [a, m] = mese.split('-').map(Number)
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${mese}-${String(i + 1).padStart(2, '0')}`)
}

/** 0 = domenica ... 6 = sabato */
function giornoSettimana(d: string): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay()
}

function piuGiorni(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** Lunedì della settimana che contiene il primo del mese: da lì servono i turni. */
export function inizioCaricamento(mese: string): string {
  const primo = `${mese}-01`
  const g = giornoSettimana(primo)
  return piuGiorni(primo, -((g + 6) % 7))
}

export function titoloMese(mese: string): string {
  return `${NOMI_MESE[Number(mese.slice(5, 7))]} ${mese.slice(0, 4)}`
}

/** Ore decimali nel formato dello studio: ore,minuti (7,5 -> 7,30). */
export function oreMinuti(ore: number): number {
  const min = Math.round(ore * 60)
  return Math.floor(min / 60) + (min % 60) / 100
}

function minutiDa(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

function oreTurno(t: TurnoStudio): number {
  return Math.max(0, minutiDa(t.fine) - minutiDa(t.inizio) - (t.pausa_minuti ?? 0)) / 60
}

function ddmmyyyy(d: string | null): string {
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''
}

const RIGA_VOCE: Record<string, CodiceRiga> = { F01: 'FE', F02: 'PF', F03: 'RL' }

/** Motivo libero dell'assenza lunga -> riga dello studio. null = nessuna riga nel modello. */
export function rigaAssenzaLunga(motivo: string | null): CodiceRiga | null {
  const t = (motivo ?? '').toLowerCase()
  if (t.includes('maternit')) return 'MT'
  if (t.includes('malatti')) return 'MA'
  return null
}

const arrotonda = (n: number) => Math.round(n * 100) / 100

// ─── Il conto ───────────────────────────────────────────────────────────

export function presenzeDelMese(dati: DatiStudio): EsitoStudio {
  const giorni = giorniDelMese(dati.mese)
  const primo = giorni[0]
  const ultimo = giorni[giorni.length - 1]
  const dalCarico = inizioCaricamento(dati.mese)
  const festeNaz = { ...festivitaItaliane(Number(dati.mese.slice(0, 4))), ...festivitaItaliane(Number(dalCarico.slice(0, 4))) }
  const avvisi: string[] = []

  const perPersona = <T extends { employee_id: string }>(xs: T[]) => {
    const m = new Map<string, T[]>()
    for (const x of xs) { const l = m.get(x.employee_id); if (l) l.push(x); else m.set(x.employee_id, [x]) }
    return m
  }
  const turniDi = perPersona(dati.turni)
  const assenzeDi = perPersona(dati.assenze)
  const lungheDi = perPersona(dati.assenzeLunghe)
  const eventiDi = perPersona(dati.eventi)

  const aspettative = new Set<string>()
  const senzaOre: string[] = []
  const persone: PresenzePersona[] = []

  for (const p of [...dati.persone].sort((a, b) => a.matricola.localeCompare(b.matricola, 'it', { numeric: true }))) {
    const chiamata = p.contratto === 'a_chiamata'
    const oreSett = p.oreSettimanali ?? 0
    if (!p.oreSettimanali && !chiamata) senzaOre.push(`${p.cognome} ${p.nome}`)
    const patrono = p.outletId ? dati.patroni.get(p.outletId) : undefined
    const festivo = (d: string) => !!festeNaz[d] || (!!patrono && d.slice(5) === patrono)
    const teoricoCalendario = (d: string) => { const g = giornoSettimana(d); return g >= 1 && g <= 5 ? oreSett / 5 : 0 }
    const inForza = (d: string) => (!p.assunzione || d >= p.assunzione) && (!p.cessazione || d <= p.cessazione)

    // ore per giorno, da lunedì della prima settimana a fine mese
    const ore = new Map<string, number>()
    const extraTurno = new Map<string, number>()
    for (const t of turniDi.get(p.id) ?? []) {
      ore.set(t.data, (ore.get(t.data) ?? 0) + oreTurno(t))
      if (t.ore_straordinario) extraTurno.set(t.data, (extraTurno.get(t.data) ?? 0) + Number(t.ore_straordinario))
    }
    const assenzeGiorno = new Map<string, GiornoAssenzaStudio[]>()
    for (const a of assenzeDi.get(p.id) ?? []) { const l = assenzeGiorno.get(a.data); if (l) l.push(a); else assenzeGiorno.set(a.data, [a]) }
    const togliMin = new Map<string, number>()
    const malattiaMin = new Map<string, number>()
    const extraMin = new Map<string, number>()
    for (const e of eventiDi.get(p.id) ?? []) {
      if (e.tipo === 'straordinario' && e.esito === 'straordinario') extraMin.set(e.data, (extraMin.get(e.data) ?? 0) + e.minuti)
      else if ((e.tipo === 'uscita_anticipata' || e.tipo === 'pausa_lunga') && (e.esito === 'ore_non_lavorate' || e.esito === 'malattia')) {
        togliMin.set(e.data, (togliMin.get(e.data) ?? 0) + e.minuti)
        if (e.esito === 'malattia') malattiaMin.set(e.data, (malattiaMin.get(e.data) ?? 0) + e.minuti)
      }
    }
    const lungaDel = (d: string) => (lungheDi.get(p.id) ?? []).find((l) => d >= l.dal && (!l.al || d <= l.al))

    const righe = new Map<CodiceRiga, Cella[]>(ORDINE_RIGHE.map((c) => [c, giorni.map(() => null)]))
    const metti = (c: CodiceRiga, i: number, v: Cella) => { righe.get(c)![i] = v }
    const somma = (c: CodiceRiga, i: number, v: number) => { const r = righe.get(c)!; r[i] = arrotonda(((r[i] as number | null) ?? 0) + v) }

    // giorno -> voce dell'assenza a giornata (per lo 0 nei riposi dentro il periodo)
    const giornataDi = new Map<string, CodiceRiga>()

    // settimana per settimana: le 40 ore valgono da lunedì a domenica
    let lavorateSettimana = 0
    for (let d = dalCarico; d <= ultimo; d = piuGiorni(d, 1)) {
      if (giornoSettimana(d) === 1) lavorateSettimana = 0
      const nelMese = d >= primo
      const i = nelMese ? giorni.indexOf(d) : -1
      const fest = festivo(d)

      if (!inForza(d)) {
        if (!nelMese) continue
        if (chiamata) { metti('AH', i, 1); continue }
        if (fest) metti('ORD', i, 'F')
        metti('AH', i, arrotonda(teoricoCalendario(d)))
        continue
      }

      const lunga = lungaDel(d)
      if (lunga) {
        const r = rigaAssenzaLunga(lunga.motivo)
        if (!nelMese) continue
        if (!r) { aspettative.add(`${p.cognome} ${p.nome} (${lunga.motivo ?? 'senza motivo'})`); continue }
        if (fest) { metti('ORD', i, 'F'); metti(r, i, 0) }
        else metti(r, i, arrotonda(teoricoCalendario(d)))
        continue
      }

      const turno = ore.get(d) ?? 0
      const extraTot = (extraTurno.get(d) ?? 0) + (extraMin.get(d) ?? 0) / 60
      const lista = assenzeGiorno.get(d) ?? []
      const aGiornata = lista.find((a) => a.tipo === 'giornata')
      // a giornata vale l'assenza anche se è rimasto un turno: ordinarie vuote, come vuole lo studio
      if (aGiornata) {
        if (nelMese) {
          const r = RIGA_VOCE[aGiornata.voce] ?? 'FE'
          if (fest) metti('ORD', i, 'F')
          somma(r, i, aGiornata.ore)
          giornataDi.set(d, r)
        }
        continue
      }
      const oreOrarie = lista.reduce((s, a) => s + Number(a.ore || 0), 0)
      const ordinarie = Math.max(0, turno - (extraTurno.get(d) ?? 0) - oreOrarie - (togliMin.get(d) ?? 0) / 60)

      // straordinario: full time tutto ST; part time LS fino alle 40 ore della settimana
      lavorateSettimana += ordinarie
      let ls = 0
      let st = extraTot
      if (p.oreSettimanali != null && oreSett < 40 && !chiamata) { ls = Math.min(extraTot, Math.max(0, 40 - lavorateSettimana)); st = extraTot - ls }
      lavorateSettimana += extraTot
      if (!nelMese) continue

      for (const a of lista) somma(RIGA_VOCE[a.voce] ?? 'PF', i, Number(a.ore || 0))
      if (malattiaMin.get(d)) somma('MA', i, malattiaMin.get(d)! / 60)
      if (ls > 0) somma('LS', i, ls)
      if (st > 0) somma('ST', i, st)

      if (fest) {
        if (chiamata) { if (ordinarie > 0) metti('ORD', i, arrotonda(ordinarie)); else metti('LC', i, 1); continue }
        metti('ORD', i, 'F')
        if (ordinarie > 0) somma('LFS', i, ordinarie)
        continue
      }
      if (ordinarie > 0) {
        metti('ORD', i, arrotonda(ordinarie))
        if (giornoSettimana(d) === 0) metti('LDM', i, arrotonda(ordinarie))
      } else if (chiamata) {
        metti('LC', i, 1)
      }
    }

    // riposi dentro un periodo di assenza a giornata: 0 nella riga della causale
    for (let i = 0; i < giorni.length; i++) {
      const d = giorni[i]
      if (giornataDi.has(d) || !inForza(d) || righe.get('ORD')![i] !== null || lungaDel(d)) continue
      let prima: CodiceRiga | undefined
      for (let k = i - 1; k >= 0; k--) { if (giornataDi.has(giorni[k])) { prima = giornataDi.get(giorni[k]); break } if (righe.get('ORD')![k] !== null) break }
      let dopo: CodiceRiga | undefined
      for (let k = i + 1; k < giorni.length; k++) { if (giornataDi.has(giorni[k])) { dopo = giornataDi.get(giorni[k]); break } if (righe.get('ORD')![k] !== null) break }
      if (prima && prima === dopo && righe.get(prima)![i] === null) metti(prima, i, 0)
    }

    const avvisiPersona: string[] = []
    const lavorati = giorni.filter((d) => (ore.get(d) ?? 0) > 0 && inForza(d)).length
    if (!lavorati && !chiamata && giorni.some((d) => inForza(d) && !lungaDel(d) && !assenzeGiorno.get(d)?.length)) avvisiPersona.push('nessun turno ufficiale nel mese')
    persone.push({ persona: p, righe, avvisi: avvisiPersona })
  }

  if (senzaOre.length) avvisi.push(`Ore settimanali mancanti in anagrafica (servono per le ore teoriche): ${[...new Set(senzaOre)].join(', ')}.`)
  if (aspettative.size) avvisi.push(`Assenze lunghe senza una riga nel modello dello studio, lasciate vuote: ${[...aspettative].join(', ')}.`)
  const senzaTurni = persone.filter((x) => x.avvisi.length).map((x) => `${x.persona.cognome} ${x.persona.nome}`)
  if (senzaTurni.length) avvisi.push(`Senza turni ufficiali nel mese, quindi senza ore ordinarie: ${[...new Set(senzaTurni)].join(', ')}.`)
  return { giorni, persone, avvisi }
}

// ─── Il foglio ──────────────────────────────────────────────────────────

export interface Intestazione {
  codice: string
  ragioneSociale: string
}

/**
 * Righe del foglio, cella per cella, come il modello: tre righe di testata, poi un
 * blocco per persona separato da una riga vuota (nessuna riga vuota dopo l'ultimo).
 * Le ore sono già nel formato ore,minuti.
 */
export function foglioStudio(esito: EsitoStudio, mese: string, int: Intestazione): (string | number | null)[][] {
  const vuoto = () => Array<string | number | null>(6 + esito.giorni.length).fill(null)
  const t0 = vuoto(); t0[0] = 'Azienda'; t0[1] = int.codice; t0[2] = int.ragioneSociale; t0[6] = titoloMese(mese)
  const t1 = vuoto(); t1[3] = 'Assunzione'; t1[4] = 'Cessazione'; t1[5] = 'Ore/Minuti'
  const t2 = vuoto()
  esito.giorni.forEach((d, i) => { t1[6 + i] = i + 1; t2[6 + i] = SIGLE_GIORNO[giornoSettimana(d)] })
  const out = [t0, t1, t2]
  esito.persone.forEach((pp, n) => {
    if (n > 0) out.push(vuoto())
    let primaRiga = true
    for (const c of ORDINE_RIGHE) {
      const celle = pp.righe.get(c)!
      if (RIGHE_FACOLTATIVE.includes(c) && celle.every((v) => v === null)) continue
      const r = vuoto()
      if (primaRiga) {
        r[0] = 'Dipendente'; r[1] = pp.persona.matricola; r[2] = `${pp.persona.cognome} ${pp.persona.nome}`.trim()
        r[3] = ddmmyyyy(pp.persona.assunzione); r[4] = ddmmyyyy(pp.persona.cessazione)
        primaRiga = false
      }
      r[5] = ETICHETTA_RIGA[c]
      celle.forEach((v, i) => { r[6 + i] = v === null ? null : v === 'F' ? 'F' : oreMinuti(v) })
      out.push(r)
    }
  })
  return out
}

/** Nome del file come quello dello studio: RILXLS_<codice>_<mm>-<aaaa>.xls */
export function nomeFileStudio(codice: string, mese: string): string {
  return `RILXLS_${codice || 'azienda'}_${mese.slice(5, 7)}-${mese.slice(0, 4)}.xls`
}

// ─── Turni ufficiali ────────────────────────────────────────────────────

export interface TurnoGrezzo {
  employee_id: string
  outlet_id: string
  data: string
  stato: string
  origine: string | null
  plan_id: string | null
}

/**
 * Quali turni valgono per le presenze: la stessa regola di `timbrature_turni_ufficiali`
 * (migration 395). Del piano scelto del mese solo i pubblicati; senza piano scelto i turni
 * senza piano pubblicati o messi a mano. Gli annullati mai.
 */
export function turniUfficiali<T extends TurnoGrezzo>(turni: T[], pianiScelti: { id: string; outlet_id: string; mese: string }[]): T[] {
  const scelto = new Map(pianiScelti.map((p) => [`${p.outlet_id}|${p.mese.slice(0, 7)}`, p.id]))
  return turni.filter((s) => {
    if (s.stato === 'annullato') return false
    const pid = scelto.get(`${s.outlet_id}|${s.data.slice(0, 7)}`)
    if (pid) return s.plan_id === pid && s.stato === 'pubblicato'
    return !s.plan_id && (s.stato === 'pubblicato' || s.origine === 'manuale')
  })
}
