// «Divise e acquisti» sul telefono del negozio (Patrizio, 16/11/2026; migration 422).
// Si arriva dal proprio QR (o nome + PIN) e solo dopo l'entrata: nessuna vede le colleghe.
// Voce → divisa → codici a barre letti di fila con il «prezzo outlet oggi» → un solo
// «Conferma» → «Fatto». Nessun prezzo scontato, sconto o importo a video: lo sconto è
// personale e si decide nella gestione dipendenti. Serve la rete: niente coda offline.
// Ogni schermata si chiude da sola dopo 30 secondi senza tocchi.

import { useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, RefreshCw } from 'lucide-react'
import { VOCI, NOME_VOCE, codiceValido, leggiPrezzo, prezzoObbligatorio, tipoDellaVoce, type VoceCapo } from '../lib/divise'
import { apriDivise, registraCapi, type AperturaDivise } from '../lib/diviseDb'

// BarcodeDetector: Chrome per Android, non ancora nei tipi di TypeScript (come in Timbra.tsx)
interface RilevatoreCodici { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type CostruttoreRilevatore = new (o: { formats: string[] }) => RilevatoreCodici
const Rilevatore = (globalThis as unknown as { BarcodeDetector?: CostruttoreRilevatore }).BarcodeDetector
const FORMATI = ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e']
const ATTESA_MS = 30_000

type Fase =
  | { k: 'apertura' }
  | { k: 'voce' }
  | { k: 'divisa'; voce: VoceCapo }
  | { k: 'lettura'; voce: VoceCapo; divisa: number | null }
  | { k: 'invio'; voce: VoceCapo; divisa: number | null }
  | { k: 'fatto'; voce: VoceCapo; divisa: number | null; pezzi: number | null; capi: { codice: string; prezzo: number | null }[] }

export default function TimbraDivise({ outletId, codice, nome, onChiudi }: { outletId: string; codice: string; nome: string; onChiudi: () => void }) {
  const [fase, setFase] = useState<Fase>({ k: 'apertura' })
  const [apertura, setApertura] = useState<AperturaDivise | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [capi, setCapi] = useState<{ codice: string; prezzo: string }[]>([])
  const [scritto, setScritto] = useState('')
  const [tocco, setTocco] = useState(0)
  const [frontale, setFrontale] = useState(false)
  const [erroreCamera, setErroreCamera] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const ultimo = useRef<{ c: string; t: number } | null>(null)
  const primoNome = nome.split(' ')[0] || nome
  const tocca = () => setTocco((n) => n + 1)

  // si apre la sezione: il server controlla QR o PIN e che la persona sia entrata
  const apri = async () => {
    setErrore(null)
    if (!navigator.onLine) { setErrore('Senza rete divise e acquisti non si registrano: riprova quando torna la rete.'); return }
    const r = await apriDivise(outletId, codice).catch(() => ({ errore: 'Senza rete divise e acquisti non si registrano: riprova fra poco.' }))
    if ('errore' in r) { setErrore(r.errore); return }
    setApertura(r)
    setFase({ k: 'voce' })
  }
  useEffect(() => { void apri() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // chiusura da sola dopo 30 secondi senza tocchi (anche il «Fatto», dopo 10)
  useEffect(() => {
    if (fase.k === 'invio') return
    const t = setTimeout(onChiudi, fase.k === 'fatto' ? 10_000 : ATTESA_MS)
    return () => clearTimeout(t)
  }, [fase, tocco, capi, onChiudi])

  const aggiungi = (c: string) => {
    const v = c.trim()
    if (!codiceValido(v)) { setErrore('Codice non valido: controlla il numero sotto le barre.'); return }
    setErrore(null)
    setCapi((x) => [...x, { codice: v, prezzo: '' }])
    tocca()
  }

  // lettura dei codici a barre con la fotocamera
  const leggendo = fase.k === 'lettura'
  useEffect(() => {
    if (!leggendo) return
    if (!Rilevatore) { setErroreCamera('Questo telefono non legge i codici a barre dal browser: scrivi il numero sotto le barre.'); return }
    let fermo = false
    let stream: MediaStream | null = null
    const rilevatore = new Rilevatore({ formats: FORMATI })
    navigator.mediaDevices.getUserMedia({ video: { facingMode: frontale ? 'user' : 'environment' }, audio: false })
      .then((s) => {
        stream = s
        if (fermo) { s.getTracks().forEach((t) => t.stop()); return }
        setErroreCamera(null)
        const giro = async () => {
          if (fermo) return
          const v = videoRef.current
          if (!v) { setTimeout(giro, 250); return }
          if (v.srcObject !== s) { v.srcObject = s; void v.play().catch(() => undefined) }
          try {
            const letti = v.readyState >= 2 ? await rilevatore.detect(v) : []
            for (const l of letti) {
              const u = ultimo.current
              // lo stesso cartellino davanti alla fotocamera non si legge due volte di fila
              if (u && u.c === l.rawValue && Date.now() - u.t < 3000) continue
              ultimo.current = { c: l.rawValue, t: Date.now() }
              if (codiceValido(l.rawValue)) aggiungi(l.rawValue)
            }
          } catch { /* fotogramma non leggibile */ }
          setTimeout(giro, 300)
        }
        void giro()
      })
      .catch(() => setErroreCamera('Serve il permesso per la fotocamera, oppure scrivi il numero sotto le barre.'))
    return () => { fermo = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [leggendo, frontale]) // eslint-disable-line react-hooks/exhaustive-deps

  const conferma = async (voce: VoceCapo, divisa: number | null) => {
    const righe = capi.map((c) => ({ codice: c.codice, prezzo: c.prezzo.trim() ? leggiPrezzo(c.prezzo) : null }))
    setFase({ k: 'invio', voce, divisa })
    setErrore(null)
    const r = await registraCapi(outletId, codice, voce, divisa, righe)
      .catch(() => ({ errore: 'Non salvato: serve la rete. Riprova.' }))
    if ('errore' in r) { setErrore(r.errore); setFase({ k: 'lettura', voce, divisa }); return }
    setFase({ k: 'fatto', voce, divisa: r.divisa, pezzi: r.pezzi_divisa, capi: righe })
    setCapi([])
  }

  const testata = (titolo: string, indietro?: () => void) => (
    <div className="w-full flex items-center justify-between text-sm text-white/60">
      {indietro ? <button type="button" onClick={() => { indietro(); tocca() }} className="underline">‹ Indietro</button> : <span />}
      <span>{titolo}</span>
    </div>
  )

  return (
    <div className="w-full max-w-md flex flex-col gap-3" onPointerDown={tocca}>
      {fase.k === 'apertura' && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-2xl font-bold">{nome}</p>
          {errore ? (
            <>
              <p className="text-amber-300">{errore}</p>
              <button type="button" onClick={() => void apri()} className="px-6 py-3 rounded-2xl bg-white/10 text-lg">Riprova</button>
            </>
          ) : <RefreshCw className="animate-spin text-white/50" />}
          <button type="button" onClick={onChiudi} className="text-white/50 underline py-2">Chiudi</button>
        </div>
      )}

      {fase.k === 'voce' && (
        <>
          {testata(primoNome, onChiudi)}
          <p className="text-2xl font-bold">Divise e acquisti</p>
          {VOCI.map((v) => (
            <button key={v.k} type="button" onClick={() => setFase(tipoDellaVoce(v.k) ? { k: 'divisa', voce: v.k } : { k: 'lettura', voce: v.k, divisa: null })}
              className="w-full text-left rounded-2xl border border-white/25 px-4 py-4 active:bg-white/10">
              <span className="block text-lg font-semibold">{v.nome}</span>
              <span className="block text-sm text-white/60">{v.sotto}</span>
            </button>
          ))}
        </>
      )}

      {fase.k === 'divisa' && apertura && (() => {
        const tipo = tipoDellaVoce(fase.voce)
        const sue = apertura.divise.filter((d) => d.tipo === tipo)
        return (
          <>
            {testata(primoNome, () => setFase({ k: 'voce' }))}
            <p className="text-sm text-white/60">{NOME_VOCE[fase.voce]}</p>
            <p className="text-2xl font-bold">Quale divisa?</p>
            {sue.map((d) => (
              <button key={d.numero} type="button" onClick={() => setFase({ k: 'lettura', voce: fase.voce, divisa: d.numero })}
                className="w-full text-left rounded-2xl border border-[#ff0066] bg-[#ff0066]/10 px-4 py-4 active:bg-[#ff0066]/20">
                <span className="block text-lg font-semibold">Divisa {d.numero}</span>
                <span className="block text-sm text-white/60">aperta il {new Date(d.aperta_il).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' })} · {d.pezzi} {d.pezzi === 1 ? 'pezzo' : 'pezzi'}</span>
              </button>
            ))}
            <button type="button" onClick={() => setFase({ k: 'lettura', voce: fase.voce, divisa: null })}
              className="w-full text-left rounded-2xl border border-white/25 px-4 py-4 active:bg-white/10">
              <span className="block text-lg font-semibold">Nuova divisa</span>
              <span className="block text-sm text-white/60">sarà la Divisa {apertura.prossima}</span>
            </button>
            <p className="text-sm text-white/50">Una divisa è tutta fornita dall’azienda o tutta con sconto. I pezzi in più si aggiungono come «Divisa con sconto».</p>
          </>
        )
      })()}

      {(fase.k === 'lettura' || fase.k === 'invio') && (() => {
        const obbligatorio = prezzoObbligatorio(fase.voce)
        const mancano = capi.filter((c) => (obbligatorio && !c.prezzo.trim()) || (c.prezzo.trim() !== '' && leggiPrezzo(c.prezzo) == null)).length
        const titolo = `${NOME_VOCE[fase.voce]}${tipoDellaVoce(fase.voce) ? ` · ${fase.divisa ? `Divisa ${fase.divisa}` : 'nuova divisa'}` : ''}`
        return (
          <>
            {testata(primoNome, () => setFase(tipoDellaVoce(fase.voce) ? { k: 'divisa', voce: fase.voce } : { k: 'voce' }))}
            <p className="text-sm text-white/60">{titolo}</p>
            <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden bg-neutral-900 ring-1 ring-white/10">
              <video ref={videoRef} playsInline muted className={`w-full h-full object-cover ${frontale ? '-scale-x-100' : ''}`} />
              <div className="absolute inset-x-10 top-1/2 -translate-y-1/2 h-16 border-2 border-[#ff0066] rounded-xl pointer-events-none" />
            </div>
            <p className="text-center">Inquadra il <span className="font-semibold">codice a barre</span> del cartellino</p>
            {erroreCamera && <p className="text-amber-300 text-sm text-center">{erroreCamera}</p>}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (scritto.trim()) { aggiungi(scritto); setScritto('') } }}>
              <input value={scritto} onChange={(e) => { setScritto(e.target.value); tocca() }} inputMode="numeric" placeholder="oppure scrivi il numero"
                aria-label="Numero del codice a barre" className="flex-1 min-w-0 bg-transparent border border-white/30 rounded-xl px-3 py-2.5 text-white placeholder:text-white/40" />
              <button type="submit" className="shrink-0 px-4 rounded-xl bg-white/10">Aggiungi</button>
            </form>
            <button type="button" onClick={() => setFrontale((f) => !f)} className="flex items-center justify-center gap-1.5 text-white/50 text-sm underline">
              <Camera size={14} />Cambia fotocamera
            </button>
            {capi.length > 0 && (
              <div className="rounded-2xl border border-white/15 divide-y divide-white/10">
                <p className="px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white/50">Letti adesso · {capi.length}</p>
                {capi.map((c, i) => {
                  const vuoto = !c.prezzo.trim()
                  const sbagliato = !vuoto && leggiPrezzo(c.prezzo) == null
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2">
                      <span className="flex-1 font-mono text-sm break-all">{c.codice}</span>
                      <label className="flex flex-col items-end text-[10px] uppercase tracking-wide text-white/50">
                        <span className={(obbligatorio && vuoto) || sbagliato ? 'text-[#ff80b3]' : ''}>Prezzo outlet oggi</span>
                        <input value={c.prezzo} inputMode="decimal" placeholder={obbligatorio ? 'scrivi' : 'facoltativo'}
                          aria-label={`Prezzo outlet di ${c.codice}`}
                          onChange={(e) => { const v = e.target.value; setCapi((x) => x.map((y, j) => (j === i ? { ...y, prezzo: v } : y))) }}
                          className={`mt-0.5 w-24 text-right text-base normal-case tracking-normal bg-transparent rounded-lg px-2 py-1 border ${(obbligatorio && vuoto) || sbagliato ? 'border-[#ff0066]' : 'border-white/30'} text-white`} />
                      </label>
                      <button type="button" onClick={() => setCapi((x) => x.filter((_, j) => j !== i))} className="text-white/50 text-sm underline">togli</button>
                    </div>
                  )
                })}
              </div>
            )}
            {capi.length > 0 && <p className="text-sm text-white/50">Scrivi il prezzo outlet di oggi che leggi sul cartellino{obbligatorio ? ', per ogni capo' : ' (facoltativo)'}.</p>}
            {errore && <p className="text-amber-300 text-sm">{errore}</p>}
            <button type="button" disabled={!capi.length || mancano > 0 || fase.k === 'invio'} onClick={() => void conferma(fase.voce, fase.divisa)}
              className="w-full py-5 rounded-2xl text-2xl font-semibold bg-[#ff0066] active:bg-[#d90057] disabled:opacity-40">
              {fase.k === 'invio' ? 'Salvo…' : capi.length ? `Conferma ${capi.length} ${capi.length === 1 ? 'capo' : 'capi'}` : 'Leggi un cartellino'}
            </button>
            {mancano > 0 && <p className="text-center text-sm text-white/60">{mancano === 1 ? 'Manca il prezzo di 1 capo' : `Manca il prezzo di ${mancano} capi`}.</p>}
          </>
        )
      })()}

      {fase.k === 'fatto' && (
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 size={88} className="text-[#ff0066]" />
          <p className="text-3xl font-bold">Fatto, {primoNome}</p>
          <p className="text-white/70">{NOME_VOCE[fase.voce]}{fase.divisa ? <><br />Divisa {fase.divisa}{fase.pezzi ? `: ora ${fase.pezzi} ${fase.pezzi === 1 ? 'pezzo' : 'pezzi'}` : ''}</> : null}</p>
          <div className="w-full rounded-2xl bg-white/5 divide-y divide-white/10 text-left">
            {fase.capi.map((c, i) => (
              <div key={i} className="flex justify-between px-3 py-2 text-sm"><span className="font-mono">{c.codice}</span><span>{c.prezzo != null ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(c.prezzo) : '·'}</span></div>
            ))}
            <p className="px-3 py-1.5 text-xs text-white/50">prezzo outlet di oggi, scritto da te</p>
          </div>
          <p className="text-sm text-white/60">Va alla sede, che li scarica.</p>
          <button type="button" onClick={() => { setFase({ k: 'apertura' }); void apri() }} className="w-full py-4 rounded-2xl text-xl font-semibold bg-white/10 active:bg-white/20">Altri capi</button>
          <p className="text-xs text-white/40">Torna alla schermata iniziale fra 10 secondi</p>
        </div>
      )}
    </div>
  )
}
