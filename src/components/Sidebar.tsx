import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCompany } from '../hooks/useCompany'
import {
  LayoutDashboard, Store, FileText, Users, Settings, LogOut,
  ChevronDown, ChevronRight, Landmark, BarChart3, GitCompare, Target,
  CalendarClock, UserCheck, PieChart, Sparkles, Activity, Sliders,
  Upload, FolderArchive, TrendingUp, ChevronsUpDown, Building,
  Menu, X, ChevronsLeft, ChevronsRight, Split,
  LucideIcon
} from 'lucide-react'
import { useState, useRef, useEffect, useMemo, createContext, useContext } from 'react'

// ─── MOBILE CONTEXT ────────────────────────────────────────────
interface SidebarContextValue {
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue>({ mobileOpen: false, setMobileOpen: () => {} })
export function useSidebar() { return useContext(SidebarContext) }
export { SidebarContext }

// ─── NAVIGATION STRUCTURE (grouped by area) ────────────────────
interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  roles: string[]
  badgeKey?: string
}

interface NavSection {
  key: string
  label: string
  items: NavItem[]
}

const allSections: NavSection[] = [
  {
    key: 'cruscotto',
    label: 'Cruscotto',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['super_advisor', 'ceo', 'cfo', 'coo', 'contabile'] },
    ]
  },
  {
    key: 'finanza',
    label: 'Finanza',
    items: [
      { to: '/banche', icon: Landmark, label: 'Banche', roles: ['super_advisor', 'ceo', 'cfo', 'contabile'] },
      { to: '/cash-flow', icon: TrendingUp, label: 'Cashflow', roles: ['super_advisor', 'ceo', 'cfo'] },
      { to: '/conto-economico', icon: BarChart3, label: 'Conto Economico', roles: ['super_advisor', 'ceo', 'cfo'] },
    ]
  },
  {
    key: 'outlet',
    label: 'Outlet & Performance',
    items: [
      { to: '/outlet', icon: Store, label: 'Outlet', roles: ['super_advisor', 'ceo', 'coo'] },
      { to: '/confronto-outlet', icon: GitCompare, label: 'Confronto Outlet', roles: ['super_advisor', 'ceo', 'cfo'] },
      { to: '/budget', icon: Target, label: 'Budget & Controllo', roles: ['super_advisor', 'ceo', 'cfo'] },
    ]
  },
  {
    key: 'ciclo_passivo',
    label: 'Ciclo Passivo',
    items: [
      { to: '/fornitori', icon: Users, label: 'Fornitori', roles: ['super_advisor', 'cfo', 'contabile'] },
      { to: '/allocazione-fornitori', icon: Split, label: 'Divisione Fornitori', roles: ['super_advisor', 'cfo', 'contabile'] },
      { to: '/fatturazione', icon: FileText, label: 'Fatturazione', roles: ['super_advisor', 'cfo', 'contabile'] },
      { to: '/scadenzario', icon: CalendarClock, label: 'Scadenzario', badgeKey: 'scadenzario', roles: ['super_advisor', 'ceo', 'cfo', 'contabile'] },
    ]
  },
  {
    key: 'risorse',
    label: 'Risorse',
    items: [
      { to: '/dipendenti', icon: UserCheck, label: 'Dipendenti', roles: ['super_advisor', 'coo'] },
    ]
  },
  {
    key: 'ai_analytics',
    label: 'AI & Analytics',
    items: [
      { to: '/ai-categorie', icon: Sparkles, label: 'AI Categorie', roles: ['super_advisor', 'cfo'] },
      { to: '/margini', icon: PieChart, label: 'Margini Outlet', roles: ['super_advisor', 'ceo', 'cfo'] },
      { to: '/produttivita', icon: Activity, label: 'Produttività', roles: ['super_advisor', 'ceo', 'coo'] },
      { to: '/scenario', icon: Sliders, label: 'Scenario Planning', roles: ['super_advisor', 'ceo'] },
    ]
  },
  {
    key: 'sistema',
    label: 'Sistema',
    items: [
      { to: '/import-hub', icon: Upload, label: 'Import Hub', roles: ['super_advisor', 'cfo', 'contabile'] },
      { to: '/archivio', icon: FolderArchive, label: 'Archivio Documenti', roles: ['super_advisor', 'cfo', 'contabile'] },
      { to: '/impostazioni', icon: Settings, label: 'Impostazioni', roles: ['super_advisor'] },
    ]
  },
]

// ─── BREADCRUMB MAP (exported for use in Layout) ───────────────
export const BREADCRUMB_MAP: Record<string, { section: string; page: string }> = {
  '/': { section: 'Cruscotto', page: 'Dashboard' },
  '/banche': { section: 'Finanza', page: 'Banche' },
  '/cash-flow': { section: 'Finanza', page: 'Cashflow' },
  '/conto-economico': { section: 'Finanza', page: 'Conto Economico' },
  '/outlet': { section: 'Outlet & Performance', page: 'Outlet' },
  '/confronto-outlet': { section: 'Outlet & Performance', page: 'Confronto Outlet' },
  '/budget': { section: 'Outlet & Performance', page: 'Budget & Controllo' },
  '/fornitori': { section: 'Ciclo Passivo', page: 'Fornitori' },
  '/allocazione-fornitori': { section: 'Ciclo Passivo', page: 'Divisione Fornitori' },
  '/fatturazione': { section: 'Ciclo Passivo', page: 'Fatturazione' },
  '/scadenzario': { section: 'Ciclo Passivo', page: 'Scadenzario' },
  '/scadenze-fiscali': { section: 'Ciclo Passivo', page: 'Scadenze Fiscali' },
  '/dipendenti': { section: 'Risorse', page: 'Dipendenti' },
  '/ai-categorie': { section: 'AI & Analytics', page: 'AI Categorie' },
  '/margini': { section: 'AI & Analytics', page: 'Margini Outlet' },
  '/produttivita': { section: 'AI & Analytics', page: 'Produttività' },
  '/scenario': { section: 'AI & Analytics', page: 'Scenario Planning' },
  '/import-hub': { section: 'Sistema', page: 'Import Hub' },
  '/archivio': { section: 'Sistema', page: 'Archivio Documenti' },
  '/impostazioni': { section: 'Sistema', page: 'Impostazioni' },
}

