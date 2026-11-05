// Notifiche push dell'app New Zago (Android e iOS, Capacitor).
// Nel browser non fa niente: le notifiche esistono solo nell'app degli store.
//
// Chiede il permesso, prende il codice Firebase del telefono (uguale su
// Android e iPhone, per questo si usa @capacitor-firebase/messaging e non il
// modulo standard, che su iPhone darebbe il codice Apple) e lo registra con
// app_registra_push_token (migration 352). Toccando una notifica l'app apre
// la scheda indicata (di solito «Oggi»).
import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

export function eAppNativa(): boolean {
  return Capacitor.isNativePlatform()
}

export type EsitoNotifiche = 'attive' | 'negate' | 'non_disponibili'

export async function attivaNotifiche(onApri: (scheda: string) => void): Promise<EsitoNotifiche> {
  if (!Capacitor.isNativePlatform()) return 'non_disponibili'
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging')

  let perm = await FirebaseMessaging.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await FirebaseMessaging.requestPermissions()
  }
  if (perm.receive !== 'granted') return 'negate'

  if (Capacitor.getPlatform() === 'android') {
    // Canale con priorita' alta: l'avviso deve farsi vedere anche a telefono bloccato
    try { await FirebaseMessaging.createChannel({ id: 'presenze', name: 'Presenze', importance: 5, visibility: 1 }) } catch { /* canale gia' presente */ }
  }

  const registra = async (token: string) => {
    const piattaforma = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android'
    await supabase.rpc('app_registra_push_token', { p_token: token, p_piattaforma: piattaforma })
  }
  const { token } = await FirebaseMessaging.getToken()
  if (token) await registra(token)
  await FirebaseMessaging.addListener('tokenReceived', (e) => { void registra(e.token) })
  await FirebaseMessaging.addListener('notificationActionPerformed', (e) => {
    const dati = (e.notification.data ?? {}) as { scheda?: string }
    onApri(dati.scheda ?? 'oggi')
  })
  return 'attive'
}
