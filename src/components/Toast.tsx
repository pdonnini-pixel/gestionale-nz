import React, { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

// ═══════════════════════════════════════
// Types
// ═══════════════════════════════════════
type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastData {
  id: number
  type: ToastType
  message: string
}

interface ToastOptions {
  type?: ToastType
  message: string
  duration?: number
}

interface ToastContextValue {
  toast: (options: ToastOptions) => () => void
}

// ═══════════════════════════════════════
// Toast Context
// ═══════════════════════════════════════
const ToastContext = createContext<ToastContextValue | null>(null)

// ═══════════════════════════════════════
// Toast Provider Component
// ═══════════════════════════════════════
interface ToastProviderProps {
  children: React.ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const toast = useCallback(({ type = 'info', message, duration = 10000 }: ToastOptions) => {
    const id = Date.now()

    setToasts(prev => {
      const updated = [...prev, { id, type, message }]
      // Keep max 5 toasts
      return updated.slice(-5)
    })

    // Auto-dismiss after duration
    const timeout = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)

    // Return dismiss function for manual removal
    return () => {
      clearTimeout(timeout)
      setToasts(prev => prev.filter(t => t.id !== id))
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </ToastContext.Provider>
  )
}

// ═══════════════════════════════════════
// Toast Hook
// ═══════════════════════════════════════
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

// ═══════════════════════════════════════
// Toast Container (stacked, top-right)
// ═══════════════════════════════════════
interface ToastContainerProps {
  toasts: ToastData[]
  onRemove: (id: number) => void
}

function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  // Top-center: pattern Sibill/Linear. Non copre la sidebar.
  // Backdrop invisibile: click ovunque fuori dal toast = chiude tutto.
  const dismissAll = () => toasts.forEach(t => onRemove(t.id))
  return (
    <>
      {toasts.length > 0 && (
        <div
          className="fixed inset-0 z-[99] cursor-pointer"
          onClick={dismissAll}
          aria-hidden="true"
        />
      )}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-3 items-center pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onRemove={() => onRemove(toast.id)}
          />
        ))}
      </div>
    </>
  )
}

// ═══════════════════════════════════════
// Individual Toast Item with glassmorphism
// ═══════════════════════════════════════
interface ToastItemProps {
  toast: ToastData
  onRemove: () => void
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false)

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(onRemove, 300)
  }

  // Type config: icon, colors, bg gradient + colore bordo bold per tipo
  const typeConfig = {
    success: {
      icon: CheckCircle,
      iconColor: '#10b981',
      bgGradient: 'from-green-50 to-emerald-50',
      border: 'border-green-200',
      textColor: '#065f46',
      borderColorBold: '#10b981', // emerald-500
    },
    error: {
      icon: XCircle,
      iconColor: '#ef4444',
      bgGradient: 'from-red-50 to-rose-50',
      border: 'border-red-200',
      textColor: '#7f1d1d',
      borderColorBold: '#ef4444', // red-500
    },
    warning: {
      icon: AlertTriangle,
      iconColor: '#f59e0b',
      bgGradient: 'from-amber-50 to-orange-50',
      border: 'border-amber-200',
      textColor: '#7c2d12',
      borderColorBold: '#f59e0b', // amber-500
    },
    info: {
      icon: Info,
      iconColor: '#3b82f6',
      bgGradient: 'from-blue-50 to-cyan-50',
      border: 'border-blue-200',
      textColor: '#1e3a8a',
      borderColorBold: '#3b82f6', // blue-500
    },
  }

  const config = typeConfig[toast.type] || typeConfig.info
  const IconComponent = config.icon

  return (
    <div
      className={`
        pointer-events-auto transform transition-all duration-300 ease-out
        ${isExiting ? 'opacity-0 -translate-y-4' : 'opacity-100 translate-y-0'}
      `}
    >
      <div
        className={`
          relative rounded-lg p-4 w-96 max-w-sm
          backdrop-blur-xl
          bg-gradient-to-br ${config.bgGradient}
          shadow-lg
          flex items-start gap-3
        `}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: `rgba(255,255,255,0.92)`,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `3px solid ${config.borderColorBold}`,
          boxShadow: `0 8px 32px ${config.borderColorBold}33, 0 4px 16px rgba(0,0,0,0.08)`,
        }}
      >
        {/* Icon */}
        <IconComponent
          size={20}
          color={config.iconColor}
          className="flex-shrink-0 mt-0.5"
        />

        {/* Message — whitespace-pre-line per supportare \n nei recap */}
        <p className="flex-1 text-sm font-medium text-slate-700 whitespace-pre-line">
          {toast.message}
        </p>

        {/* Close Button */}
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
          aria-label="Close notification"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
