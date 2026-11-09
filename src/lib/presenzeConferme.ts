// Presenze → conferma dei casi (migration 373): tipi e conti puri, senza
// rete, per l'elenco «Da confermare» e il riepilogo del mese.
import { CAUSALI_STRAORDINARIO, CAUSALI_USCITA } from './timbrature'

export type TipoEvento = 'ritardo' | 'uscita_anticipata' | 'straordinario'
export type StatoEvento = 'da_confermare' | 'confermato' | 'respinto'

export interface EventoPresenze {
  id: string
  data: string
  tipo: TipoEvento
  outlet_id: string
  negozio: string
  employee_id: string
  persona: string
  prova: boolean
  ora: string | null
  turno_inizio: string | null
  turno_fine: string | null
  minuti: number
  minuti_proposti: number
  minuti_confermati: number | null
  tolleranza: number | null
  margine: number | null
  causale: string | null
  causale_negozio: string | null
  motivo: string | null
  stato: StatoEvento
  esito: string | null
  scala_permesso: boolean | null
  deciso_il: string | null
  deciso_da: string | null
  nota_decisione: string | null
  leave_request_id: string | null
}

export const ETICHETTA_CAUSALE: Record<string, string> = { ...CAUSALI_USCITA, ...CAUSALI_STRAORDINARIO }

export const ETICHETTA_ESITO_EVENTO: Record<string, string> = {
  permesso: 'permesso creato',
  malattia: 'malattia registrata',
  ore_non_lavorate: 'ore non lavorate, senza permesso',
  straordinario: 'straordinario confermato',
  respinto: 'non confermato',
}

/** Come si mostra il caso nell'elenco: etichetta del tipo (la malattia ha la sua). */
export function etichettaTipo(e: Pick<EventoPresenze, 'tipo' | 'causale'>): string {
  if (e.tipo === 'ritardo') return 'Ritardo'
  if (e.tipo === 'straordinario') return 'Straordinario'
  return e.causale === 'malattia' ? 'Malattia' : 'Uscita prima'
}

/** Cosa serve per confermare con un tocco solo; altrimenti si apre la decisione. */
export function confermaDiretta(e: Pick<EventoPresenze, 'tipo' | 'causale'>): boolean {
  if (e.tipo === 'uscita_anticipata') return e.causale === 'personale' || e.causale === 'malattia'
  return true
}

export interface RiepilogoPersona {
  employee_id: string
  persona: string
  negozio: string
  ritardi: number
  permessoRitardi: number
  permessoUscite: number
  oreNonLavorate: number
  malattie: { data: string; ora: string | null }[]
  straordinari: number
  perCausale: Record<string, number>
  daConfermare: number
}

/** Riepilogo del mese per persona: conta solo i casi confermati; quelli ancora aperti si contano a parte. */
export function riepilogoMese(eventi: EventoPresenze[]): RiepilogoPersona[] {
  const m = new Map<string, RiepilogoPersona>()
  for (const e of eventi) {
    let r = m.get(e.employee_id)
    if (!r) {
      r = { employee_id: e.employee_id, persona: e.persona, negozio: e.negozio, ritardi: 0, permessoRitardi: 0, permessoUscite: 0, oreNonLavorate: 0, malattie: [], straordinari: 0, perCausale: {}, daConfermare: 0 }
      m.set(e.employee_id, r)
    }
    if (e.stato === 'da_confermare') { r.daConfermare++; continue }
    if (e.stato !== 'confermato') continue
    const min = e.minuti_confermati ?? e.minuti_proposti
    if (e.tipo === 'ritardo') { r.ritardi++; r.permessoRitardi += min }
    else if (e.tipo === 'uscita_anticipata') {
      if (e.esito === 'malattia') r.malattie.push({ data: e.data, ora: e.ora })
      else if (e.esito === 'permesso') r.permessoUscite += min
      else if (e.esito === 'ore_non_lavorate') r.oreNonLavorate += min
    } else {
      r.straordinari += min
      const k = e.causale ?? 'senza_motivo'
      r.perCausale[k] = (r.perCausale[k] ?? 0) + min
    }
  }
  return [...m.values()].sort((a, b) => a.negozio.localeCompare(b.negozio) || a.persona.localeCompare(b.persona))
}
