import { useNavigate } from 'react-router-dom'
import { FolderOpen } from 'lucide-react'

/**
 * EmptyState — unified empty state for all pages
 *
 * Props:
 * - icon?: Lucide icon component (default FolderOpen)
 * - title: main message
 * - description?: subtitle text
 * - actionLabel?: button text
 * - actionTo?: route to navigate to
 * - onAction?: callback (overrides actionTo)
 */
export default function EmptyState({
  icon: Icon = FolderOpen,
  title = 'Nessun dato disponibile',
  description,
  actionLabel,
  actionTo,
  onAction,
}) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Icon size={28} className="text-slate-300" />
      </div>
      <h3 className="text-base font-semibold text-slate-700 mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-400 max-w-sm mb-4">{description}</p>}
      {(actionLabel && (actionTo || onAction)) && (
        <button
          onClick={() => onAction ? onAction() : navigate(actionTo)}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
