import React from 'react'
import { Outlet, useLocation, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect, useMemo, useRef } from 'react'
import Sidebar, { buildBreadcrumbMap } from './Sidebar'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import NotificationBell from './NotificationBell'
import HelpPanel from './HelpPanel'
import GlobalSearch from './GlobalSearch'
import { useAuth } from '../hooks/useAuth'
import { usePeriod } from '../hooks/usePeriod'
import { getCurrentTenant } from '../lib/tenants'
import {
  Menu, Search, ChevronRight,
  LayoutDashboard, Store, Receipt, User,
  UserCircle, Settings, LogOut, Building2
} from 'lucide-react'

// ─── TENANT BADGE ─────────────────────────────────────────────
// Banda colorata sempre visibile in cima all'app: serve a Sabrina/Veronica
// (che lavorano su 3 tenant nello stesso flusso) per non confondere su quale
// tenant stanno operando. Mitigazione esplicita della "trappola n°1 day 1"
// in CLAUDE.md (§Trappole multi-tenant).
function TenantBadge() {
  const tenant = getCurrentTenant()
  return (
    <div
      className="h-7 shrink-0 flex items-center px-3 sm:px-4 text-white text-xs font-semibold gap-2"
      style={{ background: tenant.accentBg }}
      title={`Stai operando sul tenant ${tenant.displayName}. Per cambiare tenant, apri una nuova tab con un altro subdomain.`}
    >
      <Building2 size={14} className="opacity-90 shrink-0" />
      <span className="opacity-90">Tenant attivo:</span>
      <span className="font-bold tracking-wide truncate" title={tenant.displayName}>{tenant.displayName}</span>
      <span className="ml-auto opacity-80 hidden md:inline truncate">
        Per cambiare tenant, apri una nuova tab.
      </span>
    </div>
  )
}

