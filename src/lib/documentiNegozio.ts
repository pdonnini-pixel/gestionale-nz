// Scheda «Documenti» del negozio: funzioni pure (disegno approvato da Patrizio il 16/11/2026).
//
// Due fonti nel database, che la pagina mostra come un elenco solo:
//  - le RIGHE del contratto (`outlet_attachments`): un documento richiesto, con il file «che vale»;
//  - i FILE dell'archivio (`documents`, `contract_documents`): tutto quello che si carica in più.
// Un file dell'archivio si abbina a una riga riconoscendolo dal nome (regola «niente liste da
// compilare a mano»): diventa una versione in più di quel documento. Se una persona lo sposta a
// mano, vale la sua scelta (`outlet_document_links`, migration 412) e il riconoscimento non la tocca.
// Niente qui scrive o cancella: decide solo dove si vede un file.

export interface RigaContratto {
  id: string
  label: string
  file_name: string | null
  is_required: boolean
  is_uploaded: boolean
  created_at?: string | null
}

export interface FileArchivio {
  id: string
  /** tabella di provenienza: serve alla chiave dell'abbinamento a mano */
  source: 'documents' | 'contract_documents'
  file_name: string | null
}

/** Scelta fatta a mano: riga del contratto, oppure null = «lascialo fra gli altri documenti». */
export type AbbinamentiAMano = Record<string, string | null>

export const chiaveFile = (f: Pick<FileArchivio, 'id' | 'source'>) => `${f.source}:${f.id}`

// Parole che compaiono in quasi tutti i nomi e non dicono di che documento si tratta.
const PAROLE_VUOTE = new Set([
  'allegato', 'allegati', 'contratto', 'contratti', 'bozza', 'signed', 'firmato', 'firmata', 'firma',
  'copia', 'finale', 'definitivo', 'definitiva', 'versione', 'documento', 'documenti', 'scansione',
  'della', 'delle', 'degli', 'dello', 'nella', 'entrambe', 'parti',
])

