// App del dipendente (/app): sul telefono personale. Mostra il QR che cambia
// ogni 30 secondi (si calcola anche senza rete), il turno di oggi e dei
// prossimi giorni, le timbrature di oggi. Se un'uscita non risulta, la si
// segna da qui (resta da confermare per chi segue il personale).
//
// Prima volta: si attiva con il codice di 8 caratteri dato dall'HR
// (Dipendenti → Presenze → Accessi). Niente password da ricordare.

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { CalendarDays, Clock, Palmtree, QrCode, RefreshCw, WifiOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getCurrentTenant } from '../lib/tenants'
import LogoNewZago from '../components/app/LogoNewZago'
// Poppins, il carattere dei negozi: incluso nell'app, funziona anche senza rete
import '@fontsource/poppins/latin-300.css'
import '@fontsource/poppins/latin-400.css'
import '@fontsource/poppins/latin-500.css'
import '@fontsource/poppins/latin-600.css'
import '@fontsource/poppins/latin-700.css'

const CARATTERE = { fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }
import {
  ETICHETTA_ESITO, ETICHETTA_TIPO, codiceQr, dataRoma, formatMinuti, oraRoma, ordina, riepilogoGiorno, secondiAlCambio,
  PASSO_SECONDI, type Timbratura, type TipoTimbratura,
} from '../lib/timbrature'
import { attivaOffline } from '../lib/presenzeOffline'
import { attivaNotifiche, eAppNativa, type EsitoNotifiche } from '../lib/pushNativo'

// Le schede si caricano quando servono (la prima apertura resta leggera)
const AppTurni = lazy(() => import('../components/app/AppTurni'))
const AppFerie = lazy(() => import('../components/app/AppFerie'))
const AppOre = lazy(() => import('../components/app/AppOre'))

type Scheda = 'oggi' | 'turni' | 'ferie' | 'ore'
const SCHEDE: { k: Scheda; label: string; Icona: typeof QrCode }[] = [
  { k: 'oggi', label: 'Oggi', Icona: QrCode },
  { k: 'turni', label: 'Turni', Icona: CalendarDays },
  { k: 'ferie', label: 'Ferie', Icona: Palmtree },
  { k: 'ore', label: 'Ore', Icona: Clock },
]

const K_APP = 'nz-app-dipendente'
const K_OGGI = 'nz-app-oggi'

interface Attivazione { segreto: string; employee_id: string; nome: string }
interface DatiOggi {
  ora_server: string
  persona: { id: string; nome: string; negozio: string | null }
  turni: { data: string; inizio: string; fine: string; pausa_minuti: number | null; negozio: string | null }[]
  timbrature: { tipo: TipoTimbratura; ora: string; origine: string }[]
  scaricati_il?: string
}

function leggi<T>(k: string): T | null {
  try { const s = localStorage.getItem(k); return s ? JSON.parse(s) as T : null } catch { return null }
}

/** Logo in testa all'app: il disegno per New Zago, il nome in testo per gli altri. */
function Marchio({ grande }: { grande?: boolean }) {
  const nome = marchioApp()
  if (nome === 'New Zago') return <LogoNewZago className={`${grande ? 'h-7' : 'h-3.5'} w-auto text-black`} />
  return <p className={`${grande ? 'text-3xl' : 'text-sm'} font-light tracking-[0.2em] uppercase text-black`}>{nome}</p>
}

/** Nome dell'azienda: New Zago nell'app degli store e sul sito NZ. */
function marchioApp(): string {
  try {
    const a = getCurrentTenant().alias
    return a === 'zago' ? 'Zago' : a === 'made-retail' ? 'Made' : 'New Zago'
  } catch { return 'Presenze' }
}

