// Dashboard = cruscotto direzione (Patrizio, 27/11/2026: sostituisce la Dashboard di prima).
// Un amministratore delegato vede in un colpo d'occhio: quanto si incassa e contro l'anno prima a parità
// di negozi, la chiusura stimata, la cassa (liquidità contro scaduto e uscite), il personale sui ricavi,
// il margine sulla merce, ogni negozio mese per mese, il conto a scalare di ogni negozio e gli avvisi.
// Dati: public.cruscotto_direzione(p_anno) (migration 481), calcoli in src/lib/cruscotto.ts.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../hooks/usePeriod'
import {
  costruisciCruscotto, avvisi as calcolaAvvisi, parita, paritaInsieme, margineParita, confrontoMese, stimaChiusura, contoNegozio, mesePieno, somma, fino,
  type Cruscotto, type DatiCruscottoRaw, type Negozio, type Avviso,
} from '../lib/cruscotto'
import { ColonneMensili, MiniLinee, BarrePersonale, BarreCassa, Scheda, Legenda, COLORI, MESI, euro } from '../components/cruscotto/Grafici'

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }) // de-DE: punto delle migliaia anche su 4 cifre (it-IT scrive 2670)
const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const pct = (v: number) => (v > 0 ? '+' : '') + nf1.format(v) + '%'
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

function Variazione({ v, punti = false }: { v: number | null; punti?: boolean }) {
  if (v == null) return <span className="text-slate-400">—</span>
  const su = v >= 0
  return <span className={`font-semibold ${su ? 'text-emerald-700' : 'text-red-600'}`}>{su ? '▲' : '▼'} {punti ? (v > 0 ? '+' : '') + nf1.format(v) + ' punti' : pct(v)}</span>
}

const STILE_AVVISO: Record<Avviso['livello'], { bg: string; icona: string; simbolo: string }> = {
  critico: { bg: 'bg-red-600', icona: 'text-white', simbolo: '!' },
  serio: { bg: 'bg-orange-400', icona: 'text-white', simbolo: '▼' },
  attenzione: { bg: 'bg-amber-400', icona: 'text-slate-900', simbolo: '!' },
  buono: { bg: 'bg-emerald-600', icona: 'text-white', simbolo: '▲' },
  info: { bg: 'bg-slate-400', icona: 'text-white', simbolo: 'i' },
}

