import React from 'react'

const pulse = 'bg-slate-200 animate-pulse rounded'

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <div className={`h-4 w-1/3 ${pulse}`} />
      <div className={`h-3 w-full ${pulse}`} />
      <div className={`h-3 w-2/3 ${pulse}`} />
    </div>
  )
}

function TableRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3 px-4 border-b border-slate-100">
      <div className={`h-4 w-1/6 ${pulse}`} />
      <div className={`h-4 w-1/4 ${pulse}`} />
      <div className={`h-4 w-1/5 ${pulse}`} />
      <div className={`h-4 w-1/6 ${pulse}`} />
      <div className={`h-4 w-1/8 ${pulse} ml-auto`} />
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className={`h-4 w-1/4 mb-4 ${pulse}`} />
      <div className={`h-48 w-full ${pulse}`} />
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-full ${pulse} flex-shrink-0`} />
      <div className="flex-1 space-y-2">
        <div className={`h-3 w-1/2 ${pulse}`} />
        <div className={`h-6 w-2/3 ${pulse}`} />
      </div>
      <div className={`h-4 w-16 ${pulse}`} />
    </div>
  )
}

const variants: Record<string, React.FC> = {
  card: CardSkeleton,
  'table-row': TableRowSkeleton,
  chart: ChartSkeleton,
  kpi: KpiSkeleton,
}

interface LoadingSkeletonProps {
  variant?: string
  count?: number
}

export default function LoadingSkeleton({ variant = 'card', count = 1 }: LoadingSkeletonProps) {
  const Component = variants[variant] || variants.card

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Component key={i} />
      ))}
    </>
  )
}