const senzaAccenti = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Nome senza estensione, minuscolo, senza accenti, con i separatori ridotti a spazi. */
export function nomePulito(nome: string | null | undefined): string {
  return senzaAccenti(String(nome ?? ''))
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Il file è la copia firmata? Lo dice il nome (SIGNED, firmato, firmata). */
export function eFirmato(nome: string | null | undefined): boolean {
  return /\b(signed|firmat[oaie])\b/.test(nomePulito(nome))
}

/** Nome ridotto all'osso per capire se due file sono lo stesso documento: via numero d'ordine e «signed». */
export function nomeBase(nome: string | null | undefined): string {
  return nomePulito(nome)
    .replace(/^\d{1,2}\s+/, '')
    .replace(/\b(signed|firmat[oaie])\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parole che contano: almeno 4 lettere, senza cifre, non fra quelle vuote. */
export function paroleChiave(testo: string | null | undefined): string[] {
  const viste = new Set<string>()
  for (const p of nomePulito(testo).split(' ')) {
    if (p.length < 4 || /\d/.test(p) || PAROLE_VUOTE.has(p)) continue
    viste.add(p)
  }
  return [...viste]
}

/** Lettere di allegato dichiarate in un testo: «Allegato B1», «All. D», «allegato_c». */
export function lettereAllegato(testo: string | null | undefined): string[] {
  const t = senzaAccenti(String(testo ?? '')).toLowerCase().replace(/[_\-]+/g, ' ')
  const trovate = new Set<string>()
  for (const m of t.matchAll(/\ball(?:egato|\.)\s*([a-z]\d?)(?![a-z0-9])/g)) trovate.add(m[1])
  return [...trovate]
}

// Due parole sono la stessa anche con un refuso o un plurale («tenans» / «tenants», «cespite» / «cespiti»).
function stessaParola(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false
  // distanza di una sola lettera (aggiunta, tolta o cambiata)
  let i = 0
  let j = 0
  let diversi = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++diversi > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return diversi + (a.length - i) + (b.length - j) <= 1
}

export interface EsitoRiconoscimento {
  /** riga del contratto a cui il file appartiene, o null se non si capisce */
  rigaId: string | null
  /** perché, in parole semplici: finisce nei test e nelle note, non a video */
  motivo: string
}

/**
 * A quale riga del contratto appartiene un file, guardando solo il nome.
 *  1. Stesso nome della copia che vale (a parte numero d'ordine e «signed»): è lei.
 *  2. Altrimenti contano le parole in comune con l'etichetta e con il nome della copia che vale;
 *     le parole presenti in troppe righe non contano. La lettera dell'allegato da sola non basta.
 *  3. Se il nome dichiara una lettera che è di un'ALTRA riga, non si forza: resta fra gli altri.
 *  4. Se due righe sono alla pari, non si sceglie.
 */
export function riconosciDocumento(nomeFile: string | null | undefined, righe: RigaContratto[]): EsitoRiconoscimento {
  const base = nomeBase(nomeFile)
  if (!base || righe.length === 0) return { rigaId: null, motivo: 'nessun nome o nessuna riga' }

  const stesso = righe.filter((r) => r.file_name && nomeBase(r.file_name) === base)
  if (stesso.length === 1) return { rigaId: stesso[0].id, motivo: 'stesso nome della copia che vale' }

  const paroleRiga = righe.map((r) => new Set([...paroleChiave(r.label), ...paroleChiave(r.file_name)]))
  const lettereRiga = righe.map((r) => new Set([...lettereAllegato(r.label), ...lettereAllegato(r.file_name)]))
  // Una parola che sta in più di un terzo delle righe (almeno 3) non distingue niente: via.
  const soglia = Math.max(2, Math.floor(righe.length / 3))
  const frequenza = (p: string) => paroleRiga.filter((s) => [...s].some((q) => stessaParola(p, q))).length

  const parole = paroleChiave(nomeFile).filter((p) => { const f = frequenza(p); return f > 0 && f <= soglia })
  const lettere = lettereAllegato(nomeFile)

  const punti = righe.map((r, i) => {
    const comuni = parole.filter((p) => [...paroleRiga[i]].some((q) => stessaParola(p, q))).length
    if (comuni === 0) return { r, punti: 0, conflitto: false }
    const sueLettere = lettereRiga[i]
    const lettereUguali = lettere.some((l) => sueLettere.has(l))
    // Il nome dichiara una lettera, questa riga ne ha un'altra, e quella lettera è di un'altra riga.
    const conflitto = lettere.length > 0 && sueLettere.size > 0 && !lettereUguali
      && lettereRiga.some((s, j) => j !== i && lettere.some((l) => s.has(l)))
    return { r, punti: comuni + (lettereUguali ? 1 : 0), conflitto }
  }).filter((x) => x.punti > 0).sort((a, b) => b.punti - a.punti)

  if (punti.length === 0) return { rigaId: null, motivo: 'nessuna parola in comune con i documenti del contratto' }
  if (punti.length > 1 && punti[0].punti === punti[1].punti) {
    return { rigaId: null, motivo: `alla pari fra «${punti[0].r.label}» e «${punti[1].r.label}»` }
  }
  if (punti[0].conflitto) {
    return { rigaId: null, motivo: `le parole dicono «${punti[0].r.label}» ma il nome dichiara l'allegato ${lettere.join(', ').toUpperCase()}, che è di un'altra riga` }
  }
  return { rigaId: punti[0].r.id, motivo: 'parole in comune con il documento' }
}

/** Dove va un file dell'archivio: la scelta a mano vince sempre sul riconoscimento. */
export function rigaDelFile(file: FileArchivio, righe: RigaContratto[], aMano: AbbinamentiAMano): string | null {
  const k = chiaveFile(file)
  if (k in aMano) {
    const scelta = aMano[k]
    return scelta && righe.some((r) => r.id === scelta) ? scelta : null
  }
  return riconosciDocumento(file.file_name, righe).rigaId
}

/** Numero d'ordine scritto in testa al nome del file («5. Allegato C…»), se c'è. */
export function numeroDOrdine(nome: string | null | undefined): number | null {
  const m = String(nome ?? '').trim().match(/^(\d{1,2})[.\s_)-]/)
  return m ? Number(m[1]) : null
}

/**
 * Ordine dell'elenco: prima quello che manca (i richiesti prima dei facoltativi), poi in ordine di
 * contratto. L'ordine di contratto è il numero in testa al nome della copia che vale; chi non ce
 * l'ha viene dopo, nell'ordine in cui la riga è stata creata.
 */
export function ordinaRighe<T extends RigaContratto>(righe: T[]): T[] {
  const peso = (r: T) => (r.is_uploaded ? 2 : r.is_required ? 0 : 1)
  return righe
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const pa = peso(a.r)
      const pb = peso(b.r)
      if (pa !== pb) return pa - pb
      const na = numeroDOrdine(a.r.file_name)
      const nb = numeroDOrdine(b.r.file_name)
      if (na != null && nb != null && na !== nb) return na - nb
      if (na != null && nb == null) return -1
      if (na == null && nb != null) return 1
      const ca = a.r.created_at ?? ''
      const cb = b.r.created_at ?? ''
      if (ca !== cb) return ca < cb ? -1 : 1
      return a.i - b.i
    })
    .map((x) => x.r)
}

