// ─────────────────────────────────────────────────────────────────────────────
// MOTORE DI SIMULAZIONE DEL FABBISOGNO DI CASSA
//
// Risponde alla domanda operativa: «alla data X ho una serie di uscite
// obbligate e una disponibilità limitata: cosa riesco a pagare, cosa resta
// fuori, quanto mi manca?».
//
// Il modello è una CASCATA A PRIORITÀ. Le uscite sono raggruppate in fasce
// (stipendi, merci, affitti, fiscali, altro); la disponibilità viene assorbita
// fascia per fascia nell'ordine scelto: la prima prende quello che le serve,
// alla seconda resta il residuo, e così via. Quello che resta scoperto è il
// fabbisogno, cioè la finanza aggiuntiva da procurarsi (fido, anticipo,
// dilazione concordata) o il debito da rinviare.
//
// Tutte le funzioni qui sono PURE: nessuna chiamata a Supabase, nessuna data
// "adesso" implicita. Così sono testabili e la pagina resta un guscio sottile.
// ─────────────────────────────────────────────────────────────────────────────

/** Fasce di priorità del modello. L'ordine di default è quello richiesto:
 *  prima gli stipendi, poi le merci, poi gli affitti, poi il resto. */
export type FasciaKey = 'stipendi' | 'merci' | 'affitti' | 'fiscali' | 'altro'

export const FASCE_ORDINE_DEFAULT: FasciaKey[] = ['stipendi', 'merci', 'affitti', 'fiscali', 'altro']

export const FASCIA_LABEL: Record<FasciaKey, string> = {
  stipendi: 'Stipendi',
  merci: 'Merci',
  affitti: 'Affitti',
  fiscali: 'Imposte e contributi',
  altro: 'Altri fornitori',
}

export interface FasciaInput {
  key: FasciaKey
  /** Totale dovuto entro la data orizzonte. */
  importo: number
  /** Quota di `importo` che esce comunque (RiBa, SDD, addebiti su carta):
   *  non è discrezionale, quindi va evidenziata anche se la fascia è in fondo
   *  alla lista delle priorità. */
  automatico?: number
}

export interface FasciaEsito {
  key: FasciaKey
  importo: number
  automatico: number
  /** Quanto la disponibilità riesce a coprire di questa fascia. */
  pagato: number
  /** Quanto resta da pagare dopo la cascata. */
  scoperto: number
  /** 0-100, quota coperta della fascia (100 se la fascia è a zero). */
  coperturaPct: number
}

export interface SimulazioneInput {
  /** Saldo dei conti a oggi. */
  liquiditaIniziale: number
  /** Incassi attesi da oggi alla data orizzonte. */
  incassiAttesi: number
  /** Fido/scoperto di conto utilizzabile. 0 se non lo si vuole considerare. */
  fidoDisponibile?: number
  fasce: FasciaInput[]
  /** Ordine di priorità. Le fasce non elencate finiscono in coda, nell'ordine
   *  in cui compaiono in `fasce`. */
  ordine?: FasciaKey[]
}

export interface SimulazioneEsito {
  /** liquidità + incassi + fido. */
  disponibilita: number
  /** Le fasce nell'ordine di priorità applicato. */
  fasce: FasciaEsito[]
  totaleUscite: number
  totalePagato: number
  /** Quanto manca per pagare tutto: è il fabbisogno da coprire. 0 se si copre tutto. */
  fabbisogno: number
  /** Cassa che avanza dopo aver pagato tutto (0 se c'è fabbisogno). */
  cassaResidua: number
  /** Quota di uscite non rinviabili (RiBa/SDD/carte) che resta scoperta:
   *  è la parte di fabbisogno che non si può rimandare trattando col fornitore. */
  scopertoNonRinviabile: number
}

const pos = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0)
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Applica la cascata a priorità e restituisce l'esito completo.
 *
 * Nota sulla quota non rinviabile: quando una fascia è coperta solo in parte,
 * si assume che il pagamento vada PRIMA agli addebiti automatici (che escono
 * comunque dal conto) e solo dopo al resto. È il comportamento reale: la RiBa
 * viene addebitata alla scadenza, non la si può mettere in coda.
 */
