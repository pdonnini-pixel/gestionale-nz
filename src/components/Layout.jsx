import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import NotificationBell from './NotificationBell'
import HelpPanel from './HelpPanel'
import { useAuth } from '../hooks/useAuth'

export default function Layout() {
  const { profile } = useAuth()

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-12 shrink-0 bg-white border-b border-slate-200 flex items-center justify-end px-4 gap-3">
          <NotificationBell />
          <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
              {(profile?.first_name?.[0] || '') + (profile?.last_name?.[0] || '')}
            </div>
            <span className="text-sm text-slate-600 font-medium hidden sm:inline">
              {profile?.first_name}
            </span>
          </div>
        </header>
        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <Outlet />
        </main>
        <HelpPanel />
      </div>
    </div>
  )
}