export interface StatoContratto {
  richiesti: number
  caricati: number
  mancanti: string[]
}

/** «Documenti del contratto: N su M» e l'elenco di quello che manca. Contano solo i richiesti. */
export function statoContratto(righe: RigaContratto[]): StatoContratto {
  const richiesti = righe.filter((r) => r.is_required)
  return {
    richiesti: richiesti.length,
    caricati: richiesti.filter((r) => r.is_uploaded).length,
    mancanti: ordinaRighe(richiesti.filter((r) => !r.is_uploaded)).map((r) => r.label),
  }
}

/** Categoria di un file che finisce fra gli altri documenti: si legge dal nome, non si chiede. */
export function categoriaDalNome(nome: string | null | undefined): 'contratto' | 'allegato' | 'rinnovo' | 'comunicazione' {
  const n = nomePulito(nome)
  if (/\b(rinnov[oi]|proroga|proroghe)\b/.test(n)) return 'rinnovo'
  if (/\b(comunicazion[ei]|lettera|lettere|raccomandata|pec|avviso|disdetta)\b/.test(n)) return 'comunicazione'
  if (/\ball(egat[oi])?\b/.test(n)) return 'allegato'
  return 'contratto'
}

/** Cosa fare di un file appena trascinato. Il «sostituisce» è l'unico caso che chiede conferma. */
export type DestinoFile =
  | { tipo: 'riempie'; rigaId: string }      // la riga era vuota: il file diventa la sua copia
  | { tipo: 'sostituisce'; rigaId: string }  // prenderebbe il posto della copia che vale: si chiede
  | { tipo: 'versione'; rigaId: string }     // la riga ha già la sua copia: versione in più
  | { tipo: 'altri' }                        // non riconosciuto: fra gli altri documenti

export function destinoDelFile(nomeFile: string, righe: RigaContratto[]): DestinoFile {
  const { rigaId } = riconosciDocumento(nomeFile, righe)
  const riga = righe.find((r) => r.id === rigaId)
  if (!riga) return { tipo: 'altri' }
  if (!riga.is_uploaded || !riga.file_name) return { tipo: 'riempie', rigaId: riga.id }
  // Stesso nome della copia che vale, oppure arriva la firmata e quella che vale non lo è.
  if (riga.file_name.trim().toLowerCase() === nomeFile.trim().toLowerCase()) return { tipo: 'sostituisce', rigaId: riga.id }
  if (eFirmato(nomeFile) && !eFirmato(riga.file_name)) return { tipo: 'sostituisce', rigaId: riga.id }
  return { tipo: 'versione', rigaId: riga.id }
}

/**
 * Etichetta di una riga come si legge a video: il nome in evidenza e, sotto, la precisazione che
 * nell'etichetta sta fra parentesi in fondo. «Preliminare — scrittura privata v7 (firmata il …)»
 * diventa «Preliminare · scrittura privata v7» con sotto «firmata il …». L'etichetta nel database
 * resta com'è.
 */
export function etichettaRiga(label: string | null | undefined): { titolo: string; nota: string } {
  const testo = String(label ?? '').trim()
  const m = testo.match(/^(.*\S)\s*\(([^()]*)\)$/)
  const titolo = (m ? m[1] : testo).replace(/\s+[—–]\s+/g, ' · ')
  return { titolo, nota: m ? m[2].trim() : '' }
}
