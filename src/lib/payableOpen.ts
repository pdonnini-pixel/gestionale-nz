// ─────────────────────────────────────────────────────────────────────────────
// QUANTO DI UNA FATTURA È ANCORA DA DECIDERE
//
// Una fattura messa in distinta NON è pagata: il bonifico è disposto, la banca
// non l'ha ancora addebitato. Per lo Scadenzario quella quota è «in sospeso» e
// sparisce dall'importo aperto della riga, perché su quei soldi non c'è più
// niente da decidere: sono già partiti.
//
// La stessa regola serve alla Simulazione fabbisogno, che prima leggeva
// `amount_remaining` grezzo e rimetteva in discussione bonifici già disposti.
// Vive qui, in una funzione pura e testata, proprio perché le due pagine non
// possano più divergere.
//
//   dispostoLordo = netti disposti in distinta + note di credito collegate
//   dispPending   = dispostoLordo − già pagato      (disposto NON ancora saldato)
//   residuoAperto = residuo fattura − dispPending   (quota ANCORA da disporre)
//
// Le note di credito già applicate rientrano nel disposto lordo di proposito:
// dopo la chiusura di un acconto fanno quadrare il conto con `amount_paid`, così
// dispPending torna a zero e la fattura non resta nascosta per sbaglio.
// ─────────────────────────────────────────────────────────────────────────────

/** Sotto questa soglia in euro un residuo è considerato chiuso (arrotondamenti). */
export const SOGLIA_CENTESIMI = 0.005

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
const num = (n: number | null | undefined): number => (Number.isFinite(Number(n)) ? Number(n) : 0)

export interface PayableOpenInput {
  /** `amount_remaining` della fattura. */
  residuo: number | null | undefined
  /** `amount_paid` della fattura. */
  giaPagato: number | null | undefined
  /** Somma dei netti disposti in distinta. `null` se non ci sono disposizioni. */
  dispostoNetto?: number | null
  /** Note di credito collegate alla disposizione (pending e applied). */
  noteCredito?: number | null
}

export interface PayableOpenEsito {
  /** Quota disposta in distinta e non ancora saldata: uscita già impegnata. */
  dispPending: number
  /** Quota ancora da decidere e da disporre. Può essere NEGATIVA quando il
   *  disposto supera il residuo (acconto oltre il dovuto): chi legge tratta
   *  qualunque valore sotto la soglia come «niente più da decidere». */
  residuoAperto: number
  /** C'è una disposizione in sospeso su questa fattura. */
  inDistinta: boolean
  /** Acconto in distinta con una parte ancora da disporre. */
  parziale: boolean
}

/**
 * Scompone il residuo di una fattura fra quota già impegnata in distinta e
 * quota ancora da decidere.
 *
 * Senza disposizioni il residuo aperto coincide con `residuo`: è il caso
 * normale, la stragrande maggioranza delle righe.
 */
export function scomponiResiduo(input: PayableOpenInput): PayableOpenEsito {
  const residuo = num(input.residuo)
  const pagato = num(input.giaPagato)
  const haDisposizione = input.dispostoNetto != null

  const dispostoLordo = num(input.dispostoNetto) + num(input.noteCredito)
  const dispPending = haDisposizione ? Math.max(0, round2(dispostoLordo - pagato)) : 0
  const residuoAperto = round2(residuo - dispPending)

  return {
    dispPending,
    residuoAperto,
    inDistinta: dispPending > SOGLIA_CENTESIMI,
    parziale: dispPending > SOGLIA_CENTESIMI && residuoAperto > SOGLIA_CENTESIMI,
  }
}
