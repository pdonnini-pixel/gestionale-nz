// Helper puri per la riconciliazione banca ↔ fatture (ciclo passivo).
// Estratti da TesoreriaManuale.tsx per essere testabili in isolamento (Vitest).
// Regole di riferimento: RICONCILIAZIONE_REGOLE.md (R1–R13). Vedi in particolare
// R3 (scorporo commissioni CBI: si confronta il NETTO), R5 (conferma fornitore
// stretta: P.IVA o parola distintiva non generica), R6 (1 bonifico = 1 fornitore).

// Movimenti che NON sono pagamenti a fornitori (imposte, bolli, giroconti,
// commissioni, ricariche): non vanno proposti per abbinamento a una fattura.
export const NON_SUPPLIER_RE = /\b(F24|CBILL|PAGOPA|GIROCONTO|BOLLO|ONERI|COMMISSION|RICARICA)\b/i
// Beneficiari che non sono fornitori con fattura (fondi, assicurazioni, banche):
// anche se l'importo combacia per caso, NON vanno abbinati a una fattura.
export const NON_SUPPLIER_BENEF_RE = /\b(AZIMUT|MEDIOLANUM|GENERALI|UNIPOLSAI|ALLIANZ|POSTE VITA|ARCA VITA|INTESA|FINECO|BANCA|SGR|FONDO|ASSICURA)\b/i

// Movimenti che la BANCA fa per conto proprio, o fra i conti dell'azienda: non
// hanno una fattura fornitore dietro e non vanno mai proposti per l'abbinamento.
// Nascevano da qui i due terzi della lista «da verificare»: al 10/09/2026 su NZ
// erano 124 movimenti su 316 per 247.255 €, che nessuno avrebbe mai potuto
// abbinare a niente. Il filtro che c'era guardava la categoria A-Cube in inglese
// (fees, loans, wages…), ma sui dati veri le categorie sono in italiano o assenti:
// non scattava quasi mai. Qui si guarda la CAUSALE, che la banca scrive sempre.
//
// I pattern sono volutamente stretti, per non mangiarsi pagamenti veri:
//   · «CANONE» da solo NO — un canone di locazione è un pagamento a un fornitore.
//     Solo le forme bancarie: canone rapporto/package/home banking.
//   · Gli ASSEGNI restano dentro: un assegno paga spesso una fattura.
//   · «Storno scritture» resta dentro: va guardato caso per caso.
export const BANK_OWN_MOVEMENT_RE = new RegExp([
  // rate di mutuo e rimborsi di finanziamento
  'RATA DI MUTUO', 'RIMBORSO FINANZ',
  // canoni e spese del rapporto bancario
  'CANONE RAPPORTO', 'CANONE SET DI BASE', 'CANONE HOME BANKING',
  'COMM/SPESE SU FIDEJUSSION', 'FONDO DI GARANZIA',
  // movimenti fra conti propri e cassa
  'PREL\\.CONT', 'PRELEVAMENTO', 'PASSAGGIO CONTANTI', 'GIROCONTO',
  'COSTITUZIONE PEGNO',
  // commissioni POS, rimborsi tax free, addebito mensile dell'estratto carta:
  // sono servizi addebitati in SDD, non fatture da chiudere una per una
  'A FAVORE NEXI PAYMENTS', 'A FAVORE GLOBAL BLUE',
  'ADDEBITO DIRETTO CARTA', 'POSIZIONE CARTA',
].join('|'), 'i')

// Vero se il movimento è roba della banca o un giro interno, non un pagamento
// a un fornitore. Da usare per tenerlo fuori dalla lista degli abbinamenti.
export const isBankOwnMovement = (desc: string): boolean =>
  BANK_OWN_MOVEMENT_RE.test(String(desc || ''))

