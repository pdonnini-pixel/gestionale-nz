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

// ─────────────────────────────────────────────────────────────────────────────
// PIANO «NON POSSO NON PAGARE»
//
// La cascata a priorità sopra è una regola generale. Qui invece comanda una
// decisione presa da chi tiene l'amministrazione: le voci spuntate sono
// obbligatorie, il resto è discrezionale. Il fabbisogno diventa la distanza fra
// quello che è stato deciso e quello che si avrà davvero in cassa.
// ─────────────────────────────────────────────────────────────────────────────

export interface PianoInput {
  righe: RigaUscita[]
  /** Chiavi (`RigaUscita.id`) delle voci marcate come obbligatorie a mano. */
  selezionati: ReadonlySet<string>
  /** Liquidità + incassi attesi + eventuale fido. */
  disponibilita: number
}

/**
 * Una riga è obbligatoria se è stata spuntata OPPURE se è un addebito
 * automatico: RiBa, SDD e addebiti su carta partono dal conto alla scadenza
 * senza che nessuno disponga niente, quindi la scelta non esiste. Restano
 * comunque visibili in elenco, marcate come tali.
 */
export function isObbligatoria(riga: RigaUscita, selezionati: ReadonlySet<string>): boolean {
  return riga.automatico || selezionati.has(riga.id)
}

export interface PianoEsito {
  /** Totale delle voci obbligatorie: spuntate più addebiti automatici. */
  obbligatorio: number
  /** Quota dell'obbligatorio che è addebito automatico, cioè già scalata
   *  d'ufficio senza che nessuno l'abbia spuntata. */
  obbligatorioAutomatico: number
  /** Totale delle voci rinviabili, cioè né spuntate né automatiche. */
  rinviabile: number
  /** Sempre 0: un addebito automatico non può essere rinviabile. Il campo
   *  resta per compatibilità con chi legge l'esito. */
  rinviabileAutomatico: number
  disponibilita: number
  /** Quanto manca per coprire l'obbligatorio. 0 se la cassa basta. */
  fabbisogno: number
  /** Cassa che resta dopo aver pagato tutto l'obbligatorio. */
  avanzo: number
  /** Quanto del rinviabile si riesce a pagare con l'avanzo. */
  rinviabileCoperto: number
  coperturaObbligatorioPct: number
  nSelezionate: number
  nTotali: number
}

/**
 * Confronta l'obbligatorio con la disponibilità. Nessuna priorità implicita:
 * l'unica gerarchia è obbligatorio (spuntato o automatico) contro rinviabile.
 */
