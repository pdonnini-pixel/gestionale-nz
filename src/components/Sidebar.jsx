import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCompany } from '../hooks/useCompany'
import {
  LayoutDashboard, Store, Receipt, Building2, Users, FileText,
  Settings, LogOut, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Landmark, Upload, BarChart3, GitCompare, Calculator,
  Package, CreditCard, Wallet, ShoppingBag, UserCheck, Map, PieChart, CalendarClock, ClipboardList, DatabaseZap, Archive,
  Building, ChevronsUpDown, FileCode
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

// Pagine operative (sempre visibili)
const mainItems = {
  super_advisor: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/outlet', icon: Store, label: 'Outlet' },
    { to: '/confronto-outlet', icon: GitCompare, label: 'Confronto Outlet' },
    { to: '/budget', icon: Calculator, label: 'Budget & Controllo' },
    { to: '/conto-economico', icon: BarChart3, label: 'Conto Economico' },
    { to: '/scadenzario', icon: Receipt, label: 'Scadenzario' },
    { to: '/cash-flow', icon: Wallet, label: 'Cashflow Prospettico' },
    { to: '/fornitori', icon: Building2, label: 'Fornitori' },
    { to: '/banche', icon: Landmark, label: 'Banche' },
    { to: '/fatturazione', icon: FileCode, label: 'Fatturazione' },
    { to: '/scadenze-fiscali', icon: CalendarClock, label: 'Scadenze Fiscali' },
    { to: '/dipendenti', icon: Users, label: 'Dipendenti' },
    { to: '/import-hub', icon: DatabaseZap, label: 'Import Hub' },
    { to: '/archivio', icon: Archive, label: 'Archivio Documenti' },
    { to: '/impostazioni', icon: Settings, label: 'Impostazioni' },
  ],
  ceo: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/outlet', icon: Store, label: 'Outlet' },
    { to: '/confronto-outlet', icon: GitCompare, label: 'Confronto Outlet' },
    { to: '/budget', icon: Calculator, label: 'Budget & Controllo' },
    { to: '/conto-economico', icon: BarChart3, label: 'Conto Economico' },
    { to: '/scadenzario', icon: Receipt, label: 'Scadenzario' },
    { to: '/cash-flow', icon: Wallet, label: 'Cashflow Prospettico' },
    { to: '/banche', icon: Landmark, label: 'Banche' },
  ],
  cfo: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/outlet', icon: Store, label: 'Outlet' },
    { to: '/confronto-outlet', icon: GitCompare, label: 'Confronto Outlet' },
    { to: '/budget', icon: Calculator, label: 'Budget & Controllo' },
    { to: '/conto-economico', icon: BarChart3, label: 'Conto Economico' },
    { to: '/scadenzario', icon: Receipt, label: 'Scadenzario' },
    { to: '/cash-flow', icon: Wallet, label: 'Cashflow Prospettico' },
    { to: '/fornitori', icon: Building2, label: 'Fornitori' },
    { to: '/banche', icon: Landmark, label: 'Banche' },
    { to: '/fatturazione', icon: FileCode, label: 'Fatturazione' },
    { to: '/scadenze-fiscali', icon: CalendarClock, label: 'Scadenze Fiscali' },
    { to: '/import-hub', icon: DatabaseZap, label: 'Import Hub' },
    { to: '/archivio', icon: Archive, label: 'Archivio Documenti' },
  ],
  coo: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/outlet', icon: Store, label: 'Outlet' },
    { to: '/dipendenti', icon: Users, label: 'Dipendenti' },
  ],
  contabile: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/scadenzario', icon: Receipt, label: 'Scadenzario' },
    { to: '/fornitori', icon: Building2, label: 'Fornitori' },
    { to: '/banche', icon: Landmark, label: 'Banche' },
    { to: '/fatturazione', icon: FileCode, label: 'Fatturazione' },
    { to: '/scadenze-fiscali', icon: CalendarClock, label: 'Scadenze Fiscali' },
    { to: '/import-hub', icon: DatabaseZap, label: 'Import Hub' },
    { to: '/archivio', icon: Archive, label: 'Archivio Documenti' },
  ],
}