// Ripulisce la coda del nome beneficiario: taglia ai marcatori noti (numero fattura,
// ID bonifico, codice mandato, P.IVA pagatore) e si ferma al primo token che contiene
// una cifra o ":" (= inizio di un codice/numero, non più parte del nome).
export const trimBenefTail = (s0: string): string => {
  let s = String(s0 || '').trim()
  s = s.split(/\s+SALDO\s+FATTURA/i)[0]
  s = s.split(/\s+NEW ZAGO/i)[0]
  s = s.split(/\s+(?:ID[.\s]?BON|CRO|TRN|CODICE\s+MANDATO)\b/i)[0]
  s = s.replace(/\s+\d{11}.*$/, '')   // P.IVA/CF del pagatore
  const out: string[] = []
  for (const t of s.split(/\s+/)) { if (/[0-9:]/.test(t)) break; out.push(t) }
  return out.join(' ').trim()
}

// Estrae il beneficiario dalla causale. Due pattern:
//  1) "a favore di: NOME" / "A FAVORE NOME" (bonifici / addebiti SDD);
//  2) bonifico internet-banking "… *NOME SF-1234 ID.BON:…" — il nome è dopo l'asterisco.
// Il pattern 2 è essenziale per non trattare come ANONIMO un movimento che nomina
// chiaramente il fornitore (es. "*SFORAZZINI SRL SF-11245-11037"): se non lo si legge,
// il ramo anonimo lo aggancerebbe per solo-importo a un fornitore diverso la cui somma
// combacia per coincidenza (R5/R6: il fornitore va confermato dal nome, mai per importo).
// Restituisce '' se non c'è un beneficiario leggibile.
export const extractBeneficiary = (desc: string): string => {
  const d = String(desc || '')
  let m = /a favore(?:\s+di)?:?\s+(.+)/i.exec(d)
  if (!m) m = /\*\s*([A-Za-zÀ-ÿ][^*]+)/.exec(d)   // "… *NOME …" (dopo l'asterisco)
  if (!m) return ''
  return trimBenefTail(m[1])
}

// Stoplist allineata alla regola R5 (backend supplier_confirmed_in_text): niente
// match su parole generiche (PROPCO/GROUP/GRUPPO/HOLDING/ITALIA/SERVIZI…), così i
// fornitori "… PROPCO SRL" non si mischiano tra loro (1 bonifico = 1 fornitore, R6).
export const BENEF_STOP = new Set(['SPA', 'SRL', 'SNC', 'SAS', 'SRLS', 'SAPA', 'SCARL', 'SCRL', 'SOCIETA', 'PER', 'AZIONI', 'DEL', 'DELLA', 'THE', 'AND', 'SEMPLIFICATA', 'UNIPERSONALE', 'PROPCO', 'GROUP', 'GRUPPO', 'HOLDING', 'ITALIA', 'ITALY', 'ITALIANA', 'COOPERATIVA', 'ASSOCIATI', 'ASSOCIATO', 'SERVIZI', 'SERVICE', 'SERVICES', 'EUROPE', 'EUROPA', 'EUROPEAN', 'INTERNATIONAL', 'GLOBAL', 'WORLD', 'PAYMENT', 'PAYMENTS', 'CAPITAL', 'INDUSTRIAL', 'INDUSTRIALE', 'INDUSTRIE', 'FINANCE', 'FINANCIAL', 'LEASING', 'RENTAL', 'BUSINESS', 'COMPANY', 'LIMITED', 'AZIONISTA', 'SECONDARIA', 'SOLUTIONS', 'SYSTEMS'])
export const sigWords = (s: string): string[] =>
  String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !BENEF_STOP.has(w))

// Vero se il beneficiario letto dalla causale condivide almeno una parola
// significativa col nome del fornitore candidato (R5/R6). Se il beneficiario non
// ha parole significative (nome tutto generico), non si può confermare per nome.
export const namesOverlap = (beneficiario: string, supplierName: string): boolean => {
  const b = sigWords(beneficiario)
  if (b.length === 0) return false
  const sup = new Set(sigWords(supplierName))
  return b.some((w) => sup.has(w))
}

