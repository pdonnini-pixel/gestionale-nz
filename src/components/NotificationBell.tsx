import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, X, Check, CheckCheck, ExternalLink,
  AlertTriangle, AlertCircle, Info, Receipt, Landmark, Shield, Settings,
  LucideIcon
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

interface CategoryMeta {
  icon: LucideIcon
  color: string
  label: string
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  scadenza_fiscale: { icon: AlertTriangle, color: 'amber', label: 'Scadenza fiscale' },
  scadenza_fornitore: { icon: AlertCircle, color: 'red', label: 'Scadenza fornitore' },
  anomalia: { icon: Shield, color: 'purple', label: 'Anomalia' },
  riconciliazione: { icon: Landmark, color: 'blue', label: 'Riconciliazione' },
  fattura_sdi: { icon: Receipt, color: 'emerald', label: 'Fattura SDI' },
  sistema: { icon: Settings, color: 'slate', label: 'Sistema' },
  info: { icon: Info, color: 'sky', label: 'Informazione' },
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-l-red-500 bg-red-50/40',
  warning: 'border-l-amber-500 bg-amber-50/30',
  info: 'border-l-blue-500 bg-white',
}

// TODO: tighten type — notification from Supabase
interface Notification {
  id: string
  title: string
  message: string
  category: string
  severity: string
  read: boolean
  dismissed: boolean
  action_url?: string
  action_label?: string
  created_at: string
  company_id: string
}

export default function NotificationBell() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const COMPANY_ID = profile?.company_id
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const unread = notifications.filter(n => !n.read && !n.dismissed)
  const unreadCount = unread.length
  const hasCritical = unread.some(n => n.severity === 'critical')
  const hasWarning = unread.some(n => n.severity === 'warning')
  const badgeColor = hasCritical ? 'bg-red-500' : hasWarning ? 'bg-amber-500' : 'bg-blue-500'

  // Load notifications
  useEffect(() => {
    if (!COMPANY_ID) return
    loadNotifications()
    // Poll every 60 seconds
    const interval = setInterval(loadNotifications, 60000)
    return () => clearInterval(interval)
  }, [COMPANY_ID])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function loadNotifications() {
    if (!COMPANY_ID) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .eq('dismissed', false)
      .order('created_at', { ascending: false })
      .limit(50)
    setNotifications((data as Notification[]) || [])
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ read: true, read_at: new Date().toISOString() }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  async function markAllRead() {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id)
    if (unreadIds.length === 0) return
    await supabase.from('notifications').update({ read: true, read_at: new Date().toISOString() }).in('id', unreadIds)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function dismiss(id: string) {
    await supabase.from('notifications').update({ dismissed: true }).eq('id', id)
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  function handleAction(n: Notification) {
    if (!n.read) markRead(n.id)
    if (n.action_url) {
      navigate(n.action_url)
      setOpen(false)
    }
  }

  // Sanitizza messaggio rimuovendo righe con importo non disponibile
  function sanitizeMessage(msg: string): string {
    if (!msg) return ''
    return String(msg)
      .replace(/[\.\s\u2014\-\u2022]*\s*Importo[:\s]*(?:\u20AC|EUR)\s*N\/?D\s*[\.\s]*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'ora'
    if (mins < 60) return `${mins}m fa`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h fa`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}g fa`
    return new Date(dateStr).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-slate-100 transition text-slate-500 hover:text-slate-700"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center ${badgeColor} text-white text-[10px] font-bold rounded-full px-1 ${hasCritical ? 'animate-pulse' : ''}`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[400px] max-h-[520px] bg-white rounded-xl border border-slate-200 shadow-2xl z-50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-blue-600" />
              <span className="font-semibold text-sm text-slate-900">Notifiche</span>
              {unreadCount > 0 && (
                <span className="bg-red-100 text-red-700 text-xs font-bold px-1.5 py-0.5 rounded-full">{unreadCount}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-blue-50 transition"
                >
                  <CheckCheck size={13} /> Segna tutte lette
                </button>
              )}
            </div>
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <Bell size={32} className="text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Nessuna notifica</p>
              </div>
            ) : (
              notifications.map(n => {
                const meta = CATEGORY_META[n.category] || CATEGORY_META.info
                const Icon = meta.icon
                const severityStyle = SEVERITY_STYLES[n.severity] || SEVERITY_STYLES.info

                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-slate-50 border-l-3 cursor-pointer transition hover:bg-slate-50/80 ${severityStyle} ${!n.read ? 'bg-opacity-100' : 'opacity-70'}`}
                    onClick={() => handleAction(n)}
                  >
                    <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 bg-${meta.color}-100`}>
                      <Icon size={14} className={`text-${meta.color}-600`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-snug ${!n.read ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                          {n.title}
                        </p>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                          className="p-0.5 rounded hover:bg-slate-200 text-slate-300 hover:text-slate-500 shrink-0"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      {sanitizeMessage(n.message) && (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{sanitizeMessage(n.message)}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-slate-400">{timeAgo(n.created_at)}</span>
                        <span className={`text-[10px] font-medium text-${meta.color}-600 bg-${meta.color}-50 px-1.5 py-0.5 rounded-full`}>
                          {meta.label}
                        </span>
                        {n.action_url && (
                          <span className="text-[10px] text-blue-500 flex items-center gap-0.5">
                            <ExternalLink size={8} /> {n.action_label || 'Apri'}
                          </span>
                        )}
                        {!n.read && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                            className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5 ml-auto"
                          >
                            <Check size={10} /> Letta
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
