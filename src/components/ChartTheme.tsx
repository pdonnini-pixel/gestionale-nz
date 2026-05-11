/**
 * ChartTheme.tsx — Modern 2026 chart styling for Recharts
 * Gradient fills, glassmorphism tooltips, rounded bars, vibrant palette
 */

import React from 'react'

// ═══════════════════════════════════════
// PALETTE 2026 — Vibrant gradients
// ═══════════════════════════════════════
export const PALETTE = [
  '#6366f1', // indigo
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#3b82f6', // blue
]

/**
 * Mappa legacy nome outlet → colore per i grafici. Originariamente
 * hardcoded sui 7 punti vendita NZ; ora funge solo da retrocompat —
 * per tenant nuovi (Made/Zago/futuri SaaS) il colore viene generato
 * deterministicamente da `getOutletColor()` a partire dal nome.
 *
 * Il primo match cerca per chiave esatta (es. "Valdichiana"), poi per
 * primo token (es. "Valdichiana Village" → "Valdichiana"). Se non matcha,
 * `getOutletColor` ricade su una palette deterministica basata su hash.
 */
export const OUTLET_COLORS: Record<string, { main: string; light: string }> = {
  Valdichiana:  { main: '#6366f1', light: '#a5b4fc' },
  Barberino:    { main: '#06b6d4', light: '#67e8f9' },
  Palmanova:    { main: '#10b981', light: '#6ee7b7' },
  Franciacorta: { main: '#f43f5e', light: '#fda4af' },
  Brugnato:     { main: '#f97316', light: '#fdba74' },
  Valmontone:   { main: '#8b5cf6', light: '#c4b5fd' },
  Torino:       { main: '#0ea5e9', light: '#7dd3fc' },
  'Ufficio/Magazzino': { main: '#eab308', light: '#fde047' },
}

// Palette estesa per generazione deterministica colori outlet (~16 colori
// distinti, copre fino a 16 outlet senza collisioni evidenti).
const OUTLET_PALETTE_MAIN: ReadonlyArray<string> = [
  '#6366f1', '#06b6d4', '#10b981', '#f43f5e',
  '#f97316', '#8b5cf6', '#0ea5e9', '#eab308',
  '#ec4899', '#14b8a6', '#22c55e', '#f59e0b',
  '#a855f7', '#3b82f6', '#ef4444', '#84cc16',
]
const OUTLET_PALETTE_LIGHT: ReadonlyArray<string> = [
  '#a5b4fc', '#67e8f9', '#6ee7b7', '#fda4af',
  '#fdba74', '#c4b5fd', '#7dd3fc', '#fde047',
  '#f9a8d4', '#5eead4', '#86efac', '#fcd34d',
  '#d8b4fe', '#93c5fd', '#fca5a5', '#bef264',
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/**
 * Restituisce il colore { main, light } per un outlet dato il suo nome
 * (o codice). Pattern di fallback:
 *   1. match esatto in OUTLET_COLORS (retrocompat NZ)
 *   2. primo token del nome ("Valdichiana Village" → "Valdichiana")
 *   3. hash deterministico del nome → palette estesa
 */
export function getOutletColor(name: string | null | undefined): { main: string; light: string } {
  if (!name) return { main: OUTLET_PALETTE_MAIN[0], light: OUTLET_PALETTE_LIGHT[0] }
  const trimmed = name.trim()
  if (OUTLET_COLORS[trimmed]) return OUTLET_COLORS[trimmed]
  const firstToken = trimmed.split(/\s+/)[0]
  if (firstToken && OUTLET_COLORS[firstToken]) return OUTLET_COLORS[firstToken]
  const idx = hashString(trimmed.toLowerCase()) % OUTLET_PALETTE_MAIN.length
  return { main: OUTLET_PALETTE_MAIN[idx], light: OUTLET_PALETTE_LIGHT[idx] }
}

/**
 * Helper React per ottenere il colore Tailwind background (bg-*) dato un
 * nome outlet. Utile per badge/dot colorati nelle tabelle. Mappa a una
 * classe statica (sfortunatamente non possiamo generare classi Tailwind
 * dinamiche, quindi usiamo un set fisso). Determinismo come getOutletColor.
 */
const TAILWIND_BG_PALETTE: ReadonlyArray<string> = [
  'bg-indigo-600', 'bg-cyan-600', 'bg-emerald-600', 'bg-rose-600',
  'bg-orange-600', 'bg-violet-600', 'bg-sky-600', 'bg-amber-600',
  'bg-pink-600', 'bg-teal-600', 'bg-green-600', 'bg-yellow-600',
  'bg-purple-600', 'bg-blue-600', 'bg-red-600', 'bg-lime-600',
]

export function getOutletTailwindBg(name: string | null | undefined): string {
  if (!name) return TAILWIND_BG_PALETTE[0]
  const idx = hashString(name.trim().toLowerCase()) % TAILWIND_BG_PALETTE.length
  return TAILWIND_BG_PALETTE[idx]
}

// ═══════════════════════════════════════
// GLASSMORPHISM TOOLTIP
// ═══════════════════════════════════════
interface TooltipPayloadEntry {
  value: number
  name?: string
  dataKey?: string
  color?: string
  fill?: string
}

interface GlassTooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
  formatter?: (value: number) => string
  suffix?: string
}