export function calcolaPiano(input: PianoInput): PianoEsito {
  let obbligatorio = 0
  let obbligatorioAutomatico = 0
  let rinviabile = 0
  const rinviabileAutomatico = 0
  let nSelezionate = 0

  for (const r of input.righe) {
    const importo = pos(r.importo)
    if (isObbligatoria(r, input.selezionati)) {
      obbligatorio += importo
      if (r.automatico) obbligatorioAutomatico += importo
      nSelezionate++
    } else {
      rinviabile += importo
    }
  }

  obbligatorio = round2(obbligatorio)
  rinviabile = round2(rinviabile)
  const disponibilita = round2(pos(input.disponibilita))
  const fabbisogno = round2(Math.max(0, obbligatorio - disponibilita))
  const avanzo = round2(Math.max(0, disponibilita - obbligatorio))

  return {
    obbligatorio,
    obbligatorioAutomatico: round2(obbligatorioAutomatico),
    rinviabile,
    rinviabileAutomatico: round2(rinviabileAutomatico),
    disponibilita,
    fabbisogno,
    avanzo,
    rinviabileCoperto: round2(Math.min(rinviabile, avanzo)),
    coperturaObbligatorioPct: obbligatorio > 0 ? round2((Math.min(obbligatorio, disponibilita) / obbligatorio) * 100) : 100,
    nSelezionate,
    nTotali: input.righe.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INCASSI DEL MESE — obiettivo corretto ogni sera dai ricavi veri
//
// I negozi scaricano i ricavi ogni sera. Il ritmo effettivo di questo mese è
// quindi un dato, non una stima: si usa quello per i giorni che restano, mentre
// l'obiettivo mensile serve a dire se si è avanti o indietro.
// ─────────────────────────────────────────────────────────────────────────────

export interface IncassiMeseInput {
  /** Ricavi lordi già registrati dal primo del mese a oggi. */
  realizzato: number
  /** Giorni di calendario coperti dai dati (non le righe: i giorni distinti). */
  giorniRegistrati: number
  /** Giorni ancora da incassare, da domani alla data orizzonte compresa. */
  giorniResidui: number
  /** Obiettivo di ricavo del mese, per il confronto. */
  obiettivoMensile?: number | null
  /** Giorni totali del mese, per ripartire l'obiettivo. */
  giorniMese?: number | null
}

export interface IncassiMeseEsito {
  /** Media giornaliera effettiva del mese in corso. */
  ritmoGiornaliero: number
  /** Incassi attesi da domani alla data orizzonte. */
  attesiResidui: number
  /** Dove chiude il mese se il ritmo resta questo. */
  proiezioneMese: number
  /** Quota di obiettivo che sarebbe dovuta arrivare finora. */
  obiettivoAData: number | null
  /** Proiezione meno obiettivo: positivo = sopra obiettivo. */
  scostamento: number | null
  /** Quanto servirebbe incassare al giorno per chiudere in obiettivo. */
  passoRichiesto: number | null
}

/**
 * Il ritmo è la media dei giorni realmente registrati: se l'import serale salta
 * un giorno, quel giorno non abbassa la media (si dividerebbe per un giorno che
 * non ha dati, non per un giorno chiuso).
 */
export function previsioneIncassiMese(input: IncassiMeseInput): IncassiMeseEsito {
  const realizzato = round2(pos(input.realizzato))
  const giorniRegistrati = Math.max(0, Math.floor(input.giorniRegistrati))
  const giorniResidui = Math.max(0, Math.floor(input.giorniResidui))
  const ritmoGiornaliero = giorniRegistrati > 0 ? round2(realizzato / giorniRegistrati) : 0
  const attesiResidui = round2(ritmoGiornaliero * giorniResidui)

  const obiettivo = input.obiettivoMensile != null && input.obiettivoMensile > 0 ? input.obiettivoMensile : null
  const giorniMese = input.giorniMese && input.giorniMese > 0 ? input.giorniMese : null

  const obiettivoAData = obiettivo != null && giorniMese != null
    ? round2((obiettivo / giorniMese) * giorniRegistrati)
    : null

  const proiezioneMese = round2(realizzato + attesiResidui)

  return {
    ritmoGiornaliero,
    attesiResidui,
    proiezioneMese,
    obiettivoAData,
    scostamento: obiettivo != null ? round2(proiezioneMese - obiettivo) : null,
    passoRichiesto: obiettivo != null && giorniResidui > 0
      ? round2(Math.max(0, obiettivo - realizzato) / giorniResidui)
      : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COSTO DEL PERSONALE IN CASSA
//
// Il personale non esce in una volta sola: il netto in busta parte intorno al
// 10 del mese successivo a quello di competenza, mentre ritenute IRPEF e
// contributi partono col modello F24 il 16. Due uscite, due date, due voci.
//
// Le mensilità aggiuntive seguono lo stesso ritardo del mese di competenza:
// la quattordicesima matura a giugno e si paga col cedolino di giugno, la
// tredicesima si paga a dicembre, di norma prima di Natale.
// ─────────────────────────────────────────────────────────────────────────────

export interface CostoPersonaleMensile {
  /** Netti in busta dell'ultimo cedolino disponibile. */
  netto: number
  /** Retribuzioni lorde dello stesso mese: la differenza col netto sono
   *  ritenute e contributi a carico del dipendente, che finiscono in F24. */
  lordo: number
  /** Contributi a carico azienda (INPS e altri) dello stesso mese. */
  contributiAzienda: number
}

export interface VocePersonale {
  /** Chiave stabile, usata come id della riga e nel salvataggio. */
  ref: string
  etichetta: string
  data: string
  importo: number
  tipo: 'netto' | 'f24' | 'mensilita_aggiuntiva'
}

export interface PianoPersonaleInput {
  costo: CostoPersonaleMensile
  /** 'YYYY-MM-DD' di inizio periodo (compreso). */
  dataInizio: string
  /** 'YYYY-MM-DD' di fine periodo (compreso). */
  dataFine: string
  /** Giorno del mese in cui partono i bonifici degli stipendi. */
  giornoNetti: number
  /** Giorno del mese della delega F24 (16 salvo diversa indicazione). */
  giornoF24: number
  /** Se falso non genera la voce F24: utile quando l'F24 è già a scadenzario. */
  includiF24?: boolean
  /** Mese di pagamento della tredicesima (1-12) e giorno; 0 disattiva. */
  meseTredicesima?: number
  giornoTredicesima?: number
  /** Mese di COMPETENZA della quattordicesima; il pagamento segue il ritardo
   *  del cedolino, quindi cade nel mese dopo. 0 disattiva. */
  meseQuattordicesima?: number
}

/** Quota di F24 riferita a un mese di stipendi: ritenute più contributi. */
export function f24Personale(costo: CostoPersonaleMensile): number {
  const ritenuteEContributiDipendente = Math.max(0, pos(costo.lordo) - pos(costo.netto))
  return round2(ritenuteEContributiDipendente + pos(costo.contributiAzienda))
}

const ymd = (y: number, m0: number, g: number): string => {
  const d = new Date(y, m0, g)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Genera le uscite del personale che cadono nel periodo. Guarda dodici mesi a
 * partire da quello di inizio, così un orizzonte lungo intercetta anche la
 * tredicesima di dicembre e la quattordicesima di giugno.
 */
export function vociPersonale(input: PianoPersonaleInput): VocePersonale[] {
  const out: VocePersonale[] = []
  const netto = round2(pos(input.costo.netto))
  const f24 = f24Personale(input.costo)
  if (netto <= 0 && f24 <= 0) return out

  const inizio = new Date(input.dataInizio + 'T00:00:00')
  const dentro = (d: string) => d >= input.dataInizio && d <= input.dataFine

  for (let i = 0; i < 13; i++) {
    const anno = inizio.getFullYear()
    const mese0 = inizio.getMonth() + i

    if (netto > 0) {
      const dNetto = ymd(anno, mese0, input.giornoNetti)
      if (dentro(dNetto)) {
        out.push({ ref: `payroll-netto-${dNetto}`, etichetta: 'Stipendi, netti in busta', data: dNetto, importo: netto, tipo: 'netto' })
      }
    }

    if (input.includiF24 !== false && f24 > 0) {
      const dF24 = ymd(anno, mese0, input.giornoF24)
      if (dentro(dF24)) {
        out.push({ ref: `payroll-f24-${dF24}`, etichetta: 'F24 personale: ritenute e contributi', data: dF24, importo: f24, tipo: 'f24' })
      }
    }

    // Mensilità aggiuntive: stesso importo di una mensilità netta.
    const dataMese = new Date(anno, mese0, 1)
    const meseCorrente = dataMese.getMonth() + 1

    if (input.meseTredicesima && meseCorrente === input.meseTredicesima) {
      const g = input.giornoTredicesima && input.giornoTredicesima > 0 ? input.giornoTredicesima : 20
      const d = ymd(dataMese.getFullYear(), dataMese.getMonth(), g)
      if (dentro(d)) {
        out.push({ ref: `payroll-tredicesima-${d}`, etichetta: 'Tredicesima', data: d, importo: netto, tipo: 'mensilita_aggiuntiva' })
      }
    }

    if (input.meseQuattordicesima && meseCorrente === input.meseQuattordicesima + 1) {
      // competenza a giugno, pagamento col cedolino di giugno (mese dopo)
      const d = ymd(dataMese.getFullYear(), dataMese.getMonth(), input.giornoNetti)
      if (dentro(d)) {
        out.push({ ref: `payroll-quattordicesima-${d}`, etichetta: 'Quattordicesima', data: d, importo: netto, tipo: 'mensilita_aggiuntiva' })
      }
    }
  }

  return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
}
