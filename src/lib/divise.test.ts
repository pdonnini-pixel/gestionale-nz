import { describe, it, expect } from 'vitest'
import { codiceValido, contatori, daSistemarePerPersona, leggiPrezzo, prezzoCheVale, prezzoDaPagare, prezzoObbligatorio, scontoEffettivo, tipoDellaVoce, valoreSconto, type Capo, type Divisa } from './divise'

const capo = (x: Partial<Capo>): Capo => ({
  id: 'c', employee_id: 'e1', outlet_id: 'o1', divisa_id: null, voce: 'acquisto', codice: '8001234567913',
  prezzo_outlet: 50, prezzo_corretto: null, corretto_il: null, corretto_da: null, sconto_pct: 30,
  registrato_il: '2026-11-14T10:00:00Z', registrato_con: 'qr', scaricato_il: null, scaricato_da: null,
  addebitato_il: null, addebitato_da: null, ...x,
})

describe('divise: prezzi e sconti', () => {
  it('il caso di Patrizio: prezzo outlet 50, sconto 30% → 15 di sconto, paga 35', () => {
    const c = capo({})
    expect(prezzoDaPagare(c)).toBe(35)
    expect(valoreSconto(c)).toBe(15)
  })
  it('la divisa fornita dall’azienda non si paga, anche con il prezzo scritto', () => {
    const c = capo({ voce: 'divisa_fornita', divisa_id: 'd1', sconto_pct: null, prezzo_outlet: 60 })
    expect(prezzoDaPagare(c)).toBe(0)
    expect(valoreSconto(c)).toBe(0)
  })
  it('vale la correzione della sede, anche più bassa o più alta', () => {
    expect(prezzoCheVale(capo({ prezzo_corretto: 45 }))).toBe(45)
    expect(prezzoDaPagare(capo({ prezzo_corretto: 45, sconto_pct: 50 }))).toBe(22.5)
  })
  it('arrotonda al centesimo: 39,90 al 30% → 27,93', () => {
    expect(prezzoDaPagare(capo({ prezzo_outlet: 39.9 }))).toBe(27.93)
    expect(valoreSconto(capo({ prezzo_outlet: 39.9 }))).toBe(11.97)
  })
  it('lo sconto personale vince sullo standard; senza niente è 0', () => {
    expect(scontoEffettivo(50, 40)).toBe(50)
    expect(scontoEffettivo(null, 40)).toBe(40)
    expect(scontoEffettivo(null, null)).toBe(0)
  })
})

describe('divise: cosa si scrive in negozio', () => {
  it('legge il prezzo all’italiana e rifiuta lo sbagliato', () => {
    expect(leggiPrezzo('50')).toBe(50)
    expect(leggiPrezzo('49,90')).toBe(49.9)
    expect(leggiPrezzo('1.234,50 €')).toBe(1234.5)
    expect(leggiPrezzo('49.90')).toBe(49.9)
    expect(leggiPrezzo('')).toBeNull()
    expect(leggiPrezzo('0')).toBeNull()
    expect(leggiPrezzo('12,345')).toBeNull()
    expect(leggiPrezzo('abc')).toBeNull()
  })
  it('codice a barre come lo accetta il database', () => {
    expect(codiceValido('8001234567913')).toBe(true)
    expect(codiceValido('ab')).toBe(false)
    expect(codiceValido('80 01')).toBe(false)
  })
  it('prezzo obbligatorio tranne che per la divisa fornita; tipo della divisa', () => {
    expect(prezzoObbligatorio('divisa_fornita')).toBe(false)
    expect(prezzoObbligatorio('divisa_sconto')).toBe(true)
    expect(prezzoObbligatorio('acquisto')).toBe(true)
    expect(tipoDellaVoce('divisa_sconto')).toBe('sconto')
    expect(tipoDellaVoce('acquisto')).toBeNull()
  })
})

describe('divise: contatori', () => {
  const divise: Divisa[] = [
    { id: 'd1', numero: 1, tipo: 'fornita', outlet_id: 'o1', aperta_il: '2026-11-03' },
    { id: 'd2', numero: 2, tipo: 'sconto', outlet_id: 'o1', aperta_il: '2026-11-10' },
  ]
  const capi = [
    capo({ id: 'a', voce: 'divisa_fornita', divisa_id: 'd1', sconto_pct: null, prezzo_outlet: 60, scaricato_il: 'x' }),
    capo({ id: 'b', voce: 'divisa_fornita', divisa_id: 'd1', sconto_pct: null, prezzo_outlet: null, scaricato_il: 'x' }),
    capo({ id: 'c', voce: 'divisa_sconto', divisa_id: 'd2', sconto_pct: 50, prezzo_outlet: 80, addebitato_il: 'x', scaricato_il: 'x' }),
    capo({ id: 'd', voce: 'acquisto', prezzo_outlet: 50, sconto_pct: 30 }),
  ]
  it('divise contate come divise, acquisti come capi, da addebitare senza le fornite', () => {
    const k = contatori(capi, divise)
    expect(k.diviseFornite).toBe(1)
    expect(k.capiForniti).toBe(2)
    expect(k.diviseSconto).toBe(1)
    expect(k.acquisti).toBe(1)
    expect(k.daScaricare).toBe(1)
    expect(k.daAddebitare).toBe(1)
    expect(k.importoDaAddebitare).toBe(35)
    expect(k.pagato).toBe(75)
  })
  it('da sistemare per persona: chi ha tutto a posto non compare', () => {
    const m = daSistemarePerPersona([...capi, capo({ id: 'z', employee_id: 'e2', scaricato_il: 'x', addebitato_il: 'x' })])
    expect(m.get('e1')).toEqual({ scaricare: 1, addebitare: 1 })
    expect(m.has('e2')).toBe(false)
  })
})

describe('divise: capi annullati (registrati per sbaglio)', () => {
  const d1: Divisa = { id: 'd1', numero: 1, tipo: 'sconto', outlet_id: null, aperta_il: '2026-11-10' }
  const buono = capo({ id: 'k1', voce: 'divisa_sconto', divisa_id: 'd1', prezzo_outlet: 50, sconto_pct: 30 })
  const annullato = capo({ id: 'k2', voce: 'divisa_sconto', divisa_id: 'd1', prezzo_outlet: 80, sconto_pct: 30, annullato_il: '2026-11-11T10:00:00Z', annullato_motivo: 'letto due volte' })
  const soloAnnullato = capo({ id: 'k3', voce: 'acquisto', prezzo_outlet: 20, sconto_pct: 10, annullato_il: '2026-11-11T10:00:00Z', annullato_motivo: 'sbaglio', employee_id: 'e2' })

  it('non contano in contatori e importi da addebitare', () => {
    const k = contatori([buono, annullato], [d1])
    expect(k.capiSconto).toBe(1)
    expect(k.daScaricare).toBe(1)
    expect(k.daAddebitare).toBe(1)
    expect(k.importoDaAddebitare).toBe(35)
  })

  it('una divisa con soli capi annullati non conta come divisa', () => {
    expect(contatori([annullato], [d1]).diviseSconto).toBe(0)
  })

  it('non compaiono nelle etichette dell elenco dei dipendenti', () => {
    const m = daSistemarePerPersona([{ ...buono, employee_id: 'e1' }, soloAnnullato])
    expect(m.get('e1')).toEqual({ scaricare: 1, addebitare: 1 })
    expect(m.has('e2')).toBe(false)
  })
})
