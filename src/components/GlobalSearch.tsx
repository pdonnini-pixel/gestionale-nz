import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Store, Building2, Receipt, Landmark, Users, FileText, ArrowRight, LucideIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

interface SearchCategory {
  key: string
  label: string
  icon: LucideIcon
  color: string
}

interface SearchResult {
  id: string
  title: string
  subtitle?: string
  url: string
  category?: string
}

const SEARCH_CATEGORIES: SearchCategory[] = [
  { key: 'outlets', label: 'Outlet', icon: Store, color: 'blue' },
  { key: 'suppliers', label: 'Fornitori', icon: Building2, color: 'purple' },
  { key: 'invoices', label: 'Fatture', icon: Receipt, color: 'emerald' },
  { key: 'movements', label: 'Movimenti', icon: Landmark, color: 'amber' },
  { key: 'employees', label: 'Dipendenti', icon: Users, color: 'sky' },
]

// Fix 9.3: GlobalSearch ora accetta `open`/`onClose` come prop per poter
// essere aperto sia da Cmd+K che dal pulsante search del topbar. Se le
// prop non sono fornite, mantiene retro-compatibilità con stato interno.
interface GlobalSearchProps {
  open?: boolean
  onClose?: () => void
}

export default function GlobalSearch({ open: openProp, onClose }: GlobalSearchProps) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const COMPANY_ID = profile?.company_id
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp !== undefined ? openProp : internalOpen
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    if (openProp !== undefined) {
      // Modalità controllata: chiudo via callback
      if (!v && onClose) onClose()
    } else {
      setInternalOpen(typeof v === 'function' ? v(internalOpen) : v)
    }
  }
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Record<string, SearchResult[]>>({})
  const [loading, setLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cmd+K shortcut — solo se non controllato dall'esterno
  useEffect(() => {
    if (openProp !== undefined) return
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setInternalOpen(prev => !prev)
      }
      if (e.key === 'Escape') setInternalOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openProp])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
      setQuery('')
      setResults({})
      setSelectedIdx(0)
    }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.length < 2 || !COMPANY_ID) {
      setResults({})
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query.trim()), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, COMPANY_ID])

  async function doSearch(q: string) {
    setLoading(true)
    const qLower = `%${q}%`
    const res: Record<string, SearchResult[]> = {}

    try {
      // Fix 9.3: query suppliers usava 'business_name' che non esiste → la
      // tabella ha 'ragione_sociale' (campo IT) con fallback 'name' (campo
      // legacy), 'partita_iva' (con fallback 'vat_number').
      const [outlets, suppliers, invoices, movements, employees] = await Promise.all([
        supabase.from('outlets').select('id, name, city').eq('company_id', COMPANY_ID).ilike('name', qLower).limit(5),
        supabase.from('suppliers').select('id, ragione_sociale, name, partita_iva, vat_number').eq('company_id', COMPANY_ID).or(`ragione_sociale.ilike.${qLower},name.ilike.${qLower}`).limit(5),
        supabase.from('electronic_invoices').select('id, invoice_number, supplier_name, total_amount').eq('company_id', COMPANY_ID).or(`invoice_number.ilike.${qLower},supplier_name.ilike.${qLower}`).limit(5),
        supabase.from('cash_movements').select('id, description, counterpart, amount, date').eq('company_id', COMPANY_ID).or(`description.ilike.${qLower},counterpart.ilike.${qLower}`).limit(5),
        supabase.from('user_profiles').select('id, first_name, last_name, role').eq('company_id', COMPANY_ID).or(`first_name.ilike.${qLower},last_name.ilike.${qLower}`).limit(5),
      ])

      if (outlets.data?.length) res.outlets = outlets.data.map(o => ({ id: o.id, title: o.name, subtitle: o.city, url: '/outlet' }))
      if (suppliers.data?.length) res.suppliers = suppliers.data.map(s => ({
        id: s.id,
        title: s.ragione_sociale || s.name || '—',
        subtitle: s.partita_iva || s.vat_number || '',
        url: `/fornitori/${s.id}/scheda-contabile`,
      }))
      if (invoices.data?.length) res.invoices = invoices.data.map(i => ({ id: i.id, title: `${i.invoice_number || 'Fattura'}`, subtitle: `${i.supplier_name || ''} — €${Number(i.total_amount || 0).toLocaleString('it-IT')}`, url: '/fatturazione' }))
      if (movements.data?.length) res.movements = movements.data.map(m => ({ id: m.id, title: m.counterpart || m.description?.slice(0, 50), subtitle: `€${Number(m.amount || 0).toLocaleString('it-IT')} — ${m.date}`, url: '/banche' }))
      if (employees.data?.length) res.employees = employees.data.map(e => ({ id: e.id, title: `${e.first_name} ${e.last_name}`, subtitle: e.role, url: '/dipendenti' }))
    } catch (err: unknown) {
      console.warn('Search error:', err)
    }

    setResults(res)
    setSelectedIdx(0)
    setLoading(false)
  }

  // Flatten results for keyboard navigation
  const flatResults = Object.entries(results).flatMap(([cat, items]) =>
    items.map(item => ({ ...item, category: cat }))
  )

  function handleSelect(item: SearchResult) {
    navigate(item.url)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, flatResults.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && flatResults[selectedIdx]) { handleSelect(flatResults[selectedIdx]) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Cerca outlet, fornitori, fatture, movimenti..."
            className="flex-1 text-sm text-slate-900 placeholder-slate-400 outline-none bg-transparent"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 rounded border border-slate-200">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {query.length < 2 && (
            <div className="py-8 text-center text-sm text-slate-400">
              Digita almeno 2 caratteri per cercare
            </div>
          )}
          {query.length >= 2 && loading && (
            <div className="py-8 text-center text-sm text-slate-400">Ricerca in corso...</div>
          )}
          {query.length >= 2 && !loading && flatResults.length === 0 && (
            <div className="py-8 text-center text-sm text-slate-400">Nessun risultato per "{query}"</div>
          )}
          {Object.entries(results).map(([catKey, items]) => {
            const cat = SEARCH_CATEGORIES.find(c => c.key === catKey)
            if (!cat || !items.length) return null
            const CatIcon = cat.icon
            return (
              <div key={catKey}>
                <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50">
                  {cat.label}
                </div>
                {items.map((item, i) => {
                  const globalIdx = flatResults.findIndex(r => r.id === item.id && r.category === catKey)
                  const isSelected = globalIdx === selectedIdx
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIdx(globalIdx)}
                      className={`flex items-center gap-3 w-full px-4 py-2.5 text-left transition ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <CatIcon size={16} className={`text-${cat.color}-500 shrink-0`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-800 truncate">{item.title}</div>
                        {item.subtitle && <div className="text-xs text-slate-400 truncate">{item.subtitle}</div>}
                      </div>
                      {isSelected && <ArrowRight size={14} className="text-blue-500 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