const parseItAmount = (s: string): number => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0
// Netto realmente bonificato: nei flussi CBI aziendali l'importo del movimento è
// LORDO (netto + commissione). Si scorpora la commissione dalla causale
// ("IMPORTO BONIFICI" / "IMPORTO COMMISSIONI") per confrontare il NETTO con le fatture (R3).
export const movementNet = (m: { description?: string | null; amount?: number | null }): number => {
  const d = String(m.description || '')
  const mb = /IMPORTO\s+BONIFICI\s*:?\s*([0-9][0-9.]*,[0-9]{2})/i.exec(d)
  if (mb) return parseItAmount(mb[1])
  const gross = Math.abs(Number(m.amount) || 0)
  const mc = /IMPORTO\s+COMMISSIONI\s*:?\s*([0-9][0-9.]*,[0-9]{2})/i.exec(d)
  return mc ? Math.max(0, gross - parseItAmount(mc[1])) : gross
}

// Vero se la causale ha la STRUTTURA di un pagamento (flusso CBI o bonifico verso
// qualcuno). Serve sui movimenti senza beneficiario leggibile: "DISPOSIZIONE -
// Descrizione: FONDO DI GARANZIA MCC" è una disposizione, ma non paga un fornitore, e
// senza questo filtro il motore le accostava sei fatturine DX SRL che facevano 260,00
// tondi per coincidenza. Un vero pagamento dichiara sempre l'importo bonificato, il
// numero di pagamenti del flusso o il beneficiario.
export const hasPaymentStructure = (desc: string): boolean =>
  /IMPORTO\s+BONIFICI|NUM\.?\s*TOT\.?\s*PAGAMENTI|A FAVORE|BONIFICO/i.test(String(desc || ''))

// Un pagamento non arriva mesi PRIMA della fattura che salda. Senza questa regola i
// fornitori a importo fisso (utenze, servizi mensili) agganciavano un addebito di
// gennaio o giugno alla fattura di ottobre dello stesso importo: il 13/10/2026 il
// riquadro «Da verificare» proponeva HERA 24/06 → fattura del 06/10, SPM 12/01 →
// fattura del 28/09, Amazon 09/02 → fattura del 07/10. Misurato sui 696 abbinamenti
// già confermati di NZ: gli SDD di utenze e consorzi partono fino a 23 giorni prima
// della data fattura, quindi la tolleranza è di 30 giorni. Data mancante = non si
// esclude (meglio una proposta in più che una persa).
export const PAYMENT_BEFORE_INVOICE_MAX_DAYS = 30
export const isPaymentDatePlausible = (
  txDate: string | null | undefined,
  invoiceDate: string | null | undefined,
  maxDaysBefore: number = PAYMENT_BEFORE_INVOICE_MAX_DAYS,
): boolean => {
  if (!txDate || !invoiceDate) return true
  const tx = Date.parse(String(txDate).slice(0, 10))
  const inv = Date.parse(String(invoiceDate).slice(0, 10))
  if (Number.isNaN(tx) || Number.isNaN(inv)) return true
  return (inv - tx) / 86_400_000 <= maxDaysBefore
}

// Un flusso CBI / disposizione / bonifico è un pagamento reale a fornitore anche se
// la causale contiene la parola "commissioni": NON va escluso come non-fornitore (R9).
export const isRealTransfer = (desc: string): boolean => /IMPORTO BONIFICI|DISPOSIZIONE|A FAVORE|BONIFICO/i.test(String(desc || ''))

// ─────────────────────────────────────────────────────────────────────────────
// Pagamenti raggruppati (un bonifico, più fatture). Regole R5/R6 applicate sul
// serio dopo il caso reale del 09/09/2026: il motore aveva proposto di saldare
// con un bonifico ad AMAZON PAYMENTS EUROPE una fattura di CNH INDUSTRIAL
// CAPITAL EUROPE, perché i due nomi condividono la parola "EUROPE".
// ─────────────────────────────────────────────────────────────────────────────