// ─── PERIOD SELECTOR ──────────────────────────────────────────
function PeriodSelector() {
  const { year, setYear } = usePeriod()
  const currentYear = new Date().getFullYear()
  const years = [currentYear - 2, currentYear - 1, currentYear]

  return (
    <div className="flex items-center gap-1">
      {/* Year pills */}
      <div className="hidden sm:flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
        {years.map(y => (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
              year === y ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {y}
          </button>
        ))}
      </div>
      {/* Mobile: year dropdown */}
      <select
        value={year}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setYear(Number(e.target.value))}
        className="sm:hidden px-2 py-1 text-xs font-semibold bg-slate-100 border-0 rounded-lg text-slate-700"
      >
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

// ─── BREADCRUMB ───────────────────────────────────────────────
function Breadcrumb() {
  const location = useLocation()
  const labels = useCompanyLabels()
  const path = '/' + location.pathname.split('/').filter(Boolean).join('/')
  const breadcrumbMap = useMemo(() => buildBreadcrumbMap(labels), [labels])
  const crumb = breadcrumbMap[path === '/' ? '/' : path]

  if (!crumb || path === '/') return null

  return (
    <nav className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 px-1">
      <span className="text-slate-400">{crumb.section}</span>
      <ChevronRight size={12} className="text-slate-300" />
      <span className="text-slate-700 font-medium">{crumb.page}</span>
    </nav>
  )
}

// ─── BOTTOM NAV (Mobile) ──────────────────────────────────────
function BottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 safe-area-pb">
      <div className="flex items-center justify-around h-14">
        {[
          { to: '/', icon: LayoutDashboard, label: 'Home', end: true },
          { to: '/outlet', icon: Store, label: 'Outlet' },
          { to: '/scadenzario', icon: Receipt, label: 'Scadenze' },
          { to: '/impostazioni', icon: User, label: 'Profilo' },
        ].map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition ${
                isActive ? 'text-blue-600' : 'text-slate-400'
              }`
            }
          >
            <item.icon size={20} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

// ─── PROFILE MENU ─────────────────────────────────────────────
function ProfileMenu() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const initials = (profile?.first_name?.[0] || '') + (profile?.last_name?.[0] || '')
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  function go(path: string) {
    setOpen(false)
    navigate(path)
  }

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="flex items-center gap-2 pl-2 border-l border-slate-200 ml-1 py-1 pr-2 rounded-r-lg hover:bg-slate-50 transition cursor-pointer"
        title={fullName || 'Profilo'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 pointer-events-none">
          {initials || <User size={14} />}
        </div>
        <span className="text-sm text-slate-600 font-medium hidden lg:inline pointer-events-none">
          {profile?.first_name}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-[60]"
        >
          <div className="px-3 py-2 border-b border-slate-100">
            <div className="text-sm font-semibold text-slate-900 truncate">
              {fullName || 'Utente'}
            </div>
            {profile?.email && (
              <div className="text-xs text-slate-500 truncate" title={profile.email}>{profile.email}</div>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => go('/profilo')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            <UserCircle size={16} className="text-slate-400" />
            Profilo
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => go('/impostazioni')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            <Settings size={16} className="text-slate-400" />
            Impostazioni azienda
          </button>
          <div className="border-t border-slate-100 my-1" />
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
          >
            <LogOut size={16} />
            Esci
          </button>
        </div>
      )}
    </div>
  )
}

// ─── LAYOUT ───────────────────────────────────────────────────
export default function Layout() {
  const location = useLocation()
  const { profile } = useAuth()
  const isViewer = profile?.role === 'viewer'
  // Lo Scadenzario è un flusso "giorno-1" su un singolo elenco di scadenze:
  // il selettore anni globale non filtra la lista (le scadenze derivano dalle
  // loro date, non dall'anno selezionato) e ingannava l'utente. Nascosto SOLO
  // qui; resta attivo su tutte le altre pagine.
  const path = '/' + location.pathname.split('/').filter(Boolean).join('/')
  const hidePeriodSelector = path === '/scadenzario'
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Badge sidebar: numero ticket dell'autore con aggiornamenti non visti.
  // Si ricarica all'avvio, e ogni volta che il dettaglio ticket emette
  // l'evento 'ticket-seen' (dopo che l'autore l'ha aperto).
  const [ticketUnseen, setTicketUnseen] = useState(0)
  // Badge Fatturazione: anomalie di configurazione pagamento fornitore aperte
  // (stato condiviso azienda). Sparisce solo quando risolte.
  const [fattAnomalie, setFattAnomalie] = useState(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    async function fetchUnseen() {
      try {
        const { supabase } = await import('../lib/supabase')
        const { data, error } = await supabase.rpc('get_unseen_ticket_updates_count' as never)
        if (!error && typeof data === 'number') setTicketUnseen(data)
      } catch (e) {
        console.warn('[ticket-unseen]', e)
      }
    }
    void fetchUnseen()
    // Ricalcola dopo che l'autore ha aperto un ticket (mark_ticket_seen)
    function onSeen() { void fetchUnseen() }
    window.addEventListener('ticket-seen', onSeen)
    // Refresh periodico ogni 60s (per nuovi commenti AI mentre l'app è aperta)
    const t = setInterval(fetchUnseen, 60_000)
    return () => { window.removeEventListener('ticket-seen', onSeen); clearInterval(t) }
  }, [])

  useEffect(() => {
    async function fetchAnomalie() {
      try {
        const { supabase } = await import('../lib/supabase')
        // Tabella non ancora nei tipi generati (database.ts): cast minimale.
        const sb = supabase as unknown as {
          from: (t: string) => {
            select: (c: string, o?: unknown) => {
              eq: (col: string, val: string) => Promise<{ count: number | null; error: unknown }>
            }
          }
        }
        const { count, error } = await sb
          .from('payment_import_anomalies')
          .select('id', { count: 'exact', head: true })
          .eq('stato', 'aperta')
        if (!error && typeof count === 'number') setFattAnomalie(count)
      } catch (e) {
        console.warn('[fatt-anomalie]', e)
      }
    }
    void fetchAnomalie()
    // Ricalcola quando un'anomalia viene risolta dal pannello Fatturazione
    function onResolved() { void fetchAnomalie() }
    window.addEventListener('fatt-anomalia-risolta', onResolved)
    const t = setInterval(fetchAnomalie, 60_000)
    return () => { window.removeEventListener('fatt-anomalia-risolta', onResolved); clearInterval(t) }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} badges={{ 'ticket-unseen': ticketUnseen, 'fatt-anomalie': fattAnomalie }} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Tenant badge (banda colorata) */}
        <TenantBadge />

        {/* Top bar */}
        <header className="h-12 shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-3 sm:px-4 gap-2">
          {/* Left: hamburger (mobile) + breadcrumb */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 md:hidden shrink-0"
            >
              <Menu size={20} />
            </button>
            <Breadcrumb />
          </div>

          {/* Center: Period selector (nascosto su /scadenzario — vedi sopra) */}
          {!hidePeriodSelector && <PeriodSelector />}

          {/* Right: search + notifications + avatar */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition"
              title="Cerca (\u2318K)"
            >
              <Search size={18} />
            </button>
            <NotificationBell />
            <ProfileMenu />
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-slate-50 pb-16 md:pb-0">
          {isViewer && (
            <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-1.5 text-center">
              Modalità <strong>sola lettura</strong>: puoi consultare i dati ma non modificarli.
            </div>
          )}
          <Outlet />
        </main>

        {/* Bottom nav (mobile) */}
        <BottomNav />

        {/* Help panel */}
        <HelpPanel />
      </div>

      {/* Global search overlay */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
