import React, { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

// ═══════════════════════════════════════
// Toast Context
// ═══════════════════════════════════════
const ToastContext = createContext(null)

// ═══════════════════════════════════════
// Toast Provider Component
// ═══════════════════════════════════════
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback(({ type = 'info', message, duration = 4000 }) => {
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
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

// ═══════════════════════════════════════
// Toast Container (stacked, top-right)
// ═══════════════════════════════════════
function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={() => onRemove(toast.id)}
        />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════
// Individual Toast Item with glassmorphism
// ═══════════════════════════════════════
function ToastItem({ toast, onRemove }) {
  const [isExiting, setIsExiting] = useState(false)

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(onRemove, 300)
  }

  // Type config: icon, colors, bg gradient
  const typeConfig = {
    success: {
      icon: CheckCircle,
      iconColor: '#10b981',
      bgGradient: 'from-green-50 to-emerald-50',
      border: 'border-green-200',
      textColor: '#065f46',
    },
    error: {
      icon: XCircle,
      iconColor: '#ef4444',
      bgGradient: 'from-red-50 to-rose-50',
      border: 'border-red-200',
      textColor: '#7f1d1d',
    },
    warning: {
      icon: AlertTriangle,
      iconColor: '#f59e0b',
      bgGradient: 'from-amber-50 to-orange-50',
      border: 'border-amber-200',
      textColor: '#7c2d12',
    },
    info: {
      icon: Info,
      iconColor: '#3b82f6',
      bgGradient: 'from-blue-50 to-cyan-50',
      border: 'border-blue-200',
      textColor: '#1e3a8a',
    },
  }

  const config = typeConfig[toast.type] || typeConfig.info
  const IconComponent = config.icon

  return (
    <div
      className={`
        pointer-events-auto transform transition-all duration-300 ease-out
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
      `}
    >
      <div
        className={`
          relative rounded-lg p-4 w-96 max-w-sm
          backdrop-blur-xl
          border ${config.border}
          bg-gradient-to-br ${config.bgGradient}
          shadow-lg
          flex items-start gap-3
        `}
        style={{
          background: `rgba(255,255,255,0.85)`,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid rgba(255,255,255,0.5)`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}
      >
        {/* Icon */}
        <IconComponent
          size={20}
          color={config.iconColor}
          className="flex-shrink-0 mt-0.5"
        />

        {/* Message */}
        <p className="flex-1 text-sm font-medium text-slate-700">
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