export function GlassTooltip({ active, payload, label, formatter, suffix = '\u20AC' }: GlassTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(255,255,255,0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.5)',
      borderRadius: '12px',
      padding: '12px 16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
    }}>
      {label && (
        <p style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>{label}</p>
      )}
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: entry.color || entry.fill || PALETTE[i],
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {entry.name || entry.dataKey}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginLeft: 'auto' }}>
            {formatter ? formatter(entry.value) : `${new Intl.NumberFormat('it-IT').format(entry.value)} ${suffix}`}
          </span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════
// GRADIENT DEFINITIONS (SVG defs)
// ═══════════════════════════════════════
interface ChartGradientsProps {
  ids?: (string | number)[]
}

export function ChartGradients({ ids }: ChartGradientsProps) {
  const gradients = ids || PALETTE.map((_, i) => i)
  return (
    <defs>
      {gradients.map((id, i) => {
        const color = typeof id === 'string' ? id : PALETTE[i]
        const gId = typeof id === 'string' ? `grad-${id.replace('#', '')}` : `grad-${i}`
        return (
          <linearGradient key={gId} id={gId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.9} />
            <stop offset="100%" stopColor={color} stopOpacity={0.4} />
          </linearGradient>
        )
      })}
      {/* Area gradient */}
      <linearGradient id="grad-area-indigo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
        <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
      </linearGradient>
      <linearGradient id="grad-area-cyan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
        <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.02} />
      </linearGradient>
      <linearGradient id="grad-area-emerald" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
      </linearGradient>
    </defs>
  )
}

// ═══════════════════════════════════════
// MODERN AXIS STYLING
// ═══════════════════════════════════════
export const AXIS_STYLE = {
  tick: { fontSize: 11, fill: '#94a3b8' },
  axisLine: { stroke: '#e2e8f0', strokeWidth: 1 },
  tickLine: false,
}

export const GRID_STYLE = {
  strokeDasharray: '4 4',
  stroke: '#f1f5f9',
  vertical: false,
}

// ═══════════════════════════════════════
// MODERN BAR RADIUS
// ═══════════════════════════════════════
export const BAR_RADIUS: [number, number, number, number] = [6, 6, 0, 0]
export const BAR_RADIUS_FULL: [number, number, number, number] = [8, 8, 8, 8]

// ═══════════════════════════════════════
// MODERN LEGEND
// ═══════════════════════════════════════
interface LegendPayloadEntry {
  color: string
  value: string
}

interface ModernLegendProps {
  payload?: LegendPayloadEntry[]
}

export function ModernLegend({ payload }: ModernLegendProps) {
  if (!payload?.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px 20px', paddingTop: 8 }}>
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 10, height: 10, borderRadius: 3,
            background: entry.color,
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════
// MODERN PIE LABEL
// ═══════════════════════════════════════
interface ModernPieLabelProps {
  cx: number
  cy: number
  midAngle: number
  innerRadius: number
  outerRadius: number
  percent: number
  name: string
}

export function ModernPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: ModernPieLabelProps) {
  if (percent < 0.04) return null
  const RADIAN = Math.PI / 180
  const radius = outerRadius + 20
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#475569" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight={500}>
      {name} {(percent * 100).toFixed(0)}%
    </text>
  )
}

// ═══════════════════════════════════════
// FORMAT HELPERS
// ═══════════════════════════════════════
export function fmtK(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return new Intl.NumberFormat('it-IT').format(n)
}

export function fmtEuro(n: number): string {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n) + ' \u20AC'
}

// ═══════════════════════════════════════
// DONUT CENTER LABEL (for modern pie)
// ═══════════════════════════════════════
interface DonutCenterProps {
  viewBox: { cx: number; cy: number }
  value: string
  label: string
}

export function DonutCenter({ viewBox, value, label }: DonutCenterProps) {
  const { cx, cy } = viewBox
  return (
    <g>
      <text x={cx} y={cy - 8} textAnchor="middle" fill="#0f172a" fontSize={22} fontWeight={700}>
        {value}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#94a3b8" fontSize={11} fontWeight={500}>
        {label}
      </text>
    </g>
  )
}
