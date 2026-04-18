import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCompany } from '../hooks/useCompany'
import {
  LayoutDashboard, Store, Receipt, Building2, Users, FileText,
  Settings, LogOut, ChevronDown, ChevronRight,
  Landmark, BarChart3, GitCompare, Calculator,
  Package, CreditCard, Wallet, ShoppingBag, UserCheck, Map, PieChart,
  CalendarClock, ClipboardList, DatabaseZap, Archive,
  Building, ChevronsUpDown, FileCode, Brain, Sparkles, AlertTriangle,
  Menu, X, Home, TrendingUp, FileStack, Bot, Wrench
} from 'lucide-react'
import { useState, useRef, useEffect, useMemo, createContext, useContext } from 'react'

// ─── MOBILE CONTEXT ────────────────────────────────────────────
const SidebarContext = createContext({ mobileOpen: false, setMobileOpen: () => {} })
export function useSidebar() { return useContext(SidebarContext) }
export { SidebarContext }

// ─── NAVIGATION STRUCTURE (grouped by area) ────────────────────
// Ogni sezione ha: key, label, icon, items[]
// items filtrate per ruolo a runtime

const allSections = [
  {
    key: 'cruscotto',
    label: 'Cruscotto',
    icon: Home,
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['super_advisor', 'ceo', 'cfo', 'coo', 'contabile'] },
    ]
  },
  {
    key: 'finanza',
    label: 'Finanza',
    icon: TrendingUp,
    items: [
      { to: '/banche', icon: Landmark, label: 'Tesoreria', roles: ['super_advisor', 'ceo', 'cfo', 'contabile'] },
      { to: '/cash-flow', icon: Wallet, label: 'Cashflow', roles: ['super_advisor', 'ceo', 'cfo'] },
      { to: '/conto-economico', icon: BarChart3, label: 'Conto Economico', roles: ['super_advisor', 'ceo', 'cfo'] },
    ]
  },
  {
    key: 'outlet',
    label: 'Outlet & Performance',
    icon: Store,
    items: [
      { to: '/outlet', icon: Store, label: 'Outlet', roles: ['super_advisor', 'ceo', 'coo'] },
      { to: '/confronto-outlet', icon: GitCompare, label: 'Confronto Outlet', roles: ['super_advisor', 'ceo', 'cfo'] },
      { to: '/budget', icon: Calculator, label: 'Budget', roles: ['super_advisor', 'ceo', 'cfo'] },
    ]
  },
  {
    key: 'ciclo_passivo',
    label: 'Ciclo Passivo',
    icon: FileStack,
    items: [
      { to: '/fornitori', icon: Building2, label: 'Fornitori', roles: ['super_advisor', 'cfo', 'contabile'] },
      { to: '/fatturazione', icon: FileCode, label: 'Fatturazione', roles: ['super_advisor', 'cfo', 'contabile'] },
      { to: '/scadenzario', icon: Receipt, label: 'Scadenzario', roles: ['super_advisor', 'ceo', 'cfo', 'contabile'] },
    ]
  },
  {
    key: 'risorse',
    label: 'Risorse',
    icon: Users,
    items: [
      { to: '/dipendenti', icon: Users, label: 'Dipendenti', roles: ['super_advisor', 'coo'] },
    ]
  },
  {
    key: 'ai_analytics',
    label: 'AI & Analytics',
    icon: Bot,
    items: [
      { to: '/ai-categorie', icon: Sparkles, label: 'Categorizzazione AI', roles: ['super_advisor', 'cfo'] },
      { to: '/margini', icon: PieChart, label: 'Margini Outlet', roles: ['super_advisor', 'ceo', 'cfo'] },
      { to: '/produttivita', icon: UserCheck, label: 'Produttività', roles: ['super_advisor', 'ceo', 'coo'] },
      { to: '/scenario', icon: Map, label: 'Scenario Planning', roles: ['super_advisor', 'ceo'] },
    ]
  },
  {
    key: 'sistema',
    label: 'Sistema',
    icon: Wrench,
    items: [
      { to: '/import-hub', icon: DatabaseZap, label: 'Import Hub', roles: ['super_advisor', 'cfo', 'contabile'] },
      { to: '/archivio', icon: Archive, label: 'Archivio Documenti', roles: ['super_advisor', 'cfo', 'contabile'] },
      { to: '/impostazioni', icon: Settings, label: 'Impostazioni', roles: ['super_advisor'] },
    ]
  },
]

