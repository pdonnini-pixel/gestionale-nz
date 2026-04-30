import React from 'react'
import { Clock, CheckCircle2, AlertTriangle, LucideIcon } from 'lucide-react'

interface DataFreshnessProps {
  lastUpdate: Date | string | null | undefined
  source?: string
}

export default function DataFreshness({ lastUpdate, source }: DataFreshnessProps) {
  if (!lastUpdate) return null

  const date = lastUpdate instanceof Date ? lastUpdate : new Date(lastUpdate)
  const diffMs = Date.now() - date.getTime()
  const diffHours = diffMs / (1000 * 60 * 60)
  const diffDays = diffHours / 24

  let color: string, Icon: LucideIcon, label: string
  if (diffHours < 1) {
    color = 'text-emerald-500'
    Icon = CheckCircle2
    label = 'Aggiornato ora'
  } else if (diffHours < 24) {
    color = 'text-emerald-500'
    Icon = CheckCircle2
    const h = Math.floor(diffHours)
    label = `${h}h fa`
  } else if (diffDays < 3) {
    color = 'text-amber-500'
    Icon = Clock
    const d = Math.floor(diffDays)
    label = `${d}g fa`
  } else {
    color = 'text-red-400'
    Icon = AlertTriangle
    label = date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
  }

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] ${color}`}>
      <Icon size={11} />
      {source && <span className="font-medium">{source}:</span>}
      {label}
    </span>
  )
}