export default function AppDipendente() {
  const [params] = useSearchParams()
  const [attivazione, setAttivazione] = useState<Attivazione | null>(() => leggi<Attivazione>(K_APP))
  const [codice, setCodice] = useState(params.get('codice') ?? '')
  const [errore, setErrore] = useState<string | null>(null)
  const [occupato, setOccupato] = useState(false)
  const [altroUtente, setAltroUtente] = useState(false)

  useEffect(() => attivaOffline('/app', '/app.webmanifest'), [])

  // Un telefono gia' collegato al gestionale con un altro utente (per esempio
  // chi lavora in ufficio che prova il link): non si sovrascrive la sessione.
  useEffect(() => {
    if (attivazione) return
    supabase.auth.getSession().then(({ data }) => {
      const ruolo = (data.session?.user.app_metadata as { role?: string } | undefined)?.role
      setAltroUtente(!!data.session && ruolo !== 'dipendente')
    })
  }, [attivazione])

  const attiva = async () => {
    setErrore(null); setOccupato(true)
    try {
      const { data, error } = await supabase.functions.invoke('app-dipendente-attiva', { body: { codice } })
      const r = data as { token_hash?: string; segreto?: string; employee_id?: string; nome?: string; error?: string } | null
      if (error || !r?.token_hash || !r.segreto || !r.employee_id) {
        let msg = r?.error
        const ctx = (error as { context?: Response } | null)?.context
        if (!msg && ctx && typeof ctx.json === 'function') {
          try { msg = ((await ctx.json()) as { error?: string }).error } catch { /* risposta non leggibile */ }
        }
        setErrore(msg ?? 'Attivazione non riuscita. Controlla la rete e il codice.')
        return
      }
      const { error: otpErr } = await supabase.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' })
      if (otpErr) { setErrore('Accesso non riuscito. Chiedi un codice nuovo.'); return }
      const a: Attivazione = { segreto: r.segreto, employee_id: r.employee_id, nome: r.nome ?? '' }
      localStorage.setItem(K_APP, JSON.stringify(a))
      setAttivazione(a)
    } finally {
      setOccupato(false)
    }
  }

  if (!attivazione) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 gap-4 text-center" style={CARATTERE}>
        <div>
          <div className="flex justify-center"><Marchio grande /></div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500 mt-3">Presenze</p>
        </div>
        {altroUtente ? (
          <p className="text-slate-600 max-w-sm">Questo dispositivo è già collegato al gestionale con un altro utente. Apri il link dal tuo telefono personale.</p>
        ) : (
          <>
            <p className="text-slate-600 max-w-sm">Scrivi il codice di 8 caratteri che ti ha dato chi segue il personale. Serve solo la prima volta.</p>
            <input value={codice} onChange={(e) => setCodice(e.target.value.toUpperCase())} maxLength={9} autoCapitalize="characters"
              autoComplete="one-time-code" placeholder="ABCD2345"
              className="w-56 text-center text-2xl tracking-widest font-mono border-2 border-slate-300 rounded-xl py-3 focus:border-black outline-none" />
            {errore && <p className="text-rose-600 text-sm max-w-sm">{errore}</p>}
            <button onClick={() => void attiva()} disabled={occupato || codice.replace(/[\s-]/g, '').length !== 8}
              className="px-8 py-3 rounded-xl bg-[#ff0066] text-white text-lg font-semibold disabled:opacity-40">
              {occupato ? 'Attivo…' : 'Attiva'}
            </button>
            <p className="text-xs text-slate-400 max-w-sm mt-4">
              L'app registra solo le tue timbrature (ora e negozio) e mostra i tuoi turni. Non usa la posizione, la fotocamera né altri dati del tuo telefono. Se lo consenti, ti avvisa con una notifica quando non risulta la tua entrata o la tua uscita. L'informativa completa te la consegna l'azienda.
            </p>
          </>
        )}
      </div>
    )
  }
  return <Principale attivazione={attivazione} />
}

