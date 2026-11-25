// Avvisi dei turni nell'app del dipendente (migration 466, Patrizio 25/11/2026): ogni turno
// pubblicato che arriva, cambia o se ne va. La notifica sul telefono la compone la Edge Function
// turni-notifiche con `riassuntoAvvisi`; qui le righe che si leggono nella scheda Turni.

import { supabase } from './supabase';

export interface AvvisoApp {
  id: number;
  shift_id?: string;
  tipo: 'pubblicato' | 'cambiato' | 'tolto';
  data: string;
  prima: { inizio: string; fine: string; data: string; outlet_id?: string | null } | null;
  dopo: { inizio: string; fine: string; data: string; outlet_id?: string | null } | null;
  negozio: string | null;
  creato_il: string;
  letto: boolean;
}

const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const giorno = (d: string) => `${GIORNI[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const ore = (t: { inizio: string; fine: string }) => `${t.inizio.slice(0, 5)}-${t.fine.slice(0, 5)}`;

/** La riga di un avviso, come la legge la dipendente. */
export function testoAvviso(a: Pick<AvvisoApp, 'tipo' | 'data' | 'prima' | 'dopo'> & { negozio?: string | null }): string {
  if (a.tipo === 'pubblicato' && a.dopo) return `${giorno(a.dopo.data)}: nuovo turno ${ore(a.dopo)}`;
  if (a.tipo === 'tolto' && a.prima) return `${giorno(a.prima.data)}: turno tolto (era ${ore(a.prima)})`;
  if (a.tipo === 'cambiato' && a.prima && a.dopo) {
    if (a.prima.data === a.dopo.data && ore(a.prima) === ore(a.dopo)) return `${giorno(a.dopo.data)}: ${ore(a.dopo)} in un altro negozio${a.negozio ? ` (${a.negozio})` : ''}`;
    return a.prima.data === a.dopo.data
      ? `${giorno(a.dopo.data)}: ora ${ore(a.dopo)} (era ${ore(a.prima)})`
      : `${giorno(a.prima.data)} ${ore(a.prima)} spostato a ${giorno(a.dopo.data)} ${ore(a.dopo)}`;
  }
  return `${giorno(a.data)}: turno cambiato`;
}

/**
 * Le novita' da mostrare: per ogni turno com'era prima del primo avviso non letto e com'e'
 * dopo l'ultimo. Una settimana ritirata e ripubblicata uguale non mostra niente (revisori,
 * 25/11/2026): `avviso` null, la riga non si mostra; un turno cambiato due volte mostra solo l'orario
 * finale. `ids` sono tutti gli avvisi che la riga riassume: «Ho visto» li segna letti tutti.
 */
export function novitaDaMostrare(avvisi: AvvisoApp[]): { avviso: AvvisoApp | null; ids: number[] }[] {
  const nonLetti = avvisi.filter((a) => !a.letto);
  const gruppi = new Map<string, AvvisoApp[]>();
  for (const a of nonLetti) { const k = a.shift_id ?? `id-${a.id}`; gruppi.set(k, [...(gruppi.get(k) ?? []), a]); }
  const out: { avviso: AvvisoApp | null; ids: number[] }[] = [];
  for (const lista of gruppi.values()) {
    lista.sort((x, y) => x.id - y.id);
    const primo = lista[0]; const ultimo = lista[lista.length - 1];
    const prima = primo.tipo === 'pubblicato' ? null : primo.prima;
    const dopo = ultimo.tipo === 'tolto' ? null : ultimo.dopo;
    const ids = lista.map((x) => x.id);
    // niente da dire: la riga non si mostra, ma «Ho visto» la segna letta
    if (!prima && !dopo) { out.push({ avviso: null, ids }); continue; }
    if (prima && dopo && prima.data === dopo.data && ore(prima) === ore(dopo) && (prima.outlet_id ?? null) === (dopo.outlet_id ?? null)) {
      out.push({ avviso: null, ids }); continue;
    }
    out.push({ avviso: { ...ultimo, tipo: !prima ? 'pubblicato' : !dopo ? 'tolto' : 'cambiato', prima, dopo, data: (dopo ?? prima)!.data }, ids });
  }
  return out.sort((a, b) => (a.avviso?.data ?? '').localeCompare(b.avviso?.data ?? ''));
}

/**
 * I miei avvisi degli ultimi 30 giorni; null dove la funzione non c'e' (prima della 466, sito Made).
 * Ogni altro errore (rete, server) si lancia: chi chiama tiene quello che aveva.
 */
export async function mieiAvvisiTurni(): Promise<AvvisoApp[] | null> {
  const { data, error } = await supabase.rpc('app_dipendente_avvisi_turni' as never);
  if (error) {
    if (['PGRST202', '42883'].includes((error as { code?: string }).code ?? '')) return null;
    throw error;
  }
  return (data as unknown as AvvisoApp[]) ?? [];
}

/** «Ho visto»: gli avvisi mostrati diventano letti (non quelli arrivati dopo). */
export async function segnaAvvisiLetti(ids: number[]): Promise<void> {
  const { error } = await supabase.rpc('app_dipendente_avvisi_turni_letti' as never, { p_ids: ids } as never);
  if (error) throw error;
}
