/**
 * ChartTheme.jsx — Modern 2026 chart styling for Recharts
 * Gradient fills, glassmorphism tooltips, rounded bars, vibrant palette
 */

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

export const OUTLET_COLORS = {
  Valdichiana:  { main: '#6366f1', light: '#a5b4fc' },
  Barberino:    { main: '#06b6d4', light: '#67e8f9' },
  Palmanova:    { main: '#10b981', light: '#6ee7b7' },
  Franciacorta: { main: '#f43f5e', light: '#fda4af' },
  Brugnato:     { main: '#f97316', light: '#fdba74' },
  Valmontone:   { main: '#8b5cf6', light: '#c4b5fd' },
  Torino:       { main: '#0ea5e9', light: '#7dd3fc' },
  'Ufficio/Magazzino': { main: '#eab308', light: '#fde047' },
}

// ═══════════════════════════════════════
// GLASSMORPHISM TOOLTIP
// ═══════════════════════════════════════
export function GlassTooltip({ active, payload, label, formatter, suffix = '€' }) {
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
export function ChartGradients({ ids }) {
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
export const BAR_RADIUS = [6, 6, 0, 0]
export const BAR_RADIUS_FULL = [8, 8, 8, 8]

// ═══════════════════════════════════════
// MODERN LEGEND
// ═══════════════════════════════════════
export function ModernLegend({ payload }) {
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
export function ModernPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) {
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
export function fmtK(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return new Intl.NumberFormat('it-IT').format(n)
}

export function fmtEuro(n) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n) + ' €'
}

// ═══════════════════════════════════════
// DONUT CENTER LABEL (for modern pie)
// ═══════════════════════════════════════
export function DonutCenter({ viewBox, value, label }) {
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
