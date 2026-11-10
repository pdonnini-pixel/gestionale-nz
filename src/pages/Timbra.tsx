// Timbratrice del negozio (/timbra): gira sul cellulare aziendale del negozio,
// collegato con l'account di cassa. Il dipendente avvicina il QR del suo
// telefono (pagina /app), la timbratrice lo legge e mostra UN pulsante grande
// con l'azione giusta (entra, pausa, rientro, esco).
//
// Funziona anche senza rete: persone e turni restano in memoria, ogni
// timbratura si salva prima sul telefono e parte da sola quando torna la rete.
// Regola fissa: chi timbra vede subito che e' fatto, e la pagina dice sempre
// se resta qualcosa da inviare.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Wifi, WifiOff, Camera, RefreshCw, AlertTriangle, Delete, KeyRound } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  CAUSALI_STRAORDINARIO, CAUSALI_USCITA, ETICHETTA_TIPO, MARGINE_USCITA_DEFAULT, TOLLERANZA_ENTRATA_DEFAULT,
  azioni, codicePin, dataRoma, entrataMancante, formatMinuti, leggiCodice, oraRoma, oraRomaInMs, oreEntrataDichiarabili, ordina, statoDa,
  valutaEntrata, valutaUscita,
  type TipoTimbratura, type Timbratura,
} from '../lib/timbrature'
import {
  chiediMemoriaPersistente, datiInMemoria, inCoda, inviaCoda, registraInCoda, scaricaDati, scartate,
  type DatiTimbratrice, type RigaCoda,
} from '../lib/timbratureCoda'
import { attivaOffline, schermoSempreAcceso } from '../lib/presenzeOffline'