export function simulaFabbisogno(input: SimulazioneInput): SimulazioneEsito {
  const disponibilita = round2(
    pos(input.liquiditaIniziale) + pos(input.incassiAttesi) + pos(input.fidoDisponibile ?? 0),
  )

  const ordine = input.ordine && input.ordine.length ? input.ordine : FASCE_ORDINE_DEFAULT
  const rank = new Map<FasciaKey, number>(ordine.map((k, i) => [k, i]))
  const ordinate = [...input.fasce].sort((a, b) => {
    const ra = rank.has(a.key) ? (rank.get(a.key) as number) : Number.MAX_SAFE_INTEGER
    const rb = rank.has(b.key) ? (rank.get(b.key) as number) : Number.MAX_SAFE_INTEGER
    return ra - rb
  })

  let residuo = disponibilita
  const fasce: FasciaEsito[] = ordinate.map(f => {
    const importo = round2(pos(f.importo))
    const automatico = Math.min(round2(pos(f.automatico ?? 0)), importo)
    const pagato = round2(Math.min(importo, residuo))
    residuo = round2(residuo - pagato)
    const scoperto = round2(importo - pagato)
    return {
      key: f.key,
      importo,
      automatico,
      pagato,
      scoperto,
      coperturaPct: importo > 0 ? round2((pagato / importo) * 100) : 100,
    }
  })

  const totaleUscite = round2(fasce.reduce((s, f) => s + f.importo, 0))
  const totalePagato = round2(fasce.reduce((s, f) => s + f.pagato, 0))
  const fabbisogno = round2(Math.max(0, totaleUscite - totalePagato))
  // Il pagato copre prima gli addebiti automatici della fascia: scoperto
  // non rinviabile = quanto di `automatico` resta fuori dal pagato.
  const scopertoNonRinviabile = round2(
    fasce.reduce((s, f) => s + Math.max(0, f.automatico - f.pagato), 0),
  )

  return {
    disponibilita,
    fasce,
    totaleUscite,
    totalePagato,
    fabbisogno,
    cassaResidua: round2(Math.max(0, disponibilita - totaleUscite)),
    scopertoNonRinviabile,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROIEZIONE GIORNALIERA
// La cascata dice QUANTO manca; la proiezione dice QUANDO la cassa va sotto.
// ─────────────────────────────────────────────────────────────────────────────

export interface UscitaDatata {
  /** 'YYYY-MM-DD'. Le uscite già scadute vanno passate con la data di inizio. */
  data: string
  importo: number
  key: FasciaKey
}

export interface GiornoProiezione {
  data: string
  incassi: number
  uscite: number
  /** Saldo di fine giornata, cumulato dall'inizio del periodo. */
  saldo: number
}

export interface ProiezioneInput {
  /** 'YYYY-MM-DD' inclusa. */
  dataInizio: string
  /** 'YYYY-MM-DD' inclusa. */
  dataFine: string
  saldoIniziale: number
  /** Incasso medio atteso per ogni giorno del periodo. */
  incassoGiornaliero: number
  uscite: UscitaDatata[]
}

const MS_GIORNO = 86_400_000

/** Somma `n` giorni a una data 'YYYY-MM-DD' restando in fuso locale. */
export function addDaysYMD(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00')
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Giorni di calendario tra due date 'YYYY-MM-DD' (fine - inizio). */
export function diffGiorni(dataInizio: string, dataFine: string): number {
  const a = new Date(dataInizio + 'T00:00:00').getTime()
  const b = new Date(dataFine + 'T00:00:00').getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / MS_GIORNO)
}

/**
 * Costruisce il saldo giorno per giorno. Le uscite datate PRIMA dell'inizio
 * (arretrato scaduto) vengono caricate tutte sul primo giorno: è denaro già
 * dovuto, non una scadenza futura.
 */
export function proiezioneGiornaliera(input: ProiezioneInput): GiornoProiezione[] {
  const giorni = diffGiorni(input.dataInizio, input.dataFine)
  if (giorni < 0) return []

  const perGiorno = new Map<string, number>()
  for (const u of input.uscite) {
    const d = String(u.data || '').slice(0, 10)
    if (!d) continue
    const chiave = d < input.dataInizio ? input.dataInizio : d
    if (chiave > input.dataFine) continue
    perGiorno.set(chiave, round2((perGiorno.get(chiave) || 0) + pos(u.importo)))
  }

  const out: GiornoProiezione[] = []
  let saldo = input.saldoIniziale
  for (let i = 0; i <= giorni; i++) {
    const data = addDaysYMD(input.dataInizio, i)
    const incassi = round2(pos(input.incassoGiornaliero))
    const uscite = perGiorno.get(data) || 0
    saldo = round2(saldo + incassi - uscite)
    out.push({ data, incassi, uscite, saldo })
  }
  return out
}

/** Primo giorno in cui il saldo proiettato va sotto zero, null se non accade. */
export function primoGiornoNegativo(proiezione: GiornoProiezione[]): string | null {
  const g = proiezione.find(p => p.saldo < 0)
  return g ? g.data : null
}

/** Punto di minimo della proiezione (il giorno peggiore). */
export function saldoMinimo(proiezione: GiornoProiezione[]): GiornoProiezione | null {
  if (!proiezione.length) return null
  return proiezione.reduce((min, p) => (p.saldo < min.saldo ? p : min), proiezione[0])
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICAZIONE DELLE USCITE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mappa una riga di scadenzario sulla fascia di priorità, a partire dal
 * macro_group della categoria di costo (piano dei conti del tenant).
 * Le righe senza categoria finiscono in «altri fornitori»: sono da
 * classificare, non da ignorare.
 */
export function fasciaDaMacroGroup(macroGroup: string | null | undefined): FasciaKey {
  switch ((macroGroup || '').trim()) {
    case 'personale':
      return 'stipendi'
    case 'costo_venduto':
      return 'merci'
    case 'locazione':
      return 'affitti'
    default:
      return 'altro'
  }
}

/** Metodi di pagamento che escono dal conto senza una disposizione manuale. */
const METODI_AUTOMATICI = new Set([
  'riba_30', 'riba_60', 'riba_90', 'riba_120', 'riba',
  'sdd_core', 'sdd_b2b', 'rid',
  'carta_credito', 'carta_debito',
])

/** true se il pagamento è un addebito automatico (non rinviabile a trattativa). */
export function isPagamentoAutomatico(
  paymentMethod: string | null | undefined,
  isAutoDebit?: boolean | null,
): boolean {
  if (isAutoDebit) return true
  return METODI_AUTOMATICI.has((paymentMethod || '').trim())
}

// ─────────────────────────────────────────────────────────────────────────────
// RIPARTIZIONE DEL PAGATO SULLE SINGOLE RIGHE
// Serve alla lista «cosa resta fuori»: dentro una fascia coperta solo in parte
// bisogna decidere QUALI righe si pagano.
// ─────────────────────────────────────────────────────────────────────────────

export interface RigaUscita {
  id: string
  key: FasciaKey
  descrizione: string
  fornitore: string
  documento: string | null
  scadenza: string | null
  importo: number
  automatico: boolean
  /** Rotta interna dove la riga si gestisce davvero (Scadenzario, Scadenze
   *  fiscali, Dipendenti). Il motore la trasporta senza leggerla: serve alla
   *  UI per portare l'utente dalla riga scoperta all'azione. */
  link?: string | null
}

export interface RigaRipartita extends RigaUscita {
  pagato: number
  scoperto: number
}

/**
 * Distribuisce l'importo pagabile di una fascia sulle sue righe.
 * Criterio: prima gli addebiti automatici (escono comunque dal conto), poi le
 * scadenze più vecchie. A parità di data, prima gli importi piccoli: chiudono
 * più posizioni con la stessa cassa e riducono il numero di fornitori esposti.
 */
export function ripartisciSuRighe(righe: RigaUscita[], pagabile: number): RigaRipartita[] {
  const ordinate = [...righe].sort((a, b) => {
    if (a.automatico !== b.automatico) return a.automatico ? -1 : 1
    const da = a.scadenza || '9999-12-31'
    const db = b.scadenza || '9999-12-31'
    if (da !== db) return da < db ? -1 : 1
    return a.importo - b.importo
  })
  let residuo = pos(pagabile)
  return ordinate.map(r => {
    const importo = round2(pos(r.importo))
    const pagato = round2(Math.min(importo, residuo))
    residuo = round2(residuo - pagato)
    return { ...r, importo, pagato, scoperto: round2(importo - pagato) }
  })
}
