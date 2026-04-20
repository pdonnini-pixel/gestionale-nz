import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const colorSchemes = {
  primary: {
    bg: 'bg-blue-100',
    icon: 'text-blue-600',
    trend: 'text-blue-600',
  },
  success: {
    bg: 'bg-emerald-100',
    icon: 'text-emerald-600',
    trend: 'text-emerald-600',
  },
  warning: {
    bg: 'bg-amber-100',
    icon: 'text-amber-600',
    trend: 'text-amber-600',
  },
  danger: {
    bg: 'bg-red-100',
    icon: 'text-red-600',
    trend: 'text-red-600',
  },
}

const trendConfig = {
  up: { Icon: TrendingUp, color: 'text-emerald-600' },
  down: { Icon: TrendingDown, color: 'text-red-600' },
  flat: { Icon: Minus, color: 'text-slate-500' },
}

export default function KpiCard({
  title,
  value,
  trend = 'flat',
  trendValue,
  icon: IconComponent,
  onClick,
  colorScheme = 'primary',
}) {
  const scheme = colorSchemes[colorScheme] || colorSchemes.primary
  const trendInfo = trendConfig[trend] || trendConfig.flat
  const TrendIcon = trendInfo.Icon
  const isClickable = typeof onClick === 'function'

  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4 transition-all duration-200 ${
        isClickable
          ? 'cursor-pointer hover:shadow-md hover:scale-[1.02]'
          : ''
      }`}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      {IconComponent && (
        <div
          className={`flex-shrink-0 w-12 h-12 rounded-full ${scheme.bg} flex items-center justify-center`}
        >
          <IconComponent className={`w-6 h-6 ${scheme.icon}`} />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-500 truncate">{title}</p>
        <p className="text-2xl font-bold text-slate-900 truncate">{value}</p>
      </div>

      {trendValue && (
        <div className={`flex items-center gap-1 text-sm font-medium ${trendInfo.color}`}>
          <TrendIcon className="w-4 h-4" />
          <span>{trendValue}</span>
        </div>
      )}
    </div>
  )
}
