import { useNavigate } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'

export default function Breadcrumb({ items = [] }) {
  const navigate = useNavigate()

  if (items.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        const isFirst = index === 0

        return (
          <span key={item.path || index} className="flex items-center gap-1">
            {index > 0 && (
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
            )}

            {isLast ? (
              <span className="text-slate-800 font-medium truncate max-w-[200px]">
                {isFirst && <Home className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />}
                {item.label}
              </span>
            ) : (
              <button
                onClick={() => navigate(item.path)}
                className="text-slate-400 hover:text-slate-600 transition-colors truncate max-w-[200px] flex items-center"
              >
                {isFirst && <Home className="w-3.5 h-3.5 mr-1 flex-shrink-0" />}
                {item.label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