// Pagine in sviluppo (collassabili sotto "In sviluppo")
const devItems = {
  super_advisor: [
    { to: '/margini', icon: PieChart, label: 'Margini Outlet' },
    { to: '/stock', icon: Package, label: 'Stock & Sell-through' },
    { to: '/analytics-pos', icon: CreditCard, label: 'Analytics POS' },
    { to: '/open-to-buy', icon: ShoppingBag, label: 'Open to Buy' },
    { to: '/produttivita', icon: UserCheck, label: 'Produttività' },
    { to: '/scenario', icon: Map, label: 'Scenario Planning' },
    { to: '/store-manager', icon: ClipboardList, label: 'Store Manager' },
  ],
  ceo: [
    { to: '/margini', icon: PieChart, label: 'Margini Outlet' },
    { to: '/produttivita', icon: UserCheck, label: 'Produttività' },
    { to: '/scenario', icon: Map, label: 'Scenario Planning' },
  ],
  cfo: [
    { to: '/margini', icon: PieChart, label: 'Margini Outlet' },
  ],
  coo: [
    { to: '/stock', icon: Package, label: 'Stock & Sell-through' },
    { to: '/analytics-pos', icon: CreditCard, label: 'Analytics POS' },
    { to: '/produttivita', icon: UserCheck, label: 'Produttività' },
    { to: '/store-manager', icon: ClipboardList, label: 'Store Manager' },
  ],
  contabile: [],
}

export default function Sidebar() {
  const { profile, signOut } = useAuth()
  const { company, companies, switchCompany } = useCompany()
  const [collapsed, setCollapsed] = useState(false)
  const [devOpen, setDevOpen] = useState(false)
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)
  const role = profile?.role || 'ceo'
  const items = mainItems[role] || mainItems.ceo
  const devPages = devItems[role] || []

  const roleLabels = {
    super_advisor: 'Super Advisor',
    ceo: 'CEO', cfo: 'CFO', coo: 'COO',
    contabile: 'Contabile'
  }

  // Chiudi dropdown quando si clicca fuori
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setCompanyDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Genera abbreviazione azienda (prime lettere delle parole)
  const companyAbbrev = company?.name
    ? company.name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3)
    : '...'

  const renderNavItem = (item, dimmed = false) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
          isActive
            ? 'bg-blue-600 text-white'
            : dimmed
              ? 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`
      }
    >
      <item.icon size={20} className={dimmed ? 'opacity-50' : ''} />
      {!collapsed && (
        <span className={`truncate ${dimmed ? 'opacity-70' : ''}`}>{item.label}</span>
      )}
    </NavLink>
  )

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-60'} h-screen bg-slate-900 text-white flex flex-col transition-all duration-200 shrink-0`}>
      {/* Header — Company Selector */}
      <div className="p-3 border-b border-slate-700/50">
        <div className="flex items-center justify-between">
          {!collapsed ? (
            <div className="relative flex-1 mr-2" ref={dropdownRef}>
              <button
                onClick={() => companies.length > 1 && setCompanyDropdownOpen(!companyDropdownOpen)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg transition text-left ${
                  companies.length > 1
                    ? 'hover:bg-slate-800 cursor-pointer'
                    : 'cursor-default'
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

              {/* Dropdown lista aziende */}
              {companyDropdownOpen && companies.length > 1 && (
                <div className="absolute left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 py-1 max-h-60 overflow-y-auto">
                  {companies.map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        switchCompany(c.id)
                        setCompanyDropdownOpen(false)
                      }}
                      className={`flex items-center gap-2 w-full px-3 py-2 text-left text-sm transition ${
                        c.id === company?.id
                          ? 'bg-blue-600/20 text-blue-300'
                          : 'text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      <Building size={14} />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-xs font-bold mx-auto" title={company?.name}>
              {companyAbbrev}
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition shrink-0"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {/* Pagine operative */}
        {items.map(item => renderNavItem(item))}

        {/* Sezione "In sviluppo" — collassabile */}
        {devPages.length > 0 && (
          <>
            {!collapsed ? (
              <button
                onClick={() => setDevOpen(!devOpen)}
                className="flex items-center justify-between w-full px-3 py-2 mt-3 rounded-lg text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition"
              >
                <span>In sviluppo</span>
                {devOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            ) : (
              <button
                onClick={() => setDevOpen(!devOpen)}
                className="flex items-center justify-center w-full py-2 mt-3 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition"
                title="In sviluppo"
              >
                {devOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
            {devOpen && (
              <div className="space-y-1">
                {devPages.map(item => renderNavItem(item, true))}
              </div>
            )}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-slate-700/50">
        {!collapsed && (
          <div className="mb-2 px-2">
            <div className="text-sm font-medium">{profile?.first_name} {profile?.last_name}</div>
            <div className="text-xs text-slate-400">{roleLabels[profile?.role]}</div>
          </div>
        )}
        <button
          onClick={signOut}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition"
        >
          <LogOut size={18} />
          {!collapsed && <span>Esci</span>}
        </button>
      </div>
    </aside>
  )
}
