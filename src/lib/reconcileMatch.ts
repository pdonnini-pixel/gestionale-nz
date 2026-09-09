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
