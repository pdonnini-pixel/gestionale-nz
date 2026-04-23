import { Outlet, useLocation, NavLink } from 'react-router-dom'
import { useState } from 'react'
import Sidebar, { BREADCRUMB_MAP } from './Sidebar'
import NotificationBell from './NotificationBell'
import HelpPanel from './HelpPanel'
import GlobalSearch from './GlobalSearch'
import { useAuth } from '../hooks/useAuth'
import { usePeriod } from '../hooks/usePeriod'
import {
  Menu, Search, ChevronRight,
  LayoutDashboard, Store, Receipt, User
} from 'lucide-react'

// ─── PERIOD SELECTOR ──────────────────────────────────────────
function PeriodSelector() {
  const { year, quarter, setYear, setQuarter } = usePeriod()
  const currentYear = new Date().getFullYear()
  const years = [currentYear - 1, currentYear] // Solo anni con dati + anno corrente
  const quarters = [
    { value: 'year', label: 'Anno' },
    { value: 'ytd', label: 'YTD' },
    { value: 'q1', label: 'Q1' },
    { value: 'q2', label: 'Q2' },
    { value: 'q3', label: 'Q3' },
    { value: 'q4', label: 'Q4' },
  ]

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

      <div className="w-px h-5 bg-slate-200 mx-1 hidden sm:block" />

      {/* Quarter pills */}
      <div className="hidden lg:flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
        {quarters.map(q => (
          <button
            key={q.value}
            onClick={() => setQuarter(q.value)}
            className={`px-2 py-1 rounded-md text-xs font-semibold transition ${
              quarter === q.value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>
      {/* Tablet/mobile: quarter dropdown */}
      <select
        value={quarter}
        onChange={e => setQuarter(e.target.value)}
        className="lg:hidden px-2 py-1 text-xs font-semibold bg-slate-100 border-0 rounded-lg text-slate-700"
      >
        {quarters.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
        <option value="m01">Gennaio</option>
        <option value="m02">Febbraio</option>
        <option value="m03">Marzo</option>
        <option value="m04">Aprile</option>
        <option value="m05">Maggio</option>
        <option value="m06">Giugno</option>
        <option value="m07">Luglio</option>
        <option value="m08">Agosto</option>
        <option value="m09">Settembre</option>
        <option value="m10">Ottobre</option>
        <option value="m11">Novembre</option>
        <option value="m12">Dicembre</option>
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

// ─── LAYOUT ───────────────────────────────────────────────────
export default function Layout() {
  const { profile } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

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
            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200 ml-1">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                {(profile?.first_name?.[0] || '') + (profile?.last_name?.[0] || '')}
              </div>
              <span className="text-sm text-slate-600 font-medium hidden lg:inline">
                {profile?.first_name}
              </span>
            </div>
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

      {/* Global search overlay — always mounted, internally manages open state via Cmd+K */}
      <GlobalSearch />
    </div>
  )
}
