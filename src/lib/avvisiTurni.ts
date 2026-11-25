// Avvisi dei turni nell'app del dipendente (migration 466, Patrizio 25/11/2026): ogni turno
// pubblicato che arriva, cambia o se ne va. La notifica sul telefono la compone la Edge Function
// turni-notifiche con `riassuntoAvvisi`; qui le righe che si leggono nella scheda Turni.

import { supabase } from './supabase';

export interface AvvisoApp {
  id: number;
  tipo: 'pubblicato' | 'cambiato' | 'tolto';
  data: string;
  prima: { inizio: string; fine: string; data: string } | null;
  dopo: { inizio: string; fine: string; data: string } | null;
  negozio: string | null;
  creato_il: string;
  letto: boolean;
}

const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const giorno = (d: string) => `${GIORNI[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const ore = (t: { inizio: string; fine: string }) => `${t.inizio.slice(0, 5)}-${t.fine.slice(0, 5)}`;

/** La riga di un avviso, come la legge la dipendente. */
export function testoAvviso(a: Pick<AvvisoApp, 'tipo' | 'data' | 'prima' | 'dopo'>): string {
  if (a.tipo === 'pubblicato' && a.dopo) return `${giorno(a.dopo.data)}: nuovo turno ${ore(a.dopo)}`;
  if (a.tipo === 'tolto' && a.prima) return `${giorno(a.prima.data)}: turno tolto (era ${ore(a.prima)})`;
  if (a.tipo === 'cambiato' && a.prima && a.dopo) {
    return a.prima.data === a.dopo.data
      ? `${giorno(a.dopo.data)}: ora ${ore(a.dopo)} (era ${ore(a.prima)})`
      : `${giorno(a.prima.data)} ${ore(a.prima)} spostato a ${giorno(a.dopo.data)} ${ore(a.dopo)}`;
  }
  return `${giorno(a.data)}: turno cambiato`;
}

/** I miei avvisi degli ultimi 30 giorni; null dove la funzione non c'e' (prima della 466, sito Made). */
export async function mieiAvvisiTurni(): Promise<AvvisoApp[] | null> {
  const { data, error } = await supabase.rpc('app_dipendente_avvisi_turni' as never);
  if (error) return null;
  return (data as unknown as AvvisoApp[]) ?? [];
}

/** «Ho visto»: tutti i miei avvisi diventano letti. */
export async function segnaAvvisiLetti(): Promise<void> {
  const { error } = await supabase.rpc('app_dipendente_avvisi_turni_letti' as never);
  if (error) throw error;
}