function Principale({ attivazione }: { attivazione: Attivazione }) {
  const [adesso, setAdesso] = useState(Date.now())
  const [qr, setQr] = useState<string | null>(null)
  const [dati, setDati] = useState<DatiOggi | null>(() => leggi<DatiOggi>(K_OGGI))
  const [online, setOnline] = useState(navigator.onLine)
  const [oraUscita, setOraUscita] = useState('')
  const [messaggio, setMessaggio] = useState<{ ok: boolean; testo: string } | null>(null)
  const [scheda, setScheda] = useState<Scheda>('oggi')
  const [notifiche, setNotifiche] = useState<EsitoNotifiche | null>(null)

  // App degli store: notifiche push (ritardo, uscita non timbrata). Toccando
  // la notifica si apre la scheda indicata.
  useEffect(() => {
    if (!eAppNativa()) return
    attivaNotifiche((s) => setScheda((['oggi', 'turni', 'ferie', 'ore'].includes(s) ? s : 'oggi') as Scheda))
      .then(setNotifiche).catch(() => setNotifiche('non_disponibili'))
  }, [])

  useEffect(() => { const t = setInterval(() => setAdesso(Date.now()), 1000); return () => clearInterval(t) }, [])
  const passo = Math.floor(adesso / 1000 / PASSO_SECONDI)

  // QR: si rifà a ogni passo di 30 secondi, senza rete
  useEffect(() => {
    let vivo = true
    codiceQr(attivazione.segreto, attivazione.employee_id, passo * PASSO_SECONDI * 1000)
      .then((testo) => QRCode.toDataURL(testo, { margin: 1, width: 320, errorCorrectionLevel: 'M' }))
      .then((url) => { if (vivo) setQr(url) })
      .catch(() => { if (vivo) setQr(null) })
    return () => { vivo = false }
  }, [attivazione, passo])

  const aggiorna = useCallback(async () => {
    if (!navigator.onLine) return
    const { data, error } = await supabase.rpc('app_dipendente_oggi')
    if (error || !data) return
    const d = { ...(data as unknown as DatiOggi), scaricati_il: new Date().toISOString() }
    localStorage.setItem(K_OGGI, JSON.stringify(d))
    setDati(d)
  }, [])

  // Con il QR a schermo si controlla ogni 10 secondi: chi ha appena timbrato
  // guarda subito il telefono (prova del 09/11/2026: con 60 secondi
  // l'entrata compariva in ritardo). Altrimenti una volta al minuto.
  useEffect(() => {
    void aggiorna()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void aggiorna()
    }, scheda === 'oggi' ? 10_000 : 60_000)
    const on = () => { setOnline(true); void aggiorna() }
    const off = () => setOnline(false)
    const visibile = () => { if (document.visibilityState === 'visible') void aggiorna() }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', visibile)
    return () => {
      clearInterval(t)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      document.removeEventListener('visibilitychange', visibile)
    }
  }, [aggiorna, scheda])

  const oggi = dataRoma(adesso)
  // Giorno prima calcolato sulla data (non 24 ore prima: nei giorni del cambio d'ora sbaglierebbe)
  const ieri = (() => { const [y, m, d] = oggi.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10) })()
  const perGiorno = useCallback((d: string): Timbratura[] =>
    (dati?.timbrature ?? []).filter((t) => dataRoma(Date.parse(t.ora)) === d).map((t) => ({ tipo: t.tipo, ora: t.ora })), [dati])
  // Con il turno spezzato vale l'intera giornata: dal primo inizio all'ultima fine
  const turnoDel = useCallback((d: string) => {
    const del = (dati?.turni ?? []).filter((t) => t.data === d).sort((a, b) => a.inizio.localeCompare(b.inizio))
    if (!del.length) return null
    return { ...del[del.length - 1], inizio: del[0].inizio }
  }, [dati])

  const rOggi = riepilogoGiorno(perGiorno(oggi), turnoDel(oggi), adesso)
  const rIeri = riepilogoGiorno(perGiorno(ieri), turnoDel(ieri), adesso)
  // Un'uscita da segnare: oggi a fine turno + margine, oppure ieri rimasta aperta
  const daSegnare = rIeri.esito !== 'non_timbrato' && rIeri.esito !== 'uscito' ? ieri
    : rOggi.esito === 'uscita_mancante' ? oggi : null


  const segnaUscita = async () => {
    if (!daSegnare || !/^\d{2}:\d{2}$/.test(oraUscita)) return
    setMessaggio(null)
    const { error } = await supabase.rpc('app_dipendente_dichiara_uscita', { p_data: daSegnare, p_ora: oraUscita })
    if (error) { setMessaggio({ ok: false, testo: error.message }); return }
    setMessaggio({ ok: true, testo: `Uscita delle ${oraUscita} segnata: la conferma chi segue il personale.` })
    setOraUscita('')
    void aggiorna()
  }

  const secondi = secondiAlCambio(adesso)

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-5 pt-6 pb-28 gap-5" style={CARATTERE}>
      <div className="w-full max-w-sm flex justify-center pb-1"><Marchio /></div>
      <div className="w-full max-w-sm flex items-center justify-between">
        <div>
          <p className="text-slate-500 text-sm">{dati?.persona.negozio ?? ''}</p>
          <p className="text-xl font-bold text-slate-900">{dati?.persona.nome ?? attivazione.nome}</p>
        </div>
        {!online && <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded-full"><WifiOff size={12} />Senza rete</span>}
      </div>

      {scheda === 'turni' && <Suspense fallback={<RefreshCw className="animate-spin text-slate-400" />}><AppTurni /></Suspense>}
      {scheda === 'ferie' && <Suspense fallback={<RefreshCw className="animate-spin text-slate-400" />}><AppFerie /></Suspense>}
      {scheda === 'ore' && <Suspense fallback={<RefreshCw className="animate-spin text-slate-400" />}><AppOre /></Suspense>}

      {scheda === 'oggi' && (<>
      {notifiche === 'negate' && (
        <p className="w-full max-w-sm text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3">
          Le notifiche sono spente: non ti arrivano gli avvisi di entrata e uscita. Accendile nelle impostazioni del telefono, alla voce New Zago.
        </p>
      )}
      {/* QR */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-5 flex flex-col items-center gap-2">
        {qr ? <img src={qr} alt="Il tuo codice per timbrare" className="w-64 h-64" /> : <RefreshCw className="animate-spin text-slate-400 my-24" />}
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-[#ff0066] transition-all" style={{ width: `${(secondi / PASSO_SECONDI) * 100}%` }} />
        </div>
        <p className="text-slate-600 text-center">Avvicina il telefono alla timbratrice del negozio</p>
        <p className="text-slate-400 text-xs text-center">Il codice cambia ogni 30 secondi: una foto non vale.</p>
      </div>

      {/* Uscita da segnare */}
      {daSegnare && (
        <div className="w-full max-w-sm bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col gap-3">
          <p className="font-semibold text-amber-900">
            {daSegnare === ieri ? 'Ieri non risulta la tua uscita.' : 'Il turno è finito e non risulta la tua uscita.'}
          </p>
          <p className="text-sm text-amber-800">Se stai ancora lavorando, timbra l'uscita quando esci. Se sei già fuori, scrivi l'ora:</p>
          <div className="flex gap-2">
            <input type="time" value={oraUscita} onChange={(e) => setOraUscita(e.target.value)}
              className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-lg" />
            <button onClick={() => void segnaUscita()} disabled={!oraUscita} className="px-4 rounded-lg bg-amber-600 text-white font-semibold disabled:opacity-40">Segna</button>
          </div>
        </div>
      )}
      {messaggio && <p className={`w-full max-w-sm text-sm ${messaggio.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{messaggio.testo}</p>}

      {/* Oggi */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Oggi</p>
        {turnoDel(oggi)
          ? <p className="text-slate-900 font-semibold">Turno {turnoDel(oggi)!.inizio.slice(0, 5)} - {turnoDel(oggi)!.fine.slice(0, 5)}</p>
          : <p className="text-slate-500">Nessun turno oggi</p>}
        {perGiorno(oggi).length > 0 ? (
          <>
            <p className="text-sm text-slate-600 mt-1">{ordina(perGiorno(oggi)).map((t) => `${ETICHETTA_TIPO[t.tipo]} ${oraRoma(t.ora)}`).join(' · ')}</p>
            <p className="text-sm text-slate-500 mt-1">{ETICHETTA_ESITO[rOggi.esito]} · lavorate {formatMinuti(rOggi.minutiLavorati)}{rOggi.minutiPausa ? ` · pausa ${formatMinuti(rOggi.minutiPausa)}` : ''}</p>
          </>
        ) : <p className="text-sm text-slate-500 mt-1">Nessuna timbratura oggi.</p>}
      </div>

      {dati?.scaricati_il && <p className="text-slate-400 text-xs">Aggiornato alle {oraRoma(dati.scaricati_il)}</p>}
      </>)}

      {/* Schede in basso */}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex justify-around pb-[env(safe-area-inset-bottom)]">
        {SCHEDE.map(({ k, label, Icona }) => (
          <button key={k} onClick={() => setScheda(k)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs ${scheda === k ? 'text-[#ff0066] font-semibold' : 'text-slate-500'}`}>
            <Icona size={22} />{label}
          </button>
        ))}
      </nav>
    </div>
  )
}
