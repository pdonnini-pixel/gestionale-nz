import { describe, it, expect } from 'vitest'
import { eErroreDiVersione, testoErrore } from './nuovaVersione'

// I messaggi veri, presi dai browser e dal log della CI del 23/09/2026, dove
// il pixel check ha girato mentre Netlify stava sostituendo i file.
const DA_VERSIONE = [
  'Failed to fetch dynamically imported module: https://gestionale-nz.netlify.app/assets/Dashboard-z9kkTP-a.js',
  'error loading dynamically imported module: /assets/Fornitori-abc123.js',
  'Importing a module script failed.',
  'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.',
  'Unable to preload CSS for /assets/index-CxUkM-mO.css',
]

// Errori veri del codice: qui ricaricare non serve a niente, e dire
// "c'e' una versione nuova" sarebbe una bugia che nasconde un difetto.
const NON_DA_VERSIONE = [
  new TypeError("Cannot read properties of undefined (reading 'map')"),
  new Error('Row not found'),
  'AuthApiError: Invalid login credentials',
  'Network request failed',
  '',
  null,
  undefined,
]

describe('eErroreDiVersione', () => {
  it.each(DA_VERSIONE)('riconosce il file sparito dal server: %s', (messaggio) => {
    expect(eErroreDiVersione(new Error(messaggio))).toBe(true)
    expect(eErroreDiVersione(messaggio)).toBe(true)
  })

  it.each(NON_DA_VERSIONE)('non scambia per versione nuova: %s', (errore) => {
    expect(eErroreDiVersione(errore)).toBe(false)
  })

  it('guarda dentro una promessa rifiutata e dentro un evento', () => {
    expect(eErroreDiVersione({ reason: new Error(DA_VERSIONE[0]) })).toBe(true)
    expect(eErroreDiVersione({ error: new Error(DA_VERSIONE[1]) })).toBe(true)
  })

  it('non dipende dalle maiuscole', () => {
    expect(eErroreDiVersione('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE')).toBe(true)
  })
})

describe('testoErrore', () => {
  it('tiene nome e messaggio di un Error', () => {
    expect(testoErrore(new TypeError('boom'))).toBe('TypeError boom')
  })

  it('non esplode su quello che non e’ un errore', () => {
    expect(testoErrore(42)).toBe('42')
    expect(testoErrore(null)).toBe('')
  })
})
