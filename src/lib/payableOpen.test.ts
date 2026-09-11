import { describe, it, expect } from 'vitest'
import { scomponiResiduo } from './payableOpen'

describe('scomponiResiduo', () => {
  it('senza disposizioni il residuo aperto è il residuo pieno', () => {
    const r = scomponiResiduo({ residuo: 1500, giaPagato: 0 })
    expect(r).toEqual({ dispPending: 0, residuoAperto: 1500, inDistinta: false, parziale: false })
  })

  it('fattura interamente disposta: non resta niente da decidere', () => {
    // Westi Srl, caparra Roma Soratte: 20.000 € disposti il 9/09, residuo 20.000
    const r = scomponiResiduo({ residuo: 20000, giaPagato: 0, dispostoNetto: 20000 })
    expect(r.dispPending).toBe(20000)
    expect(r.residuoAperto).toBe(0)
    expect(r.inDistinta).toBe(true)
    expect(r.parziale).toBe(false)
  })

  it('acconto in distinta: resta aperta solo la differenza', () => {
    const r = scomponiResiduo({ residuo: 10000, giaPagato: 0, dispostoNetto: 4000 })
    expect(r.dispPending).toBe(4000)
    expect(r.residuoAperto).toBe(6000)
    expect(r.parziale).toBe(true)
  })

  it('disposto oltre il residuo: aperto negativo, nessun parziale', () => {
    // MARCO GHEZZI 92: residuo 2.000, disposto 2.866
    const r = scomponiResiduo({ residuo: 2000, giaPagato: 0, dispostoNetto: 2866 })
    expect(r.residuoAperto).toBe(-866)
    expect(r.inDistinta).toBe(true)
    expect(r.parziale).toBe(false)
  })

  it('quando l\'acconto è stato saldato la fattura torna aperta per intero', () => {
    // disposto 4.000, poi pagato 4.000: dispPending torna a 0
    const r = scomponiResiduo({ residuo: 6000, giaPagato: 4000, dispostoNetto: 4000 })
    expect(r.dispPending).toBe(0)
    expect(r.residuoAperto).toBe(6000)
    expect(r.inDistinta).toBe(false)
  })

  it('le note di credito collegate entrano nel disposto lordo', () => {
    const r = scomponiResiduo({ residuo: 5000, giaPagato: 0, dispostoNetto: 3000, noteCredito: 2000 })
    expect(r.dispPending).toBe(5000)
    expect(r.residuoAperto).toBe(0)
  })

  it('importi mancanti o non numerici valgono zero, non NaN', () => {
    const r = scomponiResiduo({ residuo: null, giaPagato: undefined })
    expect(r.dispPending).toBe(0)
    expect(r.residuoAperto).toBe(0)
  })

  it('la soglia dei centesimi non fa scattare il badge distinta', () => {
    const r = scomponiResiduo({ residuo: 100, giaPagato: 0, dispostoNetto: 0.004 })
    expect(r.inDistinta).toBe(false)
  })
})
