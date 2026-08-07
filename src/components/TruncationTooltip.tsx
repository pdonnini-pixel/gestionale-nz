import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * TruncationTooltip — tooltip GLOBALE e automatico sul testo troncato.
 *
 * Montato UNA sola volta nel Layout. Ascolta i mouseover a livello di documento
 * e, quando il puntatore entra su un elemento il cui testo e' *davvero* troncato
 * (`.truncate` orizzontale oppure `line-clamp-*` multi-riga con overflow reale),
 * mostra il testo integrale in un riquadro reso via portal su `document.body`.
 *
 * Perche' globale e non wrapping manuale cella-per-cella: garantisce che il
 * tooltip compaia OVUNQUE una "scrittura" si interrompe (movimenti, banche,
 * riconciliazione, scadenzario, ...) e in ogni tabella futura, senza doversi
 * ricordare di avvolgere ogni singola cella. Legge il testo effettivamente
 * visibile (`textContent`), quindi mostra sempre il contenuto giusto.
 *
 * Convivenza col componente condiviso <Tooltip> (CellTooltip): quel componente
 * marca il proprio figlio con `data-tt` e questo handler globale salta qualsiasi
 * elemento dentro un `[data-tt]`, evitando tooltip doppi. Salta anche gli
 * elementi con `title` nativo (gestiti gia' dal browser).
 */

interface TipState {
  x: number
  top: number
  bottom: number
  text: string
}

// `.truncate` (Tailwind: overflow-hidden + text-ellipsis + whitespace-nowrap)
// e `line-clamp-*` (troncamento verticale multi-riga con ellissi).
const SELECTOR = '.truncate, [class*="line-clamp"]'

/** True se l'elemento sta realmente nascondendo del testo (overflow reale). */
function isTruncated(el: HTMLElement): boolean {
  // +1px di tolleranza per gli arrotondamenti sub-pixel del layout.
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
}

export default function TruncationTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const hide = () => setTip(null)

    function targetFor(node: EventTarget | null): HTMLElement | null {
      if (!(node instanceof Element)) return null
      const el = node.closest(SELECTOR)
      if (!(el instanceof HTMLElement)) return null
      // Gia' gestito dal <Tooltip> condiviso, o dal title nativo del browser.
      if (el.closest('[data-tt]') || el.getAttribute('title')) return null
      if (!isTruncated(el)) return null
      return el
    }

    function showFor(el: HTMLElement) {
      const text = (el.textContent || '').trim()
      if (!text) { hide(); return }
      const r = el.getBoundingClientRect()
      setTip({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom, text })
    }

    // mouseover bubbla: un solo listener sul documento copre tutta l'app.
    // Ogni movimento aggiorna: entrando su un elemento non troncato -> nascondi.
    function onOver(e: MouseEvent) {
      const el = targetFor(e.target)
      if (el) showFor(el)
      else hide()
    }

    // Touch: mostra al tocco e auto-nascondi (niente hover su mobile).
    function onTouch(e: TouchEvent) {
      const el = targetFor(e.target)
      if (!el) return
      showFor(el)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(hide, 2500)
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('touchstart', onTouch, { passive: true })
    // Uno scroll (anche di un contenitore interno: capture=true) o un resize
    // spostano l'ancora: nascondi per non lasciare il riquadro "orfano".
    document.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)

    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('touchstart', onTouch)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  if (!tip) return null

  // Sotto i 90px dal bordo superiore mostra il tooltip SOTTO l'elemento.
  const placeBelow = tip.top < 90
  const left = Math.min(Math.max(tip.x, 12), window.innerWidth - 12)

  return createPortal(
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left,
        top: placeBelow ? tip.bottom + 8 : tip.top - 8,
        transform: placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        maxWidth: 380,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
      className="px-3 py-2 bg-slate-800 text-white text-xs leading-relaxed rounded-lg shadow-xl whitespace-pre-wrap break-words"
    >
      {tip.text}
    </div>,
    document.body,
  )
}