// BarcodeDetector: Chrome per Android, non ancora nei tipi di TypeScript.
interface RilevatoreQr { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type CostruttoreRilevatore = new (o: { formats: string[] }) => RilevatoreQr
const Rilevatore = (globalThis as unknown as { BarcodeDetector?: CostruttoreRilevatore }).BarcodeDetector

const K_NEGOZIO = 'nz-timbra-negozio'

interface Selezione { employeeId: string; nome: string; codice: string; letto: number; pinDaControllare?: boolean }
interface Fatto { nome: string; tipo: TipoTimbratura; ora: string; nota?: string }
/** Timbratura con il PIN (migration 384): prima il nome, poi le 4 cifre. */
type StatoPin = { fase: 'nomi' } | { fase: 'cifre'; employeeId: string; nome: string; cifre: string; errore?: string; controllo?: boolean }

/** Timbratura di oggi; dichiarata = entrata segnata a posteriori, da confermare (migration 382). */
type TimbraturaOggi = Timbratura & { dichiarata?: boolean }
interface UscitaDaConfermare { tipo: 'anticipata' | 'straordinario'; minuti: number; proposti: number; fine: string }

const ETICHETTA_PULSANTE: Record<TipoTimbratura, string> = {
  entrata: 'Entra',
  inizio_pausa: 'Vado in pausa',
  fine_pausa: 'Rientro dalla pausa',
  uscita: 'Esco',
}


export default function Timbra() {
  const navigate = useNavigate()
  const [sessione, setSessione] = useState<'?' | 'si' | 'no'>('?')
  const [negozi, setNegozi] = useState<{ outlet_id: string; nome: string }[] | null>(null)
  const [outletId, setOutletId] = useState<string>(() => localStorage.getItem(K_NEGOZIO) ?? '')
  const [dati, setDati] = useState<DatiTimbratrice | null>(null)
  const [coda, setCoda] = useState<RigaCoda[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [ultimoInvio, setUltimoInvio] = useState<string | null>(null)
  const [adesso, setAdesso] = useState(Date.now())
  const [selezione, setSelezione] = useState<Selezione | null>(null)
  const [fatto, setFatto] = useState<Fatto | null>(null)
  const [uscita, setUscita] = useState<UscitaDaConfermare | null>(null)
  const [causale, setCausale] = useState<string | null>(null)
  // Entrata dimenticata: ora scelta e «No, entro adesso»
  const [oraDichiarata, setOraDichiarata] = useState<string | null>(null)
  const [entroAdesso, setEntroAdesso] = useState(false)
  const [segnata, setSegnata] = useState<string | null>(null)
  const [pin, setPin] = useState<StatoPin | null>(null)
  const pinCorrente = useRef<string | null>(null)
  useEffect(() => { pinCorrente.current = pin?.fase === 'cifre' ? pin.employeeId : null }, [pin])
  const [avviso, setAvviso] = useState<string | null>(null)
  const [frontale, setFrontale] = useState(true)
  const [erroreCamera, setErroreCamera] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const ultimoCodice = useRef<{ id: string; t: number } | null>(null)
  const occupato = useRef(false)
  const nomiRef = useRef<Map<string, string>>(new Map())

  useEffect(() => attivaOffline('/timbra', '/timbra.webmanifest'), [])
  useEffect(() => schermoSempreAcceso(), [])
  useEffect(() => { void chiediMemoriaPersistente() }, [])
  useEffect(() => { const t = setInterval(() => setAdesso(Date.now()), 1000); return () => clearInterval(t) }, [])

  // Sessione salvata sul telefono. Offline il rinnovo del token fallisce e
  // getSession() risponde null anche se l'accesso c'e': se il telefono ha gia'
  // un negozio scelto e una sessione salvata, si lavora dalla coda.
  useEffect(() => {
    const salvata = Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k))
    const negozioScelto = !!localStorage.getItem(K_NEGOZIO)
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (data.session) setSessione('si')
        else setSessione(negozioScelto && salvata && (!navigator.onLine || !!error) ? 'si' : 'no')
      })
      .catch(() => setSessione(negozioScelto && salvata ? 'si' : 'no'))
  }, [])

  // Negozi in cui si puo' timbrare (online); offline resta quello scelto
  useEffect(() => {
    if (sessione !== 'si') return
    supabase.rpc('timbratrice_negozi').then(({ data, error }) => {
      if (error) { setNegozi(outletId ? [] : null); return }
      const lista = (data ?? []) as { outlet_id: string; nome: string }[]
      setNegozi(lista)
      if (lista.length === 1) { setOutletId(lista[0].outlet_id); localStorage.setItem(K_NEGOZIO, lista[0].outlet_id) }
      else if (outletId && lista.length && !lista.some((n) => n.outlet_id === outletId)) setOutletId('')
    })
  }, [sessione]) // eslint-disable-line react-hooks/exhaustive-deps

  const aggiornaCoda = useCallback(async () => setCoda(await inCoda()), [])

  const sincronizza = useCallback(async () => {
    if (!outletId) return
    if (navigator.onLine) {
      const esito = await inviaCoda()
      if (esito.inviate > 0 || esito.inAttesa === 0) setUltimoInvio(new Date().toISOString())
      const nuovi = await scaricaDati(outletId)
      if (nuovi) setDati(nuovi)
    }
    await aggiornaCoda()
  }, [outletId, aggiornaCoda])

  useEffect(() => {
    if (!outletId) return
    setDati(datiInMemoria(outletId))
    void sincronizza()
    const ogniMinuto = setInterval(() => void sincronizza(), 60_000)
    const suOnline = () => { setOnline(true); void sincronizza() }
    const suOffline = () => setOnline(false)
    const suVisibile = () => { if (document.visibilityState === 'visible') void sincronizza() }
    window.addEventListener('online', suOnline)
    window.addEventListener('offline', suOffline)
    document.addEventListener('visibilitychange', suVisibile)
    return () => {
      clearInterval(ogniMinuto)
      window.removeEventListener('online', suOnline)
      window.removeEventListener('offline', suOffline)
      document.removeEventListener('visibilitychange', suVisibile)
    }
  }, [outletId, sincronizza])

  const oggi = dataRoma(adesso)
  const nomi = useMemo(() => new Map((dati?.persone ?? []).map((p) => [p.id, p.nome])), [dati])
  // La fotocamera legge i nomi da qui: cosi' l'aggiornamento di ogni minuto non la riapre
  useEffect(() => { nomiRef.current = nomi }, [nomi])

  // Timbrature di oggi: quelle del server piu' quelle ancora in coda
  const timbratureOggi = useMemo(() => {
    const m = new Map<string, TimbraturaOggi[]>()
    const visti = new Set<string>()
    const metti = (id: string, emp: string, t: TimbraturaOggi) => {
      if (visti.has(id) || dataRoma(Date.parse(t.ora)) !== oggi) return
      visti.add(id)
      m.set(emp, [...(m.get(emp) ?? []), t])
    }
    for (const t of dati?.timbrature ?? []) metti(t.id, t.employee_id, { tipo: t.tipo, ora: t.ora, dichiarata: t.dichiarata })
    for (const c of coda) metti(c.id, c.employee_id, { tipo: c.tipo, ora: c.ora_dichiarata ?? c.ora_dispositivo, dichiarata: !!c.ora_dichiarata })
    return m
  }, [dati, coda, oggi])

  // Con il turno spezzato vale l'intera giornata: dal primo inizio all'ultima fine
  const turnoDi = useCallback((empId: string) => {
    const del = (dati?.turni ?? []).filter((t) => t.employee_id === empId && t.data === oggi)
      .sort((a, b) => a.inizio.localeCompare(b.inizio))
    if (!del.length) return null
    return { ...del[del.length - 1], inizio: del[0].inizio, pausa_minuti: del.reduce((s, t) => s + (t.pausa_minuti ?? 0), 0) }
  }, [dati, oggi])

  // Lettura del QR con la fotocamera
  useEffect(() => {
    if (!outletId || selezione || fatto || pin) return
    if (!Rilevatore) { setErroreCamera('Questo telefono non legge i QR dal browser. Usa Chrome aggiornato.'); return }
    let fermo = false
    let stream: MediaStream | null = null
    const rilevatore = new Rilevatore({ formats: ['qr_code'] })
    navigator.mediaDevices.getUserMedia({ video: { facingMode: frontale ? 'user' : 'environment' }, audio: false })
      .then((s) => {
        stream = s
        if (fermo) { s.getTracks().forEach((t) => t.stop()); return }
        setErroreCamera(null)
        // Il riquadro video puo' comparire dopo la fotocamera (permesso gia'
        // dato, dati del negozio ancora in arrivo): si aggancia a ogni giro.
        const giro = async () => {
          if (fermo) return
          const v = videoRef.current
          if (!v) { setTimeout(giro, 250); return }
          if (v.srcObject !== s) { v.srcObject = s; void v.play().catch(() => undefined) }
          try {
            const letti = v.readyState >= 2 ? await rilevatore.detect(v) : []
            for (const l of letti) {
              const c = leggiCodice(l.rawValue)
              if (!c) { setAvviso('Questo QR non è un codice presenze.'); continue }
              const u = ultimoCodice.current
              if (u && u.id === c.employeeId && Date.now() - u.t < 8000) continue
              setAvviso(null)
              setSelezione({ employeeId: c.employeeId, nome: nomiRef.current.get(c.employeeId) ?? 'Persona non in elenco', codice: l.rawValue, letto: Date.now() })
              return
            }
          } catch { /* fotogramma non leggibile */ }
          setTimeout(giro, 250)
        }
        void giro()
      })
      .catch(() => setErroreCamera('Serve il permesso per la fotocamera: toccalo nella barra degli indirizzi e consenti.'))
    return () => { fermo = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [outletId, selezione, fatto, frontale, !!pin])

  // La scheda della persona si chiude da sola dopo 20 secondi
  useEffect(() => {
    if (!selezione) { setUscita(null); setCausale(null); setOraDichiarata(null); setEntroAdesso(false); setSegnata(null); return }
    // Ogni tocco (scelta del motivo o dell'ora) rida' 20 secondi
    const t = setTimeout(() => setSelezione(null), 20_000)
    return () => clearTimeout(t)
  }, [selezione, uscita, causale, oraDichiarata, entroAdesso])
  // La schermata del PIN si chiude da sola dopo 30 secondi senza tocchi
  useEffect(() => {
    if (!pin) return
    const t = setTimeout(() => setPin(null), 30_000)
    return () => clearTimeout(t)
  }, [pin])
  useEffect(() => {
    if (!fatto) return
    const t = setTimeout(() => setFatto(null), 3500)
    return () => clearTimeout(t)
  }, [fatto])

  const timbra = async (tipo: TipoTimbratura, opzioni?: { causale?: string; nota?: string; oraDichiarata?: string }) => {
    // Un solo tocco conta: il secondo, mentre si salva, si ignora
    if (!selezione || !outletId || occupato.current) return
    occupato.current = true
    const sel = selezione
    setSelezione(null)
    try {
      const riga = await registraInCoda({
        outletId, codice: sel.codice, tipo, employeeId: sel.employeeId, nome: sel.nome,
        causale: opzioni?.causale, oraDichiarata: opzioni?.oraDichiarata,
      })
      if (riga.ora_dichiarata) {
        // Entrata dimenticata: la scheda resta aperta per pausa o uscita
        await aggiornaCoda()
        setSelezione({ ...sel, letto: Date.now() })
        setSegnata(oraRoma(riga.ora_dichiarata))
        void sincronizza()
        return
      }
      ultimoCodice.current = { id: sel.employeeId, t: Date.now() }
      const notaPin = sel.pinDaControllare ? 'Senza rete: il PIN si controlla quando torna la rete.' : ''
      setFatto({ nome: sel.nome, tipo, ora: riga.ora_dispositivo, nota: [opzioni?.nota, notaPin].filter(Boolean).join(' ') || undefined })
      await aggiornaCoda()
      void sincronizza()
    } catch {
      setAvviso('Timbratura NON salvata: riprova.')
    } finally {
      occupato.current = false
    }
  }

  // PIN: alla quarta cifra si controlla subito (con la rete); senza rete si va
  // avanti e il PIN lo controlla il server all'invio, come la firma del QR.
  const cifraPin = async (c: string) => {
    if (!pin || pin.fase !== 'cifre' || pin.controllo) return
    const cifre = c === 'canc' ? pin.cifre.slice(0, -1) : (pin.cifre + c).slice(0, 4)
    if (cifre.length < 4) { setPin({ ...pin, cifre, errore: undefined }); return }
    const scelto = { employeeId: pin.employeeId, nome: pin.nome, codice: codicePin(pin.employeeId, cifre), letto: Date.now() }
    if (!navigator.onLine) { setPin(null); setSelezione({ ...scelto, pinDaControllare: true }); return }
    setPin({ ...pin, cifre, controllo: true, errore: undefined })
    const { data, error } = await supabase.rpc('timbratrice_verifica_pin', { p_outlet_id: outletId, p_employee: pin.employeeId, p_pin: cifre })
    // Risposta arrivata dopo che la schermata e' cambiata: non vale piu'
    if (pinCorrente.current !== pin.employeeId) return
    if (error) { setPin(null); setSelezione({ ...scelto, pinDaControllare: true }); return } // rete instabile: controlla il server all'invio
    if (data === 'ok') { setPin(null); setSelezione(scelto); return }
    setPin({
      ...pin, cifre: '', controllo: false,
      errore: data === 'pin_bloccato' ? 'PIN bloccato dopo 5 tentativi sbagliati: chiedi un PIN nuovo a chi segue il personale.'
        : data === 'pin_non_attivo' ? 'Per te non c\'è un PIN attivo: chiedilo a chi segue il personale.'
        : data === 'pin_altro_negozio' ? 'Con il PIN si timbra solo nel proprio negozio: avvisa il responsabile.'
        : 'PIN sbagliato, riprova.',
    })
  }

  // ─── Schermate ───────────────────────────────────────────────────────
  const guscio = (contenuto: React.ReactNode) => (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center gap-4">{contenuto}</div>
  )

  if (sessione === '?') return guscio(<RefreshCw className="animate-spin" />)
  if (sessione === 'no') return guscio(<>
    <p className="text-2xl font-semibold">Questo telefono non è collegato</p>
    <p className="text-slate-300">Accedi una volta con l'account di cassa del negozio. Poi la timbratrice resta pronta, anche senza rete.</p>
    <button onClick={() => navigate('/login', { state: { from: '/timbra' } })} className="mt-2 px-6 py-3 rounded-xl bg-blue-600 text-lg font-semibold">Accedi</button>
  </>)
  if (!outletId && negozi && negozi.length === 0) return guscio(<>
    <p className="text-2xl font-semibold">Timbrature non attive</p>
    <p className="text-slate-300">Le timbrature non sono ancora accese per questo negozio. Chi segue il personale le accende in Dipendenti → Presenze.</p>
  </>)
  if (!outletId && negozi && negozi.length > 1) return guscio(<>
    <p className="text-2xl font-semibold">In quale negozio è questo telefono?</p>
    <div className="flex flex-col gap-2 w-full max-w-sm">
      {negozi.map((n) => (
        <button key={n.outlet_id} onClick={() => { setOutletId(n.outlet_id); localStorage.setItem(K_NEGOZIO, n.outlet_id) }}
          className="px-4 py-3 rounded-xl bg-slate-700 text-lg">{n.nome}</button>
      ))}
    </div>
  </>)
  if (!outletId) return guscio(<RefreshCw className="animate-spin" />)

  const scartateOra = scartate().filter((s) => s.outlet_id === outletId)
  const conPin = (dati?.persone ?? []).filter((p) => p.pin)
  const dentro = [...timbratureOggi.entries()]
    .map(([emp, ts]) => ({ emp, stato: statoDa(ordina(ts).at(-1)?.tipo) }))
    .filter((x) => x.stato !== 'fuori')

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Testata: negozio, ora, stato dell'invio */}
      <header className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-slate-400 text-sm">{dati?.outlet.nome ?? 'Negozio'}</p>
          <p className="text-5xl font-bold tabular-nums leading-none mt-1">{oraRoma(adesso)}</p>
          <p className="text-slate-400 text-sm mt-1">{new Date(adesso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${online ? 'bg-emerald-900 text-emerald-200' : 'bg-amber-900 text-amber-200'}`}>
          {online ? <Wifi size={14} /> : <WifiOff size={14} />}{online ? 'In rete' : 'Senza rete'}
        </div>
      </header>

      <div className="px-5">
        {coda.length === 0
          ? <p className="text-sm text-emerald-300">Tutte le timbrature sono inviate{ultimoInvio ? ` (ultimo invio ${oraRoma(ultimoInvio)})` : ''}.</p>
          : <p className="text-sm text-amber-300">{coda.length === 1 ? '1 timbratura in attesa' : `${coda.length} timbrature in attesa`}: {online ? 'invio in corso.' : 'partono da sole appena torna la rete.'}</p>}
        {scartateOra.length > 0 && (
          <p className="text-sm text-rose-300 mt-1 flex items-center gap-1"><AlertTriangle size={14} />{scartateOra.length === 1 ? '1 timbratura rifiutata' : `${scartateOra.length} timbrature rifiutate`} (QR o PIN non riconosciuto, PIN bloccato o persona non in servizio): avvisa chi segue il personale.</p>
        )}
      </div>

      <main className="flex-1 flex flex-col items-center justify-center px-5 py-4">
        {pin && !fatto && !selezione ? (
          pin.fase === 'nomi' ? (
            <div className="w-full max-w-md flex flex-col gap-3">
              <p className="text-2xl font-bold text-center">Chi sei?</p>
              <div className="grid grid-cols-2 gap-2">
                {conPin.map((p) => (
                  <button key={p.id} onClick={() => setPin({ fase: 'cifre', employeeId: p.id, nome: p.nome, cifre: '' })}
                    className="py-4 px-3 rounded-2xl bg-slate-700 active:bg-slate-600 text-lg font-semibold">{p.nome}</button>
                ))}
              </div>
              <button onClick={() => setPin(null)} className="text-slate-400 underline py-2">Annulla</button>
            </div>
          ) : (
            <div className="w-full max-w-xs flex flex-col items-center gap-4">
              <p className="text-2xl font-bold text-center">{pin.nome}</p>
              <p className="text-slate-300">Scrivi il tuo PIN</p>
              <div className="flex gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={`w-4 h-4 rounded-full ${i < pin.cifre.length ? 'bg-white' : 'border-2 border-slate-500'}`} />
                ))}
              </div>
              {pin.errore && <p className="text-rose-300 text-center text-sm">{pin.errore}</p>}
              {pin.controllo && <RefreshCw className="animate-spin text-slate-400" size={18} />}
              <div className="grid grid-cols-3 gap-3 w-full">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'canc'].map((c) => c === '' ? <span key="vuoto" /> : (
                  <button key={c} onClick={() => void cifraPin(c)} disabled={pin.controllo}
                    aria-label={c === 'canc' ? 'Cancella' : c}
                    className="h-16 rounded-2xl bg-slate-700 active:bg-slate-600 text-3xl font-bold flex items-center justify-center disabled:opacity-40">
                    {c === 'canc' ? <Delete size={26} /> : c}
                  </button>
                ))}
              </div>
              <button onClick={() => setPin({ fase: 'nomi' })} disabled={pin.controllo} className="text-slate-400 underline py-1 disabled:opacity-40">Non sono io</button>
            </div>
          )
        ) : fatto ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 size={96} className="text-emerald-400" />
            <p className="text-3xl font-bold">{ETICHETTA_TIPO[fatto.tipo]} registrata</p>
            <p className="text-xl text-slate-300">{fatto.nome}, alle {oraRoma(fatto.ora)}</p>
            {fatto.nota && <p className="text-base text-amber-200 max-w-sm">{fatto.nota}</p>}
          </div>
        ) : selezione ? (
          (() => {
            const ts = timbratureOggi.get(selezione.employeeId) ?? []
            const turno = turnoDi(selezione.employeeId)
            const { principale, altre } = azioni(ts, turno, adesso)
            const persona = dati?.persone.find((p) => p.id === selezione.employeeId)
            const tolleranza = persona?.tolleranza ?? TOLLERANZA_ENTRATA_DEFAULT
            const margine = persona?.margine ?? dati?.margine_uscita_minuti ?? MARGINE_USCITA_DEFAULT
            const stato = statoDa(ordina(ts).at(-1)?.tipo)
            const entrata = principale === 'entrata' && turno && !ts.some((t) => t.tipo === 'entrata') ? valutaEntrata(turno, adesso, tolleranza) : null
            const altroTurnoDopo = (dati?.turni ?? []).some((t) => t.employee_id === selezione.employeeId && t.data === oggi && oraRomaInMs(oggi, t.inizio) > adesso)
            const tocchi = [principale, ...altre]
            const mancante = stato === 'fuori' && !entroAdesso && entrataMancante(turno, ts, adesso, tolleranza)
            const esci = () => {
              // Senza turno, o con turno a cavallo della mezzanotte, il server non crea eventi: niente domande
              if (!turno || turno.fine <= turno.inizio) { void timbra('uscita'); return }
              const v = valutaUscita(turno, adesso, margine, altroTurnoDopo)
              if (v.tipo === 'normale') { void timbra('uscita'); return }
              setUscita({ tipo: v.tipo, minuti: v.minuti, proposti: v.proposti, fine: turno.fine.slice(0, 5) }); setCausale(null)
            }
            const entra = () => void timbra('entrata', entrata?.oltre
              ? { nota: `${entrata.minuti} minuti di ritardo: ${formatMinuti(entrata.permesso)} di permesso, da confermare.` }
              : undefined)

            if (mancante && turno) {
              const ore = oreEntrataDichiarabili(turno, adesso)
              const proposta = turno.inizio.slice(0, 5)
              const scelta = oraDichiarata ?? (ore.includes(proposta) ? proposta : ore[0])
              const segna = () => void timbra('entrata', { oraDichiarata: new Date(oraRomaInMs(oggi, scelta)).toISOString() })
              return (
                <div className="w-full max-w-md flex flex-col gap-3">
                  <div className="text-center">
                    <p className="text-3xl font-bold">{selezione.nome}</p>
                    <p className="text-slate-300 mt-1">Turno di oggi {turno.inizio.slice(0, 5)} - {turno.fine.slice(0, 5)}</p>
                  </div>
                  <div className="rounded-2xl p-4 border bg-amber-950/60 border-amber-600 text-amber-200">
                    <p className="text-lg font-bold">Non risulta la tua entrata di oggi.</p>
                    <p className="text-sm mt-1">Se eri già in negozio, scegli l'ora a cui sei entrato: la conferma il responsabile.</p>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-600 px-4 py-3">
                    <span className="text-lg text-slate-300">Ero già entrato alle</span>
                    <select value={scelta} onChange={(e) => setOraDichiarata(e.target.value)}
                      className="bg-slate-800 text-white text-2xl font-bold tabular-nums rounded-xl px-3 py-2 border border-slate-500">
                      {ore.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <button onClick={segna} className="w-full py-6 rounded-2xl text-2xl font-bold bg-emerald-600 active:bg-emerald-700">
                    Segna l'entrata delle {scelta}
                  </button>
                  <button onClick={() => setEntroAdesso(true)} className="w-full py-4 rounded-2xl text-xl font-semibold bg-slate-700 active:bg-slate-600">
                    No, entro adesso
                  </button>
                  <button onClick={() => setSelezione(null)} className="text-slate-400 underline py-1">Annulla</button>
                </div>
              )
            }

            if (uscita) {
              const anticipata = uscita.tipo === 'anticipata'
              const voci = Object.entries(anticipata ? CAUSALI_USCITA : CAUSALI_STRAORDINARIO)
              const conferma = () => {
                if (!causale) return
                const etichetta = (anticipata ? CAUSALI_USCITA : CAUSALI_STRAORDINARIO)[causale as never] as string
                void timbra('uscita', {
                  causale,
                  nota: anticipata
                    ? `${etichetta}. ${causale === 'personale' ? 'Se vuoi, scrivi il motivo nell\'app sul tuo telefono.' : ''}`.trim()
                    : `Straordinario ${formatMinuti(uscita.proposti)} · ${etichetta}, da confermare.`,
                })
              }
              return (
                <div className="w-full max-w-md flex flex-col gap-3">
                  <p className="text-3xl font-bold text-center">{selezione.nome}</p>
                  <div className={`rounded-2xl p-4 border ${anticipata ? 'bg-rose-950/60 border-rose-700 text-rose-200' : 'bg-emerald-950/60 border-emerald-700 text-emerald-200'}`}>
                    <p className="text-lg font-bold">
                      {anticipata ? `Esci ${formatMinuti(uscita.minuti)} prima della fine del turno` : `Esci ${formatMinuti(uscita.minuti)} dopo il turno`}
                    </p>
                    <p className="text-sm mt-1">
                      {anticipata ? `Il turno finisce alle ${uscita.fine}. Perché esci?` : `Oltre i ${margine} minuti di margine: ${formatMinuti(uscita.proposti)} di straordinario. Perché?`}
                    </p>
                  </div>
                  {voci.map(([k, etichetta]) => (
                    <button key={k} onClick={() => setCausale(k)}
                      className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-lg ${causale === k ? 'border-[#ff0066] bg-[#ff0066]/15' : 'border-slate-600'}`}>
                      <span className={`w-5 h-5 rounded-full shrink-0 ${causale === k ? 'border-[6px] border-[#ff0066]' : 'border-2 border-slate-400'}`} />
                      {etichetta}
                    </button>
                  ))}
                  {anticipata && <p className="text-slate-400 text-sm">Il motivo lo scrivi nell'app sul tuo telefono: qui non lo legge nessuno.</p>}
                  <button onClick={conferma} disabled={!causale}
                    className={`w-full py-6 rounded-2xl text-2xl font-bold disabled:opacity-40 ${anticipata ? 'bg-rose-600 active:bg-rose-700' : 'bg-emerald-600 active:bg-emerald-700'}`}>
                    Conferma l'uscita
                  </button>
                  <button onClick={() => { setUscita(null); setCausale(null) }} className="text-slate-400 underline py-1">Indietro</button>
                </div>
              )
            }

            return (
              <div className="w-full max-w-md flex flex-col gap-4">
                <div className="text-center">
                  <p className="text-3xl font-bold">{selezione.nome}</p>
                  <p className="text-slate-300 mt-1">{turno ? `Turno di oggi ${turno.inizio.slice(0, 5)} - ${turno.fine.slice(0, 5)}` : 'Nessun turno oggi'}</p>
                  {ts.length > 0 && <p className="text-slate-400 text-sm mt-1">{ordina(ts).map((t) => `${ETICHETTA_TIPO[t.tipo]} ${oraRoma(t.ora)}${t.dichiarata ? ' (segnata, da confermare)' : ''}`).join(' · ')}</p>}
                </div>
                {segnata && (
                  <p className="text-center text-emerald-300 text-sm">Entrata delle {segnata} segnata: la conferma il responsabile.</p>
                )}
                {entrata && entrata.minuti > 0 && (
                  entrata.oltre ? (
                    <div className="rounded-2xl p-4 border bg-amber-950/60 border-amber-600 text-amber-200">
                      <p className="text-lg font-bold">{entrata.minuti} minuti di ritardo</p>
                      <p className="text-sm mt-1">Oltre i {tolleranza} minuti di tolleranza: {formatMinuti(entrata.permesso)} di permesso, da confermare.</p>
                    </div>
                  ) : <p className="text-center text-sm text-slate-300">{entrata.minuti} minuti dopo l'inizio, entro la tolleranza.</p>
                )}
                {stato === 'fuori' ? (
                  <button onClick={entra} className="w-full py-8 rounded-2xl text-3xl font-bold bg-emerald-600 active:bg-emerald-700">Entra</button>
                ) : (
                  <>
                    {stato === 'in_pausa' && (
                      <button onClick={() => void timbra('fine_pausa')} className="w-full py-7 rounded-2xl text-2xl font-bold bg-sky-600 active:bg-sky-700">{ETICHETTA_PULSANTE.fine_pausa}</button>
                    )}
                    {stato === 'dentro' && tocchi.includes('inizio_pausa') && (
                      <button onClick={() => void timbra('inizio_pausa')} className="w-full py-7 rounded-2xl text-2xl font-bold bg-amber-500 active:bg-amber-600">{ETICHETTA_PULSANTE.inizio_pausa}</button>
                    )}
                    <button onClick={esci} className="w-full py-7 rounded-2xl text-2xl font-bold bg-rose-600 active:bg-rose-700">{ETICHETTA_PULSANTE.uscita}</button>
                  </>
                )}
                <button onClick={() => setSelezione(null)} className="text-slate-400 underline py-2">Annulla</button>
              </div>
            )
          })()
        ) : (
          <div className="w-full max-w-md flex flex-col items-center gap-3">
            <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black">
              <video ref={videoRef} playsInline muted className={`w-full h-full object-cover ${frontale ? '-scale-x-100' : ''}`} />
              <div className="absolute inset-10 border-4 border-white/70 rounded-2xl pointer-events-none" />
            </div>
            <p className="text-xl font-semibold">Avvicina il QR del tuo telefono</p>
            {avviso && <p className="text-amber-300 text-sm">{avviso}</p>}
            {erroreCamera && <p className="text-rose-300 text-sm">{erroreCamera}</p>}
            <button onClick={() => setFrontale((f) => !f)} className="flex items-center gap-1.5 text-slate-400 text-sm underline">
              <Camera size={14} />Cambia fotocamera
            </button>
            {conPin.length > 0 && (
              <button onClick={() => setPin({ fase: 'nomi' })} className="mt-2 w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-slate-600 text-lg">
                <KeyRound size={18} />Non ho lo smartphone: timbro con il PIN
              </button>
            )}
          </div>
        )}
      </main>

      {/* Chi c'e' adesso */}
      <footer className="px-5 pb-6">
        <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Adesso in negozio</p>
        {dentro.length === 0
          ? <p className="text-slate-500 text-sm">Nessuno ha timbrato l'entrata.</p>
          : <div className="flex flex-wrap gap-2">
              {dentro.map((d) => (
                <span key={d.emp} className={`px-3 py-1 rounded-full text-sm ${d.stato === 'in_pausa' ? 'bg-amber-900 text-amber-100' : 'bg-emerald-900 text-emerald-100'}`}>
                  {nomi.get(d.emp) ?? 'Collega'}{d.stato === 'in_pausa' ? ' (in pausa)' : ''}
                </span>
              ))}
            </div>}
        {dati?.scaricati_il && <p className="text-slate-600 text-xs mt-3">Elenco e turni aggiornati alle {oraRoma(dati.scaricati_il)}</p>}
      </footer>
    </div>
  )
}
