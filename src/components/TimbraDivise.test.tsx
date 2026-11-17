// @vitest-environment happy-dom
// La sezione «Divise e acquisti» del telefono del negozio si chiude da sola dopo 30 secondi senza
// tocchi, anche se la pagina che la contiene (Timbra) si ridisegna ogni secondo per l'orologio e le
// passa ogni volta una funzione onChiudi nuova (revisore del codice, 16/11/2026: prima il conto alla
// rovescia ripartiva a ogni ridisegno e la sezione non si chiudeva mai).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../lib/diviseDb', () => ({
  apriDivise: vi.fn(async () => ({ divise: [], prossima: 1 })),
  registraCapi: vi.fn(),
}))

import TimbraDivise from './TimbraDivise'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let contenitore: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  contenitore = document.createElement('div')
  document.body.appendChild(contenitore)
  root = createRoot(contenitore)
})
afterEach(() => {
  act(() => root.unmount())
  contenitore.remove()
  vi.useRealTimers()
})

/** Come Timbra: si ridisegna ogni secondo e passa un onChiudi nuovo a ogni ridisegno. */
function Pagina({ onChiusa }: { onChiusa: () => void }) {
  const [, setAdesso] = useState(0)
  const [aperta, setAperta] = useState(true)
  useEffect(() => { const t = setInterval(() => setAdesso((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  return aperta
    ? createElement(TimbraDivise, { outletId: 'o1', codice: 'NZT1.x.1.y', nome: 'Giulia Rinaldi', onChiudi: () => { setAperta(false); onChiusa() } })
    : null
}

describe('TimbraDivise: chiusura automatica', () => {
  it('si chiude dopo 30 secondi senza tocchi, anche con la pagina che si ridisegna ogni secondo', async () => {
    const chiusa = vi.fn()
    await act(async () => { root.render(createElement(Pagina, { onChiusa: chiusa })) })
    await act(async () => { await Promise.resolve() })   // apertura della sezione (risposta finta)
    expect(contenitore.textContent).toContain('Divisa fornita')
    for (let s = 0; s < 29; s++) await act(async () => { vi.advanceTimersByTime(1000) })
    expect(chiusa).not.toHaveBeenCalled()
    for (let s = 0; s < 2; s++) await act(async () => { vi.advanceTimersByTime(1000) })
    expect(chiusa).toHaveBeenCalledTimes(1)
  })

  it('un tocco fa ripartire i 30 secondi', async () => {
    const chiusa = vi.fn()
    await act(async () => { root.render(createElement(Pagina, { onChiusa: chiusa })) })
    await act(async () => { await Promise.resolve() })
    for (let s = 0; s < 20; s++) await act(async () => { vi.advanceTimersByTime(1000) })
    await act(async () => { contenitore.firstElementChild?.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    for (let s = 0; s < 20; s++) await act(async () => { vi.advanceTimersByTime(1000) })
    expect(chiusa).not.toHaveBeenCalled()
    for (let s = 0; s < 11; s++) await act(async () => { vi.advanceTimersByTime(1000) })
    expect(chiusa).toHaveBeenCalledTimes(1)
  })
})
