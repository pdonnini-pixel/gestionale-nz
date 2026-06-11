import React, { useState, useCallback, cloneElement, isValidElement } from 'react'
import { createPortal } from 'react-dom'

/**
 * Tooltip — componente condiviso a testo libero.
 *
 * Mostra il contenuto integrale al passaggio del mouse su una cella troncata.
 * Sostituisce i `title` nativi (vietati dal design system) per le descrizioni,
 * causali, note, ragioni sociali, nomi file e qualsiasi testo di fonte primaria
 * mostrato troncato in UI.
 *
 * Caratteristiche:
 * - Reso via portal su document.body → non viene mai tagliato dai contenitori
 *   con overflow-hidden o dalle celle di tabella.
 * - Si aggancia al figlio via cloneElement (nessun wrapper DOM aggiunto) →
 *   il `truncate` del figlio continua a funzionare senza modifiche di layout.
 * - Se `content` è vuoto/null, restituisce il figlio inalterato (nessun tooltip).
 *
 * Uso:
 *   <Tooltip content={fullText}>
 *     <div className="truncate max-w-xs">{fullText}</div>
 *   </Tooltip>
 */

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactElement
  /** larghezza massima del riquadro tooltip in px (default 380) */
  maxWidth?: number
}

interface Pos {
  x: number
  top: number
  bottom: number
}

export default function Tooltip({ content, children, maxWidth = 380 }: TooltipProps) {
  const [pos, setPos] = useState<Pos | null>(null)

  const show = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
  }, [])
  const hide = useCallback(() => setPos(null), [])

  const empty =
    content == null ||
    content === '' ||
    (typeof content === 'string' && content.trim() === '')

  if (empty || !isValidElement(children)) return children

  const childProps = (children as React.ReactElement<any>).props
  const child = cloneElement(children as React.ReactElement<any>, {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      show(e.currentTarget)
      childProps.onMouseEnter?.(e)
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      hide()
      childProps.onMouseLeave?.(e)
    },
  })

  // Sotto i 90px dal bordo superiore mostra il tooltip SOTTO l'elemento.
  const placeBelow = pos != null && pos.top < 90
  const left = pos ? Math.min(Math.max(pos.x, 12), window.innerWidth - 12) : 0

  return (
    <>
      {child}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left,
              top: placeBelow ? pos.bottom + 8 : pos.top - 8,
              transform: placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
              maxWidth,
              zIndex: 9999,
              pointerEvents: 'none',
            }}
            className="px-3 py-2 bg-slate-800 text-white text-xs leading-relaxed rounded-lg shadow-xl whitespace-pre-wrap break-words"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}