// ─── HELPER: find which section key contains a given path ──────
function findSectionKeyForPath(path: string, sections: NavSection[]): string | null {
  for (const section of sections) {
    if (section.items.some(item => item.to === path || (item.to !== '/' && path.startsWith(item.to)))) {
      return section.key
    }
  }
  return null
}

interface SidebarProps {
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
  badges?: Record<string, number>
}

export default function Sidebar({ mobileOpen, setMobileOpen, badges = {} }: SidebarProps) {
  const { profile, signOut } = useAuth()
  const { company, companies, switchCompany } = useCompany()
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const role = profile?.role || 'ceo'

  const roleLabels: Record<string, string> = {
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

  // Determine which section contains the active route
  const activeSectionKey = useMemo(() => {
    return findSectionKeyForPath(location.pathname, sections)
  }, [location.pathname, sections])

  // Expanded sections state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('nz_sidebar_expanded')
      if (saved) return new Set(JSON.parse(saved) as string[])
    } catch { /* ignore */ }
    const initial = new Set(allSections.map(s => s.key))
    return initial
  })

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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
    ? company.name.split(/\s+/).map((w: string) => w[0]).join('').toUpperCase().slice(0, 3)
    : '...'

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      try { localStorage.setItem('nz_sidebar_expanded', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  const renderNavItem = (item: NavItem, isCollapsedMode = false) => {
    const badge = item.badgeKey ? badges[item.badgeKey] : null

    if (isCollapsedMode) {
      return (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          title={item.label}
          className={({ isActive }) =>
            `flex items-center justify-center w-10 h-10 rounded-lg transition ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`
          }
        >
          <div className="relative">
            <item.icon size={18} />
            {badge != null && badge > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </div>
        </NavLink>
      )
    }

    return (
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
        <item.icon size={18} className="shrink-0" />
        <span className="truncate flex-1">{item.label}</span>
        {badge != null && badge > 0 && (
          <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none shrink-0">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </NavLink>
    )
  }

  // ─── COLLAPSED SIDEBAR (icon-only mode) ──────────────────────
  const collapsedContent = (
    <>
      <div className="p-2 border-b border-slate-700/50 shrink-0 flex flex-col items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
          {companyAbbrev}
        </div>
      </div>
      <nav className="flex-1 py-3 px-1.5 overflow-y-auto flex flex-col items-center gap-1">
        {sections.map(section => (
          <div key={section.key} className="flex flex-col items-center gap-1">
            {section.items.map(item => renderNavItem(item, true))}
            <div className="w-5 h-px bg-slate-700/50 my-1" />
          </div>
        ))}
      </nav>
      <div className="p-2 border-t border-slate-700/50 shrink-0 flex flex-col items-center gap-2">
        <button
          onClick={signOut}
          title="Esci"
          className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition"
        >
          <LogOut size={18} />
        </button>
        <button
          onClick={() => setCollapsed(false)}
          title="Espandi sidebar"
          className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition"
        >
          <ChevronsRight size={18} />
        </button>
      </div>
    </>
  )

  // ─── EXPANDED SIDEBAR ────────────────────────────────────────
  const expandedContent = (
    <>
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
                {companies.map((c: { id: string; name: string }) => (
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
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition shrink-0 md:hidden"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-0.5">
        {sections.map(section => {
          const isOpen = expandedSections.has(section.key)
          const hasActiveItem = activeSectionKey === section.key

          return (
            <div key={section.key}>
              <button
                onClick={() => toggleSection(section.key)}
                className={`flex items-center justify-between w-full px-3 py-2 mt-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition ${
                  hasActiveItem
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-500 hover:text-slate-300'
                } hover:bg-slate-800/50`}
              >
                <span>{section.label}</span>
                {isOpen
                  ? <ChevronDown size={13} className="shrink-0" />
                  : <ChevronRight size={13} className="shrink-0" />
                }
              </button>
              <div
                className="overflow-hidden transition-all duration-200 ease-in-out"
                style={{
                  maxHeight: isOpen ? `${section.items.length * 44 + 4}px` : '0px',
                  opacity: isOpen ? 1 : 0,
                }}
              >
                <div className="space-y-0.5 mt-0.5 ml-1">
                  {section.items.map(item => renderNavItem(item))}
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      <div className="p-3 border-t border-slate-700/50 shrink-0">
        <div className="mb-2 px-2">
          <div className="text-sm font-medium">{profile?.first_name} {profile?.last_name}</div>
          <div className="text-xs text-slate-400">{roleLabels[profile?.role as string]}</div>
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={signOut}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <LogOut size={18} />
            <span>Esci</span>
          </button>
          <button
            onClick={() => setCollapsed(true)}
            title="Comprimi sidebar"
            className="hidden md:flex p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <ChevronsLeft size={16} />
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      <aside
        className={`hidden md:flex h-screen bg-slate-900 text-white flex-col shrink-0 transition-all duration-200 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        {collapsed ? collapsedContent : expandedContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-slate-900 text-white flex flex-col shadow-2xl">
            {expandedContent}
          </aside>
        </div>
      )}
    </>
  )
}