export default function Dashboard() {
  const { year } = usePeriod()
  const [dati, setDati] = useState<Cruscotto | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [caricamento, setCaricamento] = useState(true)
  const [scelto, setScelto] = useState<string>('TUTTI')
  const [meseScelto, setMeseScelto] = useState<number>(0) // 0 = mese in corso

  useEffect(() => {
    let vivo = true
    setCaricamento(true); setErrore(null)
    supabase.rpc('cruscotto_direzione', { p_anno: year }).then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErrore(error.message); setDati(null) }
      else if (data) setDati(costruisciCruscotto(data as unknown as DatiCruscottoRaw))
      setCaricamento(false)
    })
    return () => { vivo = false }
  }, [year])

  const vista = useMemo(() => {
    if (!dati) return null
    const aperti = dati.negozi.filter(n => !n.chiuso)
    const lista = scelto === 'TUTTI' ? aperti : aperti.filter(n => n.id === scelto)
    return { aperti, lista }
  }, [dati, scelto])

  if (caricamento && !dati) return (
    <div className="flex items-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Carico il cruscotto…</div>
  )
  if (errore) return (
    <div className="p-6"><PageHeader title="Dashboard" subtitle="Come sta andando l'azienda" />
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Non riesco a leggere i dati del cruscotto: {errore}</div></div>
  )
  if (!dati || !vista) return null
  const { aperti, lista } = vista
  const c = dati
  const mp = mesePieno(c)
  const uno = lista.length === 1 ? lista[0] : null

  // ===== Ricavi e stima =====
  const ricaviAnno = somma(lista.map(n => somma(n.y1)))
  const anno0 = somma(lista.map(n => somma(n.y0)))
  const lfl = paritaInsieme(lista, mp)
  const stima = somma(lista.map(n => stimaChiusura(n, c)))
  const conBudget = lista.some(n => n.budget)
  const finoAl = c.meseUltimo ? `${c.giornoUltimo} ${MESI_LUNGHI[c.meseUltimo - 1]}` : '—'

  // ===== Cassa =====
  const s = c.scaduto, liq = c.liquidita?.saldo ?? 0
  const scaduto = s ? s.oltre30 + s.ultimi30 : 0
  const copertura = s && scaduto + s.entro30 > 0 ? liq / (scaduto + s.entro30) * 100 : null

  // ===== Personale e MODA (periodo del conto) =====
  const M = c.meseConto
  const persNegozi = somma(lista.map(n => fino(n.personale, M) + n.ammQuota))
  const persSede = scelto === 'TUTTI' && c.sede ? fino(c.sede.personale, M) : 0
  const ricConto = somma(lista.map(n => fino(n.y1, M)))
  const conModa = lista.filter(n => n.moda1)
  const vend = somma(conModa.map(n => n.moda1!.vendite)), costoMerce = somma(conModa.map(n => n.moda1!.costo))
  const dResa = margineParita(lista)?.punti ?? null

  // ===== Grafico mensile =====
  const ora = Array(12).fill(0), prima = Array(12).fill(0), bud: (number | null)[] = Array(12).fill(null)
  lista.forEach(n => { n.y1.forEach((v, i) => (ora[i] += v)); n.y0.forEach((v, i) => (prima[i] += v)); n.budget?.forEach((v, i) => { if (v) bud[i] = (bud[i] || 0) + v }) })
  const parziale = c.meseParziale ? c.meseUltimo - 1 : null
  const maxMini = Math.max(1, ...aperti.flatMap(n => [...n.y1, ...n.y0]))
  const avvisi = calcolaAvvisi(c)
  const mese = meseScelto >= 1 && meseScelto <= c.meseUltimo ? meseScelto : c.meseUltimo || 1
  const meseParz = c.meseParziale && mese === c.meseUltimo
  const lflTutti = paritaInsieme(aperti, mp)
  const selettoreMese = (
    <label className="flex items-center gap-2 text-xs text-slate-500">Mese
      <select value={mese} onChange={e => setMeseScelto(Number(e.target.value))} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900" onClick={e => e.stopPropagation()}>
        {Array.from({ length: c.meseUltimo }, (_, i) => c.meseUltimo - i).map(m => (
          <option key={m} value={m}>{MESI_LUNGHI[m - 1]} {c.anno}{c.meseParziale && m === c.meseUltimo ? ` (in corso, fino al ${c.giornoUltimo})` : ''}</option>
        ))}
      </select>
    </label>
  )

  // ===== Personale per negozio =====
  const righePers = aperti.filter(n => fino(n.personale, M) + n.ammQuota > 0).map(n => ({ nome: n.nome, dip: fino(n.personale, M), amm: n.ammQuota, ricavi: fino(n.y1, M), evidenzia: n.id === scelto }))
    .sort((a, b) => (b.dip + b.amm) - (a.dip + a.amm))
  if (c.sede && fino(c.sede.personale, M) > 0) righePers.push({ nome: 'Sede / magazzino', dip: fino(c.sede.personale, M), amm: 0, ricavi: 0, evidenzia: false })

  const ricaviConfronto = (n: Negozio) => { const b = n.budget ? fino(n.budget, mp) : 0; return b ? (fino(n.y1, mp) / b - 1) * 100 : null }

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 p-4 sm:p-6">
      <PageHeader title="Dashboard" subtitle="Come sta andando l'azienda"
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-500">Negozio
            <select value={scelto} onChange={e => setScelto(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900">
              <option value="TUTTI">Tutti i negozi</option>
              {aperti.map(n => <option key={n.id} value={n.id}>{n.nome}</option>)}
            </select>
          </label>
        } />

      {/* Ricavi e chiusura stimata */}
      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1.25fr_1fr]">
        <div>
          <div className="text-sm text-slate-500">Ricavi netti {c.anno}{uno ? `, ${uno.nome}` : ''}, dal 1 gennaio al {finoAl} (imponibile, senza IVA)</div>
          <div className="my-2 text-5xl font-semibold tracking-tight text-slate-900">{euro(ricaviAnno)}</div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
              {lfl != null ? <><Variazione v={lfl} /> a parità di negozi e mesi pieni (gennaio-{MESI_LUNGHI[mp - 1]})</> : 'Negozio nuovo: nessun anno prima da confrontare'}
            </span>
            {!uno && <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{aperti.length} negozi aperti</span>}
          </div>
        </div>
        <div className="flex flex-col justify-center gap-2 rounded-xl bg-slate-50 p-4">
          <div className="flex justify-between text-xs text-slate-500"><span>Chiusura {c.anno} stimata</span><strong className="text-slate-900">{euro(stima)}</strong></div>
          {(() => { const max = Math.max(stima, anno0, 1) * 1.08; return (
            <div className="relative h-2.5 rounded-full bg-blue-100">
              <i className="absolute inset-y-0 left-0 rounded-full bg-blue-600 opacity-35" style={{ width: `${stima / max * 100}%` }} />
              <i className="absolute inset-y-0 left-0 rounded-full bg-blue-600" style={{ width: `${ricaviAnno / max * 100}%` }} />
              {anno0 > 0 && <b className="absolute -inset-y-1 w-0.5 rounded bg-slate-900" style={{ left: `${anno0 / max * 100}%` }} title="Anno prima" />}
            </div>) })()}
          <div className="flex justify-between text-xs text-slate-500"><span>Incassato <strong className="text-slate-900">{euro(ricaviAnno)}</strong></span><span>Tacca: anno prima <strong className="text-slate-900">{anno0 ? euro(anno0) : 'non aperto'}</strong></span></div>
          <div className="flex justify-between gap-2 text-xs text-slate-500">
            <span>Stima: incassato{c.meseParziale ? ' + mese in corso in proiezione' : ''} + mesi che mancano {conBudget ? 'a budget' : 'come l\'anno prima, con la crescita a parità'}</span>
            {anno0 > 0 && <Variazione v={(stima / anno0 - 1) * 100} />}
          </div>
        </div>
      </section>

      {/* Quattro numeri */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Scheda titolo="Liquidità sui conti" sotto="Saldo dei conti">
          <div className="text-2xl font-semibold text-slate-900">{euro(liq)}</div>
          <div className="text-xs text-slate-500">{c.liquidita?.conti ?? 0} conti{c.liquidita?.aggiornato ? ` · saldo del ${new Date(c.liquidita.aggiornato).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}` : ''}</div>
          {copertura != null && <>
            <div className="mt-3 text-xs text-slate-500">Copre il <strong className="text-slate-900">{nf1.format(copertura)}%</strong> di scaduto + 30 giorni</div>
            <div className="mt-1.5 h-2 rounded-full bg-blue-100"><div className="h-2 rounded-full" style={{ width: `${Math.min(100, copertura)}%`, background: copertura < 100 ? COLORI.serio : COLORI.anno }} /></div>
          </>}
        </Scheda>
        <Scheda titolo="Fornitori scaduti" sotto="IVA compresa, come lo Scadenzario">
          <Link to="/scadenzario" className="block">
            <div className="text-2xl font-semibold text-slate-900">{euro(scaduto)}</div>
            <div className="text-xs text-slate-500">{s?.fatture_scadute ?? 0} fatture · di cui <b>{euro(s?.oltre30 ?? 0)}</b> da oltre 30 giorni</div>
          </Link>
        </Scheda>
        <Scheda titolo={`Personale sui ricavi (gennaio-${MESI_LUNGHI[M - 1] || '—'})`}>
          <div className="text-2xl font-semibold text-slate-900">{ricConto ? nf1.format((persNegozi + persSede) / ricConto * 100) + '%' : 'n.d.'}</div>
          <div className="text-xs text-slate-500">{euro(persNegozi + persSede)} di costo aziendale del personale (stipendi, contributi, TFR, amministratori){persSede ? ', sede compresa' : ''}, su {euro(ricConto)} di ricavi senza IVA</div>
        </Scheda>
        <Scheda titolo={`Margine sulla merce (MODA, gennaio-${MESI_LUNGHI[c.meseModa - 1] || '—'})`}>
          <div className="text-2xl font-semibold text-slate-900">{vend ? nf1.format((1 - costoMerce / vend) * 100) + '%' : 'n.d.'}</div>
          <div className="text-xs text-slate-500">{dResa != null ? <><Variazione v={dResa} punti /> sull'anno prima a parità di negozi</> : vend ? 'Senza storico MODA da confrontare' : 'Nessun report MODA'}</div>
          {vend > 0 && <div className="mt-2 text-xs text-slate-500">Conversione {nf1.format(somma(conModa.map(n => n.moda1!.scontrini)) / Math.max(1, somma(conModa.map(n => n.moda1!.ingressi))) * 100)}% · scontrino medio {euro(vend / Math.max(1, somma(conModa.map(n => n.moda1!.scontrini))))}</div>}
        </Scheda>
      </div>

      {/* Mese per mese + avvisi */}
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Scheda titolo={`${uno ? uno.nome : 'Azienda'}: ricavi mese per mese, ${c.anno} contro ${c.anno - 1}`}
          sotto={`Ricavi senza IVA. ${c.meseParziale ? `${MESI_LUNGHI[c.meseUltimo - 1]} fino al ${c.giornoUltimo} (colonna chiara). ` : ''}Trattino arancio: budget del mese.`}
          destra={<Legenda voci={[{ nome: String(c.anno), colore: COLORI.anno }, { nome: String(c.anno - 1), colore: COLORI.prima }, ...(bud.some(Boolean) ? [{ nome: 'Budget', colore: COLORI.budget, forma: 'linea' as const }] : [])]} />}>
          <ColonneMensili ora={ora} prima={prima} budget={bud} meseParziale={parziale} ultimoMese={c.meseUltimo} etichettaParziale={`fino al ${c.giornoUltimo}`} />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-right text-xs tabular-nums">
              <thead><tr className="text-slate-500"><th className="p-1.5 text-left font-medium" />{MESI.map(m => <th key={m} className="p-1.5 font-medium">{m}</th>)}</tr></thead>
              <tbody className="[&_td]:border-t [&_td]:border-slate-100 [&_td]:p-1.5">
                <tr><td className="text-left">{c.anno}</td>{ora.map((v, i) => <td key={i}>{v ? nf0.format(Math.round(v)) : ''}</td>)}</tr>
                <tr><td className="text-left">{c.anno - 1}</td>{prima.map((v, i) => <td key={i}>{v ? nf0.format(Math.round(v)) : ''}</td>)}</tr>
                {bud.some(Boolean) && <tr><td className="text-left">Budget</td>{bud.map((v, i) => <td key={i}>{v ? nf0.format(Math.round(v)) : ''}</td>)}</tr>}
                {bud.some(Boolean) && <tr><td className="text-left">Contro budget</td>{bud.map((v, i) => {
                  if (!v || !ora[i] || i >= c.meseUltimo) return <td key={i} />
                  const base = i === parziale ? v * c.giornoUltimo / c.giorniMese : v, p = (ora[i] / base - 1) * 100
                  return <td key={i} className={p >= 0 ? 'text-emerald-700' : 'text-red-600'}>{pct(p)}</td>
                })}</tr>}
                <tr><td className="text-left">Stessi negozi</td>{MESI.map((_, i) => {
                  if (i >= c.meseUltimo) return <td key={i} />
                  let a = 0, b = 0
                  lista.forEach(n => { if (n.aperturaMese && i + 1 >= n.aperturaMese && n.y0[i] && n.y1[i]) { a += n.y0[i]; b += n.y1[i] } })
                  if (!a || !b) return <td key={i} />
                  if (i === parziale) a = a * c.giornoUltimo / c.giorniMese
                  const p = (b / a - 1) * 100
                  return <td key={i} className={p >= 0 ? 'text-emerald-700' : 'text-red-600'}>{pct(p)}</td>
                })}</tr>
              </tbody>
            </table>
          </div>
        </Scheda>
        <Scheda titolo="Da guardare" sotto="Scritto dal sistema sui numeri di oggi">
          <div className="space-y-2.5">
            {avvisi.map((a, i) => { const st = STILE_AVVISO[a.livello]; return (
              <div key={i} className="flex gap-2.5 rounded-xl bg-slate-50 p-3">
                <span className={`mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[11px] font-bold ${st.bg} ${st.icona}`}>{st.simbolo}</span>
                <p className="text-sm text-slate-900">{a.titolo}<span className="mt-0.5 block text-xs text-slate-500">{a.dettaglio}</span></p>
              </div>) })}
          </div>
        </Scheda>
      </div>

      {/* Ogni negozio: il mese scelto contro lo stesso mese dell'anno prima */}
      <Scheda titolo={`Ogni negozio: ${MESI_LUNGHI[mese - 1]} ${c.anno} contro ${MESI_LUNGHI[mese - 1]} ${c.anno - 1}`}
        sotto={meseParz ? `Mese in corso: dal 1 al ${c.giornoUltimo} contro gli stessi giorni dell'anno prima. Sotto, l'andamento dell'anno (blu quest'anno, grigio l'anno prima). Clicca un negozio per vederlo da solo.` : 'Mese intero contro lo stesso mese dell\'anno prima. Sotto, l\'andamento dell\'anno (blu quest\'anno, grigio l\'anno prima). Clicca un negozio per vederlo da solo.'}
        destra={selettoreMese}>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {aperti.map(n => { const k = confrontoMese(n, c, mese); return (
            <button key={n.id} type="button" onClick={() => setScelto(scelto === n.id ? 'TUTTI' : n.id)} aria-pressed={scelto === n.id}
              className={`rounded-xl border p-3 text-left hover:bg-slate-50 ${scelto === n.id ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">{n.nome}</span>
                {k.pct != null ? <Variazione v={k.pct} /> : <span className="text-xs text-slate-500">{k.ora ? 'nuovo' : '—'}</span>}
              </div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{k.ora ? euro(k.ora) : '—'}</div>
              <div className="text-xs text-slate-500">
                {k.prima ? <>anno prima {euro(k.prima)}{k.parziale ? ` (1-${c.giornoUltimo})` : ''}</> : 'l\'anno prima non era aperto'}
                {k.parziale && k.ora > 0 && <> · stima del mese <b className="text-slate-700">{euro(k.stima)}</b></>}
              </div>
              <MiniLinee ora={n.y1} prima={n.y0} max={maxMini} ultimoMese={c.meseUltimo} titolo={n.nome} meseEvidenziato={mese - 1} />
            </button>) })}
        </div>
      </Scheda>

      {/* Vendite: mese scelto contro l'anno prima, poi l'anno */}
      <Scheda titolo="Vendite di ogni negozio" destra={selettoreMese}
        sotto={`Ricavi senza IVA. ${MESI_LUNGHI[mese - 1]} ${c.anno} contro lo stesso mese dell'anno prima${meseParz ? ` (stessi giorni, dal 1 al ${c.giornoUltimo})` : ''}; poi l'anno da gennaio a ${MESI_LUNGHI[mp - 1] || '—'}. Margine sulla merce, conversione e scontrino dal report MODA (gennaio-${MESI_LUNGHI[c.meseModa - 1] || '—'}).`}>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-right text-sm tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400 [&_th]:px-2 [&_th]:pt-1 [&_th]:font-medium">
                <th /><th colSpan={5} className="border-b border-slate-200 text-center">{MESI_LUNGHI[mese - 1]}</th><th colSpan={4} className="border-b border-slate-200 text-center">anno da gennaio</th><th colSpan={3} className="border-b border-slate-200 text-center">MODA</th>
              </tr>
              <tr className="text-xs text-slate-500 [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
                <th className="text-left">Negozio</th><th>{c.anno}</th><th>{c.anno - 1}</th><th>Differenza</th><th>%</th><th>Stima del mese</th>
                <th>Ricavi</th><th>vs anno prima*</th><th>vs budget</th><th>Stima {c.anno}</th><th>Margine merce</th><th>Conversione</th><th>Scontrino</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-t [&_td]:border-slate-100 [&_td]:px-2 [&_td]:py-2">
              {aperti.map(n => { const k = confrontoMese(n, c, mese), p = parita(n, mp), b = ricaviConfronto(n), m = n.moda1; return (
                <tr key={n.id} onClick={() => setScelto(scelto === n.id ? 'TUTTI' : n.id)} className={`cursor-pointer hover:bg-slate-50 ${scelto === n.id ? 'bg-blue-50' : ''}`}>
                  <td className="text-left">{n.nome}</td>
                  <td>{k.ora ? euro(k.ora) : '—'}</td><td>{k.prima ? euro(k.prima) : '—'}</td>
                  <td className={k.pct == null ? '' : k.ora >= k.prima ? 'text-emerald-700' : 'text-red-600'}>{k.pct != null ? (k.ora >= k.prima ? '+' : '−') + euro(Math.abs(k.ora - k.prima)) : '—'}</td>
                  <td>{k.pct != null ? <Variazione v={k.pct} /> : (k.ora ? 'nuovo' : '—')}</td>
                  <td>{k.parziale && k.ora ? euro(k.stima) : k.ora ? euro(k.ora) : '—'}</td>
                  <td>{fino(n.y1, mp) ? euro(fino(n.y1, mp)) : '—'}</td>
                  <td>{p ? <Variazione v={p.pct} /> : 'nuovo'}</td><td>{b != null ? <Variazione v={b} /> : 'n.d.'}</td><td>{euro(stimaChiusura(n, c))}</td>
                  <td>{m && m.vendite > 0 ? nf1.format((1 - m.costo / m.vendite) * 100) + '%' : 'n.d.'}</td>
                  <td>{m && m.ingressi ? nf1.format(m.scontrini / m.ingressi * 100) + '%' : 'n.d.'}</td>
                  <td>{m && m.scontrini && m.vendite > 0 ? euro(m.vendite / m.scontrini) : 'n.d.'}</td>
                </tr>) })}
              {scelto === 'TUTTI' && (() => {
                const ks = aperti.map(n => confrontoMese(n, c, mese)), conf = ks.filter(k => k.pct != null)
                const ora = somma(ks.map(k => k.ora)), a = somma(conf.map(k => k.prima)), bb = somma(conf.map(k => k.ora))
                const pc = a ? (bb / a - 1) * 100 : null
                return (
                  <tr className="font-semibold [&_td]:border-t-2 [&_td]:border-slate-300">
                    <td className="text-left">Tutti</td><td>{euro(ora)}</td><td>{euro(somma(ks.map(k => k.prima)))}</td>
                    <td /><td>{pc != null ? <Variazione v={pc} /> : '—'}</td><td>{euro(somma(ks.map(k => k.stima)))}</td>
                    <td>{euro(somma(aperti.map(n => fino(n.y1, mp))))}</td><td>{lflTutti != null ? <Variazione v={lflTutti} /> : '—'}</td><td /><td>{euro(somma(aperti.map(n => stimaChiusura(n, c))))}</td><td /><td /><td />
                  </tr>)
              })()}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">La percentuale del mese e quella della riga «Tutti» contano solo i negozi aperti per tutto quel mese anche l'anno prima. * Anno: solo i mesi pieni aperti in tutti e due gli anni.</p>
      </Scheda>

      {/* Costi: conto a scalare */}
      <div className="pt-2"><h2 className="text-lg font-semibold text-slate-900">Costi</h2><p className="text-sm text-slate-500">Dai ricavi a quanto resta, negozio per negozio.</p></div>
      <ContoScalare c={c} lista={lista} scelto={scelto} setScelto={setScelto} />

      <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
        <Scheda titolo="Costo del personale per negozio e sede" sotto={`Gennaio-${MESI_LUNGHI[M - 1] || '—'}, dal Prospetto paghe. A destra il totale e quanto pesa sui ricavi del negozio.`}
          destra={<Legenda voci={[{ nome: 'Dipendenti', colore: COLORI.anno }, { nome: 'Quota amministratore', colore: COLORI.budget }]} />}>
          {righePers.length ? <BarrePersonale righe={righePers} /> : <p className="text-sm text-slate-500">Nessun Prospetto paghe per quest'anno.</p>}
          <p className="mt-2 text-xs text-slate-400">Il compenso degli amministratori ({euro(c.ammTotale)}) è diviso fra i negozi in proporzione ai ricavi. In Sede restano i dipendenti di sede e magazzino.</p>
        </Scheda>
        <Scheda titolo="Cassa: cosa c'è e cosa esce" sotto="Fatture fornitori da pagare per scadenza, IVA compresa (quello che esce dal conto), contro la liquidità di oggi"
          destra={<Legenda voci={[{ nome: 'Liquidità', colore: COLORI.testo, forma: 'linea' }]} />}>
          {s ? <BarreCassa liquidita={liq} fasce={[
            { nome: 'Scaduto da oltre 30 gg', valore: s.oltre30, colore: COLORI.critico },
            { nome: 'Scaduto ultimi 30 gg', valore: s.ultimi30, colore: COLORI.serio },
            { nome: 'Entro 30 giorni', valore: s.entro30, colore: COLORI.anno },
            { nome: 'Da 31 a 60 giorni', valore: s.da31a60, colore: COLORI.anno },
            { nome: 'Oltre 60 giorni', valore: s.oltre60, colore: COLORI.anno },
          ]} /> : <p className="text-sm text-slate-500">Scadenzario non disponibile per questo profilo.</p>}
          <p className="mt-2 text-xs text-slate-400">Somma progressiva: ogni barra aggiunge la sua fascia alle precedenti. Dove la barra supera la linea, la liquidità di oggi non basta.</p>
        </Scheda>
      </div>
      {caricamento && <div className="fixed bottom-4 right-4 rounded-full bg-white px-3 py-1.5 text-xs text-slate-500 shadow"><Loader2 className="mr-1 inline animate-spin" size={12} />Aggiorno…</div>}
    </div>
  )
}

function ContoScalare({ c, lista, scelto, setScelto }: { c: Cruscotto; lista: Negozio[]; scelto: string; setScelto: (v: string) => void }) {
  const M = c.meseConto
  const neg = (v: number | null) => (v == null ? 'n.d.' : Math.abs(v) < 0.5 ? '—' : '−' + euro(v))
  const T = { ricavi: 0, merce: 0, personale: 0, affitto: 0, spese: 0, allestimenti: 0 }
  const righe = lista.map(n => ({ n, k: contoNegozio(n, c) })).filter(r => r.k.ricavi || r.k.affitto || r.k.allestimenti)
  righe.forEach(({ k }) => { if (k.merce != null) { T.ricavi += k.ricavi; T.merce += k.merce } T.personale += k.personale; T.affitto += k.affitto; T.spese += k.spese; T.allestimenti += k.allestimenti })
  const sede = scelto === 'TUTTI' && c.sede ? { personale: fino(c.sede.personale, M), affitto: fino(c.sede.affitto, M), spese: fino(c.sede.spese, M), allestimenti: fino(c.sede.allestimenti, M) } : null
  if (sede) { T.personale += sede.personale; T.affitto += sede.affitto; T.spese += sede.spese; T.allestimenti += sede.allestimenti }
  const risultato = T.ricavi - T.merce - T.personale - T.affitto - T.spese
  return (
    <Scheda titolo="Conto di ogni negozio, a scalare" sotto={`Dai ricavi a quanto ogni negozio lascia all'azienda, gennaio-${MESI_LUNGHI[M - 1] || '—'} ${c.anno}, importi senza IVA. Clicca un negozio per vederlo da solo.`}>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-right text-sm tabular-nums">
          <thead><tr className="text-xs text-slate-500 [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium"><th /><th>Ricavi</th><th>Merce venduta</th><th>Primo margine</th><th>Personale*</th><th>Affitto**</th><th>Spese del negozio</th><th>Lascia all'azienda</th><th>su 100 € di ricavi</th><th>Allestimenti***</th></tr></thead>
          <tbody className="[&_td]:border-t [&_td]:border-slate-100 [&_td]:px-2 [&_td]:py-2">
            {righe.map(({ n, k }) => (
              <tr key={n.id} onClick={() => setScelto(scelto === n.id ? 'TUTTI' : n.id)} className={`cursor-pointer hover:bg-slate-50 ${scelto === n.id ? 'bg-blue-50' : ''}`}>
                <td className="text-left">{n.nome}</td><td>{k.ricavi ? euro(k.ricavi) : 'non ancora aperto'}</td><td>{neg(k.merce)}</td>
                <td>{k.merce != null ? euro(k.ricavi - k.merce) : '—'}</td><td>{neg(k.personale)}</td><td>{neg(k.affitto)}</td><td>{neg(k.spese)}</td>
                <td className={`font-semibold ${k.lascia != null && k.lascia < 0 ? 'text-red-600' : ''}`}>{k.lascia != null ? euro(k.lascia) : '—'}</td>
                <td className={k.lascia != null && k.lascia < 0 ? 'text-red-600' : ''}>{k.lascia != null && k.ricavi ? nf1.format(k.lascia / k.ricavi * 100) + ' €' : '—'}</td>
                <td>{k.allestimenti > 1000 ? euro(k.allestimenti) : ''}</td>
              </tr>))}
            {sede && <tr><td className="text-left">Sede / magazzino</td><td /><td /><td /><td>{neg(sede.personale)}</td><td>{neg(sede.affitto)}</td><td>{neg(sede.spese)}</td>
              <td className="font-semibold text-red-600">{neg(sede.personale + sede.affitto + sede.spese)}</td><td /><td>{sede.allestimenti > 1000 ? euro(sede.allestimenti) : ''}</td></tr>}
            {scelto === 'TUTTI' && T.ricavi > 0 && <tr className="font-semibold [&_td]:border-t-2 [&_td]:border-slate-300"><td className="text-left">Azienda</td><td>{euro(T.ricavi)}</td><td>{neg(T.merce)}</td><td>{euro(T.ricavi - T.merce)}</td><td>{neg(T.personale)}</td><td>{neg(T.affitto)}</td><td>{neg(T.spese)}</td>
              <td className={risultato < 0 ? 'text-red-600' : ''}>{euro(risultato)}</td><td className={risultato < 0 ? 'text-red-600' : ''}>{nf1.format(risultato / T.ricavi * 100)} €</td><td>{euro(T.allestimenti)}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">Merce venduta: ricavi × costo della merce sul venduto di MODA. * Dipendenti dal Prospetto paghe più la quota dell'amministratore divisa sui ricavi. ** Di competenza: chi paga a trimestre anticipato ha l'affitto spalmato sui tre mesi (la fattura di ottobre copre ottobre-dicembre). Spese del negozio: utenze, servizi, commissioni, oneri e interessi dalle fatture fornitori, senza IVA; le piccole spese pagate in contanti dalla cassa sono con l'IVA dentro, perché lo scontrino non la separa. *** Allestimenti e lavori una tantum, fuori dal margine. Prima di ammortamenti e tasse. Il costo della merce di MODA è più alto di quello del bilancio: il risultato è prudente.</p>
    </Scheda>
  )
}
