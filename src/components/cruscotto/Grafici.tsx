// Grafici del cruscotto direzione (Dashboard). SVG semplici, senza librerie:
// segni sottili, una sola scala, colore forte solo per l'anno in corso, grigio per il confronto,
// colori di allarme solo dove c'è un allarme. Ogni grafico ha la sua tabella o le cifre scritte accanto.
import { useRef, useState, useEffect, type ReactNode } from 'react'

export const COLORI = {
  anno: '#257de0', annoChiaro: '#9dc8f7', prima: '#c9ccd1', budget: '#f47230',
  critico: '#dc3c3d', serio: '#f18a59', griglia: '#e7e7e7', asse: '#c2c2c2', testo: '#191919', testo2: '#666666',
}
export const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }) // de-DE: punto delle migliaia anche su 4 cifre (it-IT scrive 2670)
const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const euro = (v: number) => '€ ' + nf0.format(Math.round(v))
export const asseK = (v: number) => (v >= 1000 ? nf0.format(v / 1000) + 'K' : nf0.format(v))

/** Larghezza reale del contenitore, per disegnare in pixel veri. */
function useLarghezza<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(800)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(e => setW(Math.max(280, Math.floor(e[0].contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export interface RigaTooltip { etichetta: string; valore: string; colore: string }
interface Tip { x: number; y: number; titolo: string; righe: RigaTooltip[] }
function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="pointer-events-none fixed z-50 min-w-[160px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left: Math.min(tip.x + 14, window.innerWidth - 220), top: tip.y + 14 }}>
      <div className="mb-1 text-slate-500">{tip.titolo}</div>
      {tip.righe.map(r => (
        <div key={r.etichetta} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-slate-500"><i className="inline-block h-0.5 w-3 rounded" style={{ background: r.colore }} />{r.etichetta}</span>
          <b className="font-semibold text-slate-900">{r.valore}</b>
        </div>
      ))}
    </div>
  )
}

/** Colonne affiancate mese per mese: anno in corso, anno prima e trattino del budget. */
export function ColonneMensili({ ora, prima, budget, meseParziale, ultimoMese, etichettaParziale }: {
  ora: number[]; prima: number[]; budget: (number | null)[]; meseParziale: number | null; ultimoMese: number; etichettaParziale: string
}) {
  const [ref, W] = useLarghezza<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const H = 280, m = { l: 44, r: 8, t: 12, b: 26 }
  const max = Math.max(1, ...ora, ...prima, ...budget.map(b => b || 0)) * 1.08
  const step = max > 400000 ? 100000 : max > 150000 ? 50000 : max > 80000 ? 20000 : max > 20000 ? 10000 : 5000
  const top = Math.ceil(max / step) * step
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - v / top)
  const bw = (W - m.l - m.r) / 12, bar = Math.min(18, bw * 0.32)
  const col = (v: number, x: number, fill: string, op = 1) => {
    if (!v) return null
    const h = y(0) - y(v), r = Math.min(4, h)
    return <path d={`M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${bar - 2 * r} q${r},0 ${r},${r} v${h - r} z`} fill={fill} opacity={op} />
  }
  const tacche: number[] = []; for (let v = 0; v <= top; v += step) tacche.push(v)
  return (
    <div ref={ref} className="w-full">
      <svg width={W} height={H} role="img" aria-label="Ricavi mese per mese, anno in corso contro anno prima">
        {tacche.map(v => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? COLORI.asse : COLORI.griglia} />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={COLORI.testo2}>{asseK(v)}</text>
          </g>
        ))}
        {MESI.map((nome, i) => {
          const cx = m.l + bw * i + bw / 2
          const righe: RigaTooltip[] = [
            { etichetta: 'Quest\'anno' + (meseParziale === i ? ` (${etichettaParziale})` : ''), valore: ora[i] ? euro(ora[i]) : (i >= ultimoMese ? 'non ancora' : 'non aperto'), colore: COLORI.anno },
            { etichetta: 'Anno prima', valore: prima[i] ? euro(prima[i]) : 'non aperto', colore: COLORI.prima },
          ]
          if (budget[i]) righe.push({ etichetta: 'Budget', valore: euro(budget[i] as number), colore: COLORI.budget })
          return (
            <g key={nome}>
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={COLORI.testo2}>{nome}</text>
              {col(prima[i], cx - bar - 1, COLORI.prima)}
              {col(ora[i], cx + 1, COLORI.anno, meseParziale === i ? 0.55 : 1)}
              {budget[i] ? <line x1={cx - bar - 4} x2={cx + bar + 4} y1={y(budget[i] as number)} y2={y(budget[i] as number)} stroke={COLORI.budget} strokeWidth={2} strokeLinecap="round" /> : null}
              <rect x={m.l + bw * i} y={m.t} width={bw} height={H - m.t - m.b} fill="transparent" tabIndex={0}
                onPointerMove={e => setTip({ x: e.clientX, y: e.clientY, titolo: nome.toUpperCase(), righe })}
                onPointerLeave={() => setTip(null)} onBlur={() => setTip(null)}
                onFocus={e => { const b = e.currentTarget.getBoundingClientRect(); setTip({ x: b.x + b.width / 2, y: b.y + 40, titolo: nome.toUpperCase(), righe }) }} />
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

/** Mini grafico a linee 12 mesi: anno in corso e anno prima, scala comune passata da fuori. */
export function MiniLinee({ ora, prima, max, ultimoMese, titolo, meseEvidenziato }: { ora: number[]; prima: number[]; max: number; ultimoMese: number; titolo: string; meseEvidenziato?: number }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const X = (i: number) => 4 + i * (232 / 11), Y = (v: number) => 58 - (v / Math.max(1, max)) * 52
  const percorso = (arr: number[], fino: number) => {
    let d = '', penna = false
    arr.forEach((v, i) => { if (i > fino) return; if (v) { d += (penna ? 'L' : 'M') + X(i) + ',' + Y(v); penna = true } else penna = false })
    return d
  }
  const punti = ora.map((v, i) => (v && !ora[i - 1] && !ora[i + 1] && i < ultimoMese ? i : -1)).filter(i => i >= 0)
  return (
    <div className="relative">
      <svg viewBox="0 0 240 64" className="h-16 w-full" aria-hidden="true"
        onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.max(0, Math.min(11, Math.round((e.clientX - r.x) / r.width * 11))); setTip({ x: e.clientX, y: e.clientY, titolo: `${titolo} · ${MESI[i]}`, righe: [{ etichetta: 'Quest\'anno', valore: ora[i] ? euro(ora[i]) : '—', colore: COLORI.anno }, { etichetta: 'Anno prima', valore: prima[i] ? euro(prima[i]) : 'non aperto', colore: COLORI.prima }] }) }}
        onPointerLeave={() => setTip(null)}>
        <line x1={0} x2={240} y1={58} y2={58} stroke={COLORI.griglia} />
        {meseEvidenziato != null && meseEvidenziato >= 0 && <line x1={X(meseEvidenziato)} x2={X(meseEvidenziato)} y1={2} y2={58} stroke={COLORI.asse} strokeWidth={1} />}
        <path d={percorso(prima, 11)} fill="none" stroke={COLORI.prima} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={percorso(ora, ultimoMese - 1)} fill="none" stroke={COLORI.anno} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {punti.map(i => <circle key={i} cx={X(i)} cy={Y(ora[i])} r={4} fill={COLORI.anno} stroke="#fff" strokeWidth={2} />)}
        {meseEvidenziato != null && prima[meseEvidenziato] > 0 && <circle cx={X(meseEvidenziato)} cy={Y(prima[meseEvidenziato])} r={3.5} fill={COLORI.prima} stroke="#fff" strokeWidth={1.5} />}
        {meseEvidenziato != null && ora[meseEvidenziato] > 0 && <circle cx={X(meseEvidenziato)} cy={Y(ora[meseEvidenziato])} r={4} fill={COLORI.anno} stroke="#fff" strokeWidth={2} />}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

/** Barre orizzontali in due pezzi (dipendenti + quota amministratore) con totale e peso sui ricavi. */
export function BarrePersonale({ righe }: { righe: { nome: string; dip: number; amm: number; ricavi: number; evidenzia?: boolean }[] }) {
  const [ref, W] = useLarghezza<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const H = Math.max(160, righe.length * 30 + 28), m = { l: 140, r: 140, t: 6, b: 22 }
  const max = Math.max(1, ...righe.map(r => r.dip + r.amm)) * 1.05
  const x = (v: number) => m.l + (W - m.l - m.r) * v / max
  const rh = (H - m.t - m.b) / Math.max(1, righe.length), bh = Math.min(18, rh * 0.6)
  const step = max > 200000 ? 50000 : max > 80000 ? 25000 : 10000
  const tacche: number[] = []; for (let v = 0; v <= max; v += step) tacche.push(v)
  return (
    <div ref={ref} className="w-full">
      <svg width={W} height={H} role="img" aria-label="Costo del personale per negozio e sede">
        {tacche.map(v => (<g key={v}><line x1={x(v)} x2={x(v)} y1={m.t} y2={H - m.b} stroke={COLORI.griglia} /><text x={x(v)} y={H - 6} textAnchor="middle" fontSize={11} fill={COLORI.testo2}>{asseK(v)}</text></g>))}
        {righe.map((r, i) => {
          const yy = m.t + rh * i + (rh - bh) / 2, w1 = x(r.dip) - x(0), w2 = x(r.dip + r.amm) - x(r.dip)
          const tot = r.dip + r.amm
          return (
            <g key={r.nome}>
              <text x={m.l - 8} y={yy + bh / 2 + 4} textAnchor="end" fontSize={11} fill={COLORI.testo2} fontWeight={r.evidenzia ? 700 : 400}>{r.nome}</text>
              <rect x={x(0)} y={yy} width={Math.max(0, w1 - (r.amm ? 2 : 0))} height={bh} rx={r.amm ? 0 : 4} fill={COLORI.anno} />
              {r.amm > 0 && <rect x={x(r.dip)} y={yy} width={Math.max(2, w2)} height={bh} rx={3} fill={COLORI.budget} />}
              <text x={x(tot) + 6} y={yy + bh / 2 + 4} fontSize={11} fill={COLORI.testo}>{euro(tot)}{r.ricavi ? ` · ${nf1.format(tot / r.ricavi * 100)}%` : ''}</text>
              <rect x={0} y={m.t + rh * i} width={W} height={rh} fill="transparent"
                onPointerMove={e => setTip({ x: e.clientX, y: e.clientY, titolo: r.nome, righe: [{ etichetta: 'Dipendenti', valore: euro(r.dip), colore: COLORI.anno }, { etichetta: 'Quota amministratore', valore: euro(r.amm), colore: COLORI.budget }, { etichetta: 'Su ricavi', valore: r.ricavi ? nf1.format(tot / r.ricavi * 100) + '%' : 'nessun ricavo', colore: 'transparent' }] })}
                onPointerLeave={() => setTip(null)} />
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

/** Debiti fornitori per fascia di scadenza, in somma progressiva, contro la linea della liquidità. */
export function BarreCassa({ fasce, liquidita }: { fasce: { nome: string; valore: number; colore: string }[]; liquidita: number }) {
  const [ref, W] = useLarghezza<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const H = 250, m = { l: 150, r: 100, t: 26, b: 22 }
  let cum = 0
  const righe = fasce.map(f => { cum += f.valore; return { ...f, cum } })
  const top = Math.max(1, cum, liquidita) * 1.12
  const step = top > 1e6 ? 500000 : top > 400000 ? 200000 : top > 100000 ? 50000 : 20000
  const x = (v: number) => m.l + (W - m.l - m.r) * v / top
  const rh = (H - m.t - m.b) / Math.max(1, righe.length), bh = Math.min(20, rh * 0.55)
  const tacche: number[] = []; for (let v = 0; v <= top; v += step) tacche.push(v)
  return (
    <div ref={ref} className="w-full">
      <svg width={W} height={H} role="img" aria-label="Debiti fornitori per scadenza contro la liquidità">
        {tacche.map(v => (<g key={v}><line x1={x(v)} x2={x(v)} y1={m.t} y2={H - m.b} stroke={COLORI.griglia} /><text x={x(v)} y={H - 6} textAnchor="middle" fontSize={11} fill={COLORI.testo2}>{asseK(v)}</text></g>))}
        {righe.map((r, i) => {
          const yy = m.t + rh * i + (rh - bh) / 2, x0 = x(r.cum - r.valore)
          return (
            <g key={r.nome}>
              <text x={m.l - 8} y={yy + bh / 2 + 4} textAnchor="end" fontSize={11} fill={COLORI.testo2}>{r.nome}</text>
              {x0 - x(0) > 3 && <rect x={x(0)} y={yy} width={x0 - x(0) - 2} height={bh} rx={4} fill={COLORI.prima} opacity={0.55} />}
              <rect x={x0} y={yy} width={Math.max(2, x(r.cum) - x0)} height={bh} rx={4} fill={r.colore} />
              <text x={x(r.cum) + 6} y={yy + bh / 2 + 4} fontSize={11} fill={COLORI.testo}>{euro(r.cum)}</text>
              <rect x={m.l} y={m.t + rh * i} width={W - m.l} height={rh} fill="transparent"
                onPointerMove={e => setTip({ x: e.clientX, y: e.clientY, titolo: r.nome, righe: [{ etichetta: 'Questa fascia', valore: euro(r.valore), colore: r.colore }, { etichetta: 'Totale fino a qui', valore: euro(r.cum), colore: COLORI.prima }, { etichetta: 'Liquidità oggi', valore: euro(liquidita), colore: COLORI.testo }] })}
                onPointerLeave={() => setTip(null)} />
            </g>
          )
        })}
        <line x1={x(liquidita)} x2={x(liquidita)} y1={m.t - 4} y2={H - m.b} stroke={COLORI.testo} strokeWidth={2} />
        <text x={x(liquidita)} y={m.t - 10} textAnchor="middle" fontSize={11} fontWeight={600} fill={COLORI.testo}>liquidità oggi {euro(liquidita)}</text>
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

export function euroCompatto(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return '€ ' + new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(v / 1e6) + ' mln'
  if (a >= 1000) return '€ ' + nf0.format(Math.round(v / 1000)) + ' mila'
  return euro(v)
}

export function Scheda({ titolo, sotto, destra, children, className = '' }: { titolo: string; sotto?: ReactNode; destra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-sm font-semibold text-slate-900">{titolo}</h2>{sotto && <div className="mt-0.5 text-xs text-slate-500">{sotto}</div>}</div>
        {destra}
      </div>
      {children}
    </section>
  )
}

export function Legenda({ voci }: { voci: { nome: string; colore: string; forma?: 'quadro' | 'linea' }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-500">
      {voci.map(v => (
        <span key={v.nome} className="inline-flex items-center gap-1.5">
          <i className={v.forma === 'linea' ? 'inline-block h-0.5 w-3.5 rounded' : 'inline-block h-2.5 w-2.5 rounded-sm'} style={{ background: v.colore }} />{v.nome}
        </span>
      ))}
    </div>
  )
}
