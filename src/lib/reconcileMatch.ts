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
export const BENEF_STOP = new Set(['SPA', 'SRL', 'SNC', 'SAS', 'SRLS', 'SAPA', 'SCARL', 'SCRL', 'SOCIETA', 'PER', 'AZIONI', 'DEL', 'DELLA', 'THE', 'AND', 'SEMPLIFICATA', 'UNIPERSONALE', 'PROPCO', 'GROUP', 'GRUPPO', 'HOLDING', 'ITALIA', 'ITALY', 'ITALIANA', 'COOPERATIVA', 'ASSOCIATI', 'ASSOCIATO', 'SERVIZI', 'SERVICE', 'SERVICES'])
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

// Un flusso CBI / disposizione / bonifico è un pagamento reale a fornitore anche se
// la causale contiene la parola "commissioni": NON va escluso come non-fornitore (R9).
export const isRealTransfer = (desc: string): boolean => /IMPORTO BONIFICI|DISPOSIZIONE|A FAVORE|BONIFICO/i.test(String(desc || ''))
