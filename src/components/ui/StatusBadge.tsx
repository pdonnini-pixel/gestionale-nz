import React from 'react'

const statusColorMap: Record<string, string> = {
  // Green - emerald
  pagato: 'emerald',
  completato: 'emerald',
  consegnato: 'emerald',
  authorized: 'emerald',
  active: 'emerald',
  success: 'emerald',
  accepted: 'emerald',
  // Red
  scaduto: 'red',
  errore: 'red',
  rifiutato: 'red',
  rejected: 'red',
  revoked: 'red',
  error: 'red',
  danger: 'red',
  // Amber
  in_attesa: 'amber',
  in_scadenza: 'amber',
  pending: 'amber',
  inviato: 'amber',
  sent: 'amber',
  warning: 'amber',
  // Orange
  parziale: 'orange',
  // Blue
  da_pagare: 'blue',
  validated: 'blue',
  delivered: 'blue',
  received: 'blue',
  // Purple
  contestato: 'purple',
  rimandato: 'purple',
  // Slate (gray)
  bozza: 'slate',
  draft: 'slate',
  neutral: 'slate',
  deposited: 'slate',
  sospeso: 'slate',
  annullato: 'slate',
  nota_credito: 'emerald',
}

const colorStyles: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  emerald: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200',
  },
  red: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
    border: 'border-red-200',
  },
  amber: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    border: 'border-amber-200',
  },
  slate: {
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    dot: 'bg-slate-400',
    border: 'border-slate-200',
  },
  blue: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
    border: 'border-blue-200',
  },
  orange: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    dot: 'bg-orange-500',
    border: 'border-orange-200',
  },
  purple: {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    dot: 'bg-purple-500',
    border: 'border-purple-200',
  },
}

const sizeStyles: Record<string, { wrapper: string; dot: string }> = {
  sm: {
    wrapper: 'px-2 py-0.5 text-xs gap-1',
    dot: 'w-1.5 h-1.5',
  },
  md: {
    wrapper: 'px-2.5 py-1 text-sm gap-1.5',
    dot: 'w-2 h-2',
  },
}

interface StatusBadgeProps {
  status?: string
  size?: 'sm' | 'md'
}

export default function StatusBadge({ status = '', size = 'md' }: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase().trim()
  const colorKey = statusColorMap[normalizedStatus] || 'slate'
  const colors = colorStyles[colorKey]
  const sizeStyle = sizeStyles[size] || sizeStyles.md

  const label = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${colors.bg} ${colors.text} ${colors.border} ${sizeStyle.wrapper}`}
    >
      <span className={`rounded-full flex-shrink-0 ${colors.dot} ${sizeStyle.dot}`} />
      {label}
    </span>
  )
}