// ─── BREADCRUMB MAP (exported for use in Layout) ───────────────
export const BREADCRUMB_MAP = {
  '/': { section: 'Cruscotto', page: 'Dashboard' },
  '/banche': { section: 'Finanza', page: 'Tesoreria' },
  '/cash-flow': { section: 'Finanza', page: 'Cashflow' },
  '/conto-economico': { section: 'Finanza', page: 'Conto Economico' },
  '/outlet': { section: 'Outlet & Performance', page: 'Outlet' },
  '/confronto-outlet': { section: 'Outlet & Performance', page: 'Confronto Outlet' },
  '/budget': { section: 'Outlet & Performance', page: 'Budget' },
  '/fornitori': { section: 'Ciclo Passivo', page: 'Fornitori' },
  '/fatturazione': { section: 'Ciclo Passivo', page: 'Fatturazione' },
  '/scadenzario': { section: 'Ciclo Passivo', page: 'Scadenzario' },
  '/scadenze-fiscali': { section: 'Ciclo Passivo', page: 'Scadenze Fiscali' },
  '/dipendenti': { section: 'Risorse', page: 'Dipendenti' },
  '/ai-categorie': { section: 'AI & Analytics', page: 'Categorizzazione AI' },
  '/margini': { section: 'AI & Analytics', page: 'Margini Outlet' },
  '/produttivita': { section: 'AI & Analytics', page: 'Produttività' },
  '/scenario': { section: 'AI & Analytics', page: 'Scenario Planning' },
  '/import-hub': { section: 'Sistema', page: 'Import Hub' },
  '/archivio': { section: 'Sistema', page: 'Archivio Documenti' },
  '/impostazioni': { section: 'Sistema', page: 'Impostazioni' },
}

export default function Sidebar({ mobileOpen, setMobileOpen }) {
  const { profile, signOut } = useAuth()
  const { company, companies, switchCompany } = useCompany()
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false)
  const [openSections, setOpenSections] = useState({ cruscotto: true, finanza: true, outlet: true, ciclo_passivo: true, risorse: true, ai_analytics: false, sistema: false })
  const dropdownRef = useRef(null)
  const location = useLocation()
  const role = profile?.role || 'ceo'

  const roleLabels = {
    super_advisor: 'Super Advisor',
    ceo: 'CEO', cfo: 'CFO', coo: 'COO',
    contabile: 'Contabile'
  }

  // Filter sections by role
  const sections = useMemo(() => {
    return allSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => item.roles.includes(role))
      }))
      .filter(section => section.items.length > 0)
  }, [role])

  // Auto-open section containing current route
  useEffect(() => {
    const path = location.pathname
    for (const section of sections) {
      if (section.items.some(item => item.to === path || (item.to !== '/' && path.startsWith(item.to)))) {
        setOpenSections(prev => ({ ...prev, [section.key]: true }))
        break
      }
    }
  }, [location.pathname])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setCompanyDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (mobileOpen) setMobileOpen(false)
  }, [location.pathname])

  const companyAbbrev = company?.name
    ? company.name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3)
    : '...'

  const toggleSection = (key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderNavItem = (item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
          isActive
            ? 'bg-blue-600 text-white shadow-sm'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`
      }
    >
      <item.icon size={18} />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )

  const sidebarContent = (
    <>
      {/* Header — Company Selector */}
      <div className="p-3 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center justify-between">
          <div className="relative flex-1 mr-2" ref={dropdownRef}>
            <button
              onClick={() => companies.length > 1 && setCompanyDropdownOpen(!companyDropdownOpen)}
              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg transition text-left ${
                companies.length > 1 ? 'hover:bg-slate-800 cursor-pointer' : 'cursor-default'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                {companyAbbrev}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{company?.name || 'Caricamento...'}</div>
                {company?.vat_number && (
                  <div className="text-[10px] text-slate-400 truncate">P.IVA {company.vat_number}</div>
                )}
              </div>
              {companies.length > 1 && (
                <ChevronsUpDown size={14} className="text-slate-400 shrink-0" />
              )}
            </button>

            {companyDropdownOpen && companies.length > 1 && (
              <div className="absolute left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 py-1 max-h-60 overflow-y-auto">
                {companies.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { switchCompany(c.id); setCompanyDropdownOpen(false) }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-left text-sm transition ${
                      c.id === company?.id ? 'bg-blue-600/20 text-blue-300' : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <Building size={14} />
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Close button on mobile */}
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition shrink-0 md:hidden"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Navigation — Grouped Sections */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-0.5">
        {sections.map(section => {
          const SectionIcon = section.icon
          const isOpen = openSections[section.key] !== false
          // Single-item sections (Cruscotto) render inline
          if (section.items.length === 1 && section.key === 'cruscotto') {
            return renderNavItem(section.items[0])
          }

          return (
            <div key={section.key}>
              <button
                onClick={() => toggleSection(section.key)}
                className="flex items-center justify-between w-full px-3 py-2 mt-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition"
              >
                <div className="flex items-center gap-2">
                  <SectionIcon size={13} />
                  <span>{section.label}</span>
                </div>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              {isOpen && (
                <div className="space-y-0.5 mt-0.5 ml-1">
                  {section.items.map(item => renderNavItem(item))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-slate-700/50 shrink-0">
        <div className="mb-2 px-2">
          <div className="text-sm font-medium">{profile?.first_name} {profile?.last_name}</div>
          <div className="text-xs text-slate-400">{roleLabels[profile?.role]}</div>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition"
        >
          <LogOut size={18} />
          <span>Esci</span>
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 h-screen bg-slate-900 text-white flex-col shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-slate-900 text-white flex flex-col shadow-2xl">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  )
}
