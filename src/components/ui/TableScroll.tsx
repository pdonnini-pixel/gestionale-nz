import { useRef, useState, useEffect, useCallback } from 'react'

/**
 * Contenitore di scroll orizzontale per tabelle larghe con indicatore visivo:
 * quando il contenuto sborda, mostra una sfumatura sul bordo destro/sinistro
 * per far capire (soprattutto su mobile, dove la scrollbar è invisibile) che
 * ci sono altre colonne raggiungibili scorrendo.
 *
 * Uso: <TableScroll className="max-h-[70vh] overflow-y-auto"><table .../></TableScroll>
 * — sostituisce il classico <div className="overflow-x-auto">.
 */
export default function TableScroll({ className = '', wrapperClassName = '', children }: { className?: string; wrapperClassName?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 2
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setFade(f => (f.left === left && f.right === right ? f : { left, right }))
  }, [])

  // Ricalcola a ogni render (contenuto async) + su resize del contenitore.
  useEffect(() => { update() })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [update])

  return (
    <div className={`relative ${wrapperClassName}`}>
      {fade.left && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 z-20 bg-gradient-to-r from-slate-400/25 to-transparent" />
      )}
      {fade.right && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 z-20 bg-gradient-to-l from-slate-400/25 to-transparent" />
      )}
      <div ref={ref} onScroll={update} className={`overflow-x-auto ${className}`}>
        {children}
      </div>
    </div>
  )
}
