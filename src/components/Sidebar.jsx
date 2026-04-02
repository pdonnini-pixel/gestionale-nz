import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  LayoutDashboard, Store, Receipt, Building2, Users, FileText,
  Settings, LogOut, ChevronLeft, ChevronRight, Landmark
} from 'lucide-react'
import { useState } from 'react'

const navItems = {
  super_advisor: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/outlet', icon: Store, label: 'Outlet' },
    { to: '/scadenzario', icon: Receipt, label: 'Scadenzario' },
    { to: '/banche', icon: Landmark, label: 'Banche' },
    { to: '/dipendenti', icon: Users, label: 'Dipendenti' },
    { to: '/contratti', icon: FileText, label: 'Contratti' },
    { to: '/impostazioni', icon: Settings, label: 'Impostazioni' },
  ],
  ceo: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/outlet', icon: Store, label: 'Outlet' },
    { to: '/banche', icon: Landmark, label: 'Banche' },
  ],
  cfo: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/outlet', icon: Store, label: 'Outlet' },
    { to: '/scadenzario', icon: Receipt, label: 'Scadenzario' },
    { to: '/banche', icon: Landmark, label: 'Banche' },
  ],
  coo: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/outlet', icon: Store, label: 'Outlet' },
    { to: '/dipendenti', icon: Users, label: 'Dipendenti' },
  ],
  contabile: [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/scadenzario', icon: Receipt, label: 'Scadenzario' },
    { to: '/banche', icon: Landmark, label: 'Banche' },
    { to: '/importazioni', icon: Building2, label: 'Importazioni' },
  ],
}

export default function Sidebar() {
  const { profile, signOut } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const items = navItems[profile?.role] || navItems.ceo

  const roleLabels = {
    super_advisor: 'Super Advisor',
    ceo: 'CEO', cfo: 'CFO', coo: 'COO',
    contabile: 'Contabile'
  }

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-60'} h-screen bg-slate-900 text-white flex flex-col transition-all duration-200 shrink-0`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
        {!collapsed && (
          <div>
            <div className="font-bold text-lg">NZ</div>
            <div className="text-xs text-slate-400">New Zago</div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            <item.icon size={20} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
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
