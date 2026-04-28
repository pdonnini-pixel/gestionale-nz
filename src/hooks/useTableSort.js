/**
 * useTableSort — hook condiviso per l'ordinamento delle tabelle.
 *
 * UX standard:
 *   - Click colonna: cicla NONE → ASC → DESC → NONE
 *   - Shift+Click: aggiunge ordinamento secondario (ordine multiplo)
 *   - reset() rimuove tutti gli ordinamenti
 *
 * Caratteristiche:
 *   - Path nested supportati (key='suppliers.ragione_sociale')
 *   - Type-aware: number / Date / string (localeCompare con numeric:true,
 *     così "Fattura 2" precede "Fattura 10")
 *   - null/undefined SEMPRE in fondo a prescindere dalla direzione
 *
 * Persistenza opzionale:
 *   - persistKey: chiave localStorage; se valorizzata salva il sortBy
 *     fra refresh.
 *
 * Reset automatico:
 *   - resetOn: array di dipendenze. Quando cambia uno qualsiasi (es. l'anno
 *     selezionato nel filtro globale), torna al defaultSort e cancella
 *     l'eventuale storage.
 */

import { useState, useMemo, useEffect, useRef } from 'react'

function getValue(obj, path) {
  if (!obj) return undefined
  if (!path) return undefined
  if (!path.includes('.')) return obj[path]
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

function loadFromStorage(key, fallback) {
  if (!key || typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(`tablesort:${key}`)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch (e) {
    // ignore parse errors
  }
  return fallback
}

function saveToStorage(key, value) {
  if (!key || typeof window === 'undefined') return
  try {
    if (!value || value.length === 0) {
      window.localStorage.removeItem(`tablesort:${key}`)
    } else {
      window.localStorage.setItem(`tablesort:${key}`, JSON.stringify(value))
    }
  } catch (e) {
    // ignore quota errors
  }
}

export function useTableSort(rows, defaultSort = [], options = {}) {
  const { persistKey = null, resetOn = null } = options

  const [sortBy, setSortBy] = useState(() => loadFromStorage(persistKey, defaultSort))

  // Reset automatico quando cambiano le dipendenze in resetOn (es. cambio anno).
  // Skip al primo mount per non sovrascrivere il valore caricato da storage.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (resetOn != null) {
      setSortBy(defaultSort)
      if (persistKey) saveToStorage(persistKey, [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, Array.isArray(resetOn) ? resetOn : [resetOn])

  // Persisti ad ogni cambio
  useEffect(() => {
    if (persistKey) saveToStorage(persistKey, sortBy)
  }, [sortBy, persistKey])

  const sorted = useMemo(() => {
    if (!sortBy || sortBy.length === 0) return rows
    return [...rows].sort((a, b) => {
      for (const { key, dir } of sortBy) {
        const av = getValue(a, key)
        const bv = getValue(b, key)
        const aNull = av == null || av === ''
        const bNull = bv == null || bv === ''
        if (aNull && bNull) continue
        if (aNull) return 1   // null sempre in fondo
        if (bNull) return -1
        let cmp = 0
        // Provo prima il confronto numerico: Supabase puo' ritornare i
        // gross_amount come stringhe, quindi typeof potrebbe essere 'string'
        // ma il valore e' un numero. Number(av) ritorna NaN per stringhe non
        // numeriche → in quel caso ricado sul confronto string locale.
        const an = typeof av === 'number' ? av : Number(av)
        const bn = typeof bv === 'number' ? bv : Number(bv)
        const isNumericPair = !isNaN(an) && !isNaN(bn)
          && (typeof av === 'number' || /^-?\d+([.,]\d+)?$/.test(String(av).trim()))
          && (typeof bv === 'number' || /^-?\d+([.,]\d+)?$/.test(String(bv).trim()))
        if (isNumericPair) {
          cmp = an - bn
        } else if (av instanceof Date || bv instanceof Date) {
          cmp = new Date(av).getTime() - new Date(bv).getTime()
        } else if (
          typeof av === 'string' && /^\d{4}-\d{2}-\d{2}/.test(av) &&
          typeof bv === 'string' && /^\d{4}-\d{2}-\d{2}/.test(bv)
        ) {
          // ISO date string: confronto stringa OK (lessicografico = cronologico)
          cmp = av < bv ? -1 : av > bv ? 1 : 0
        } else {
          cmp = String(av).localeCompare(String(bv), 'it', { numeric: true, sensitivity: 'base' })
        }
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
      }
      return 0
    })
  }, [rows, sortBy])

  const onSort = (key, multi = false) => {
    setSortBy(prev => {
      const existing = prev.find(s => s.key === key)
      const others = multi ? prev.filter(s => s.key !== key) : []
      if (!existing) return [...others, { key, dir: 'asc' }]
      if (existing.dir === 'asc') return [...others, { key, dir: 'desc' }]
      // dir === 'desc' → cycle off (rimuovi)
      return others
    })
  }

  const reset = () => setSortBy(defaultSort)

  return { sorted, sortBy, onSort, reset }
}