// Chiave di identità del fornitore: la P.IVA quando c'è (regola di progetto:
// l'aggancio fornitore↔fattura si fa per P.IVA, mai per nome), altrimenti il
// nome normalizzato. Serve a tenere insieme le varianti anagrafiche dello stesso
// fornitore (ZUCCHETTI SPA e ZUCCHETTI SPA AD AZIONISTA UNICO hanno la stessa
// P.IVA) e a tenere separati fornitori diversi con nomi che si somigliano.
export const supplierKeyOf = (p: { supplier_vat?: string | null; supplier_name?: string | null }): string => {
  const vat = String(p.supplier_vat || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  if (vat.length >= 8) return `VAT:${vat}`
  return `NAME:${String(p.supplier_name || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`
}

// Numeri di fattura citati nella causale. Due forme reali:
//   "…SALDO FATTURA 60828-65166ID.BON:…"        → 60828, 65166
//   "…SSF-IT662TPABEY-IT65OHAABEID.BON:…"       → IT662TPABEY, IT65OHAABE
// Il codice può arrivare TRONCATO (la banca taglia la causale), quindi il
// confronto con invoice_number si fa per prefisso, non per uguaglianza.
export const invoiceTokens = (desc: string): string[] => {
  const d = String(desc || '').toUpperCase()
  const head = d.split(/ID\.?\s?BON/)[0]
  const out = new Set<string>()
  for (const t of head.split(/[^A-Z0-9/]+/)) {
    const tok = t.replace(/^(SF|SSF|FT|FATT|FATTURA)-?/, '')
    if (tok.length < 3) continue
    if (/^[0-9]{1,2}$/.test(tok)) continue
    if (/^(SALDO|FATTURA|FATTURE|BONIFICO|CORPORATE|BANKING|TRAMITE|ACCONTO|PAGAMENTO|NOSTRO|VOSTRO)$/.test(tok)) continue
    if (!/[0-9]/.test(tok)) continue          // un numero di fattura contiene sempre una cifra
    out.add(tok)
  }
  return Array.from(out)
}

// Vero se il numero della fattura corrisponde a uno dei token letti in causale.
// Confronto per prefisso in entrambi i versi: la causale può troncare il codice
// (IT65OHAABE per IT65OHAABEY) e il numero può avere una coda (60828/PI).
export const invoiceCitedIn = (invoiceNumber: string, tokens: string[]): boolean => {
  const n = String(invoiceNumber || '').toUpperCase().replace(/[^A-Z0-9/]/g, '')
  if (!n) return false
  const head = n.split('/')[0]
  // Parte numerica della testa: "FPR 238/26" → "238", perché la causale scrive
  // "SALDO FATTURA 238-240" senza il prefisso della serie.
  const digits = head.replace(/[^0-9]/g, '')
  return tokens.some((t) =>
    t === n || t === head ||
    (t.length >= 3 && /^[0-9]+$/.test(t) && t === digits) ||
    (t.length >= 5 && (head.startsWith(t) || t.startsWith(head))))
}

export type ComboItem = { cents: number; cited?: boolean }

/**
 * Combinazione di 2..maxItems voci la cui somma fa ESATTAMENTE il target.
 * Niente tolleranza percentuale: i bonifici corporate banking arrivano già al
 * netto (la commissione la banca la addebita con una riga separata), quindi una
 * somma che non torna al centesimo è un gruppo sbagliato, non un arrotondamento.
 *
 * Ritorna gli indici della combinazione, oppure null se non ne esiste nessuna o
 * se ne esiste più d'una davvero diversa (ambiguo → non si propone niente).
 * Quando la causale cita dei numeri di fattura, le soluzioni che li contengono
 * tutti hanno la precedenza: è quello che rompe l'ambiguità nei casi reali.
 *
 * Ricerca esaustiva con potatura sui prefissi ordinati, senza il vecchio taglio
 * "solo le 12 fatture più grandi" che nascondeva la combinazione giusta.
 */
export const findExactCombo = (
  items: ComboItem[],
  targetCents: number,
  maxItems = 6,
  nodeBudget = 400_000,
): number[] | null => {
  if (targetCents <= 0 || items.length < 2) return null
  const idx = items.map((_, i) => i).sort((a, b) => items[b].cents - items[a].cents)
  const v = idx.map((i) => items[i].cents)
  const n = v.length
  // suffisso positivo: quanto si può ancora aggiungere da qui in avanti
  const suffixPos = new Array<number>(n + 1).fill(0)
  for (let i = n - 1; i >= 0; i--) suffixPos[i] = suffixPos[i + 1] + Math.max(0, v[i])
  const suffixNeg = new Array<number>(n + 1).fill(0)
  for (let i = n - 1; i >= 0; i--) suffixNeg[i] = suffixNeg[i + 1] + Math.min(0, v[i])

  const MAX_SOL = 8          // se ne trovo tante, il caso è ambiguo per definizione
  const solutions: number[][] = []
  let nodes = 0
  let overflow = false
  const cur: number[] = []
  const rec = (start: number, sum: number): void => {
    if (solutions.length >= MAX_SOL || overflow) return
    if (++nodes > nodeBudget) { overflow = true; return }
    if (cur.length >= 2 && sum === targetCents) { solutions.push(cur.slice()); return }
    if (cur.length === maxItems) return
    for (let i = start; i < n; i++) {
      // potatura: nemmeno prendendo tutto il resto positivo si arriva al target,
      // o anche togliendo tutte le note di credito si resta sopra
      if (sum + suffixPos[i] < targetCents) return
      if (sum + suffixNeg[i] > targetCents) return
      cur.push(i); rec(i + 1, sum + v[i]); cur.pop()
      if (solutions.length >= MAX_SOL || overflow) return
    }
  }
  rec(0, 0)
  if (overflow || solutions.length === 0) return null
  const back = (sol: number[]) => sol.map((k) => idx[k]).sort((a, b) => a - b)
  if (solutions.length === 1) return back(solutions[0])
  // Due soluzioni: valgono solo se una sola contiene TUTTE le fatture citate in causale.
  const cited = items.map((it, i) => (it.cited ? i : -1)).filter((i) => i >= 0)
  if (cited.length === 0) return null
  const full = solutions.map(back).filter((s) => cited.every((c) => s.includes(c)))
  return full.length === 1 ? full[0] : null
}

// ---------------------------------------------------------------------------
// Proposte del motore ancora azionabili (R14)
// ---------------------------------------------------------------------------
// Il motore scrive in reconciliation_log sia gli abbinamenti che applica da sé
// (status 'applied') sia quelli da far confermare a mano ('to_confirm'). Una
// proposta 'to_confirm' però invecchia: il movimento viene riconciliato altrove,
// la rata viene pagata o agganciata a un altro movimento, e quella riga resta lì
// senza che nessuno la chiuda. Al 19/10/2026 su NZ erano 78 righe aperte, di cui
// 59 su rate già pagate e 34 su rate già agganciate a un movimento.
//
// La lista degli abbinamenti suggeriti le scartava già. Il contatore sulla tab
// Riconciliazione no: guardava solo status + confidenza, e annunciava 23 proposte
// mentre la lista ne apriva zero. Peggio: con un contatore pieno il badge nasconde
// il numero utile (le uscite ancora da abbinare), quindi un numero fantasma
// copriva l'unico dato azionabile.
//
// Da qui la regola sta in un posto solo, usata dalla lista e dal contatore.

export const SUGGEST_MIN_CONFIDENCE = 70
export const SUGGEST_AMOUNT_TOLERANCE = 0.05
export const SUGGEST_OPEN_STATUSES = ['da_pagare', 'in_scadenza', 'scaduto', 'parziale']

export type SuggestionLogLike = {
  id: string
  bank_transaction_id?: string | null
  payable_id?: string | null
  confidence?: number | null
  status?: string | null
}
export type SuggestionTxLike = { id: string; amount?: number | null; is_reconciled?: boolean | null; transaction_date?: string | null }
export type SuggestionPayableLike = {
  id: string
  status?: string | null
  gross_amount?: number | null
  amount_paid?: number | null
  amount_remaining?: number | null
  closed_manually?: boolean | null
  bank_transaction_id?: string | null
  invoice_date?: string | null
}

// Fattura chiusa a mano e non ancora agganciata a un movimento: paid +
// closed_manually + nessun bank_transaction_id. Regola Patrizio: ogni movimento va
// SEMPRE verificato anche contro queste, non solo contro le aperte.
export const isClosedManualUnlinked = (p: SuggestionPayableLike): boolean =>
  String(p.status) === 'pagato' && p.closed_manually === true && !p.bank_transaction_id

// Base di confronto: il residuo per le aperte, il totale fattura per le chiuse a
// mano (il residuo è 0 perché la rata risulta già pagata).
export const suggestionBase = (p: SuggestionPayableLike): number =>
  isClosedManualUnlinked(p)
    ? Number(p.gross_amount || 0)
    : (p.amount_remaining != null
        ? Number(p.amount_remaining)
        : Number(p.gross_amount || 0) - Number(p.amount_paid || 0))

// Vero se la proposta è ancora buona da mostrare: movimento non riconciliato,
// rata aperta (o chiusa a mano senza aggancio), affidabilità sopra soglia e
// importo del movimento che coincide con la base entro il 5%.
export const isSuggestionActionable = (
  log: SuggestionLogLike,
  bt: SuggestionTxLike | undefined,
  payable: SuggestionPayableLike | undefined,
): boolean => {
  if (String(log.status) !== 'to_confirm') return false
  if (!log.bank_transaction_id || !log.payable_id) return false
  if (!bt || bt.is_reconciled) return false
  if (!payable) return false
  // Un pagamento non puo' precedere di mesi la fattura che chiude (casi HERA, SPM,
  // Amazon del 13/10/2026): sta in isPaymentDatePlausible.
  if (!isPaymentDatePlausible(String(bt.transaction_date || ''), String(payable.invoice_date || ''))) return false
  if (!SUGGEST_OPEN_STATUSES.includes(String(payable.status)) && !isClosedManualUnlinked(payable)) return false
  const base = suggestionBase(payable)
  if (base <= 0) return false
  if ((Number(log.confidence) || 0) < SUGGEST_MIN_CONFIDENCE) return false
  const mov = Math.abs(Number(bt.amount) || 0)
  return Math.abs(mov - base) / base <= SUGGEST_AMOUNT_TOLERANCE
}

// Le proposte azionabili, ordinate per affidabilità e deduplicate per fattura:
// una stessa fattura non va proposta per più movimenti (costi ricorrenti a importo
// fisso, es. NEXI/SPM stessa fattura ×N). Tiene la proposta migliore.
export const pickActionableSuggestions = <
  L extends SuggestionLogLike,
  T extends SuggestionTxLike,
  P extends SuggestionPayableLike,
>(
  logRows: L[],
  txById: Map<string, T>,
  payById: Map<string, P>,
): { log: L; bt: T; payable: P; confidence: number; chiusa: boolean }[] => {
  const out: { log: L; bt: T; payable: P; confidence: number; chiusa: boolean }[] = []
  for (const log of logRows) {
    const bt = log.bank_transaction_id ? txById.get(String(log.bank_transaction_id)) : undefined
    const payable = log.payable_id ? payById.get(String(log.payable_id)) : undefined
    if (!isSuggestionActionable(log, bt, payable)) continue
    out.push({
      log,
      bt: bt as T,
      payable: payable as P,
      confidence: Number(log.confidence) || 0,
      chiusa: isClosedManualUnlinked(payable as P),
    })
  }
  out.sort((a, b) => b.confidence - a.confidence)
  const seenPayable = new Set<string>()
  const deduped: typeof out = []
  for (const s of out) {
    const pid = String(s.payable.id)
    if (seenPayable.has(pid)) continue
    seenPayable.add(pid)
    deduped.push(s)
  }
  return deduped
}

// Quante proposte sono davvero azionabili, partendo da array (per il contatore
// della tab, che ha i movimenti e le rate già in memoria). Deve dare lo STESSO
// numero di righe che la lista apre: è il bug che questa funzione chiude.
export const countActionableSuggestions = (
  logRows: SuggestionLogLike[],
  transactions: SuggestionTxLike[],
  payables: SuggestionPayableLike[],
): number => {
  const txById = new Map(transactions.map((t) => [String(t.id), t]))
  const payById = new Map(payables.map((p) => [String(p.id), p]))
  return pickActionableSuggestions(logRows, txById, payById).length
}
