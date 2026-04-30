import { Outlet, useLocation, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import Sidebar, { BREADCRUMB_MAP } from './Sidebar'
import NotificationBell from './NotificationBell'
import HelpPanel from './HelpPanel'
import GlobalSearch from './GlobalSearch'
import { useAuth } from '../hooks/useAuth'
import { usePeriod } from '../hooks/usePeriod'
import {
  Menu, Search, ChevronRight,
  LayoutDashboard, Store, Receipt, User,
  UserCircle, Settings, LogOut
} from 'lucide-react'

// ─── PERIOD SELECTOR ──────────────────────────────────────────
// Solo selettore Anno (YTD/Q1-Q4 rimossi su richiesta utente: l'app non
// ha bisogno di filtri per quarter dall'header globale; le pagine che
// vogliono filtrare per quarter possono offrire un selettore locale.
// Il PeriodContext mantiene quarter='year' di default per non rompere
// le pagine che leggono getDateRange()).
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
        onChange={e => setYear(Number(e.target.value))}
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
  const path = '/' + location.pathname.split('/').filter(Boolean).join('/')
  const crumb = BREADCRUMB_MAP[path === '/' ? '/' : path]

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
// Fix 9.2: l'avatar+nome utente non era cliccabile (era un <div>).
// Ora apre un dropdown con: Profilo, Impostazioni, Esci.
function ProfileMenu() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Click-outside per chiudere il menu
  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onEsc(e) {
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

  function go(path) {
    setOpen(false)
    navigate(path)
  }

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 pl-2 border-l border-slate-200 ml-1 py-1 pr-2 rounded-r-lg hover:bg-slate-50 transition"
        title={fullName || 'Profilo'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
          {initials || <User size={14} />}
        </div>
        <span className="text-sm text-slate-600 font-medium hidden lg:inline">
          {profile?.first_name}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50"
        >
          <div className="px-3 py-2 border-b border-slate-100">
            <div className="text-sm font-semibold text-slate-900 truncate">
              {fullName || 'Utente'}
            </div>
            {profile?.email && (
              <div className="text-xs text-slate-500 truncate">{profile.email}</div>
            )}
          </div>
          <button
            role="menuitem"
            onClick={() => go('/impostazioni')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            <UserCircle size={16} className="text-slate-400" />
            Profilo
          </button>
          <button
            role="menuitem"
            onClick={() => go('/impostazioni')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            <Settings size={16} className="text-slate-400" />
            Impostazioni
          </button>
          <div className="border-t border-slate-100 my-1" />
          <button
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
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // Fix 9.3: shortcut Cmd+K (Mac) / Ctrl+K (Win) per aprire la ricerca
  // globale. Centralizzato qui in modo che lo stesso stato controlli sia
  // il pulsante search del topbar che lo shortcut da tastiera.
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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

          {/* Center: Period selector */}
          <PeriodSelector />

          {/* Right: search + notifications + avatar */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition"
              title="Cerca (⌘K)"
            >
              <Search size={18} />
            </button>
            <NotificationBell />
            <ProfileMenu />
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-slate-50 pb-16 md:pb-0">
          <Outlet />
        </main>

        {/* Bottom nav (mobile) */}
        <BottomNav />

        {/* Help panel */}
        <HelpPanel />
      </div>

      {/* Global search overlay — controlled da Layout, apribile via Cmd+K o pulsante topbar */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
