// Presenze → conferma dei casi (migration 373, entrata dichiarata 382): tipi e
// conti puri, senza rete, per l'elenco «Da confermare» e il riepilogo del mese.
import { CAUSALI_STRAORDINARIO, CAUSALI_USCITA } from './timbrature'

export type TipoEvento = 'ritardo' | 'uscita_anticipata' | 'straordinario' | 'entrata_dichiarata' | 'pausa_lunga'
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
  /** Entrata dichiarata (382): quando e' stata segnata e da dove. */
  segnata_il?: string | null
  canale?: 'negozio' | 'app' | null
}

export const ETICHETTA_CAUSALE: Record<string, string> = { ...CAUSALI_USCITA, ...CAUSALI_STRAORDINARIO }

export const ETICHETTA_ESITO_EVENTO: Record<string, string> = {
  permesso: 'permesso creato',
  malattia: 'malattia (con certificato)',
  ore_non_lavorate: 'ore non lavorate, senza permesso',
  straordinario: 'straordinario confermato',
  respinto: 'non confermato',
  entrata_confermata: 'entrata confermata',
  entrata_non_confermata: 'entrata non confermata',
}

/** Come si mostra il caso nell'elenco: etichetta del tipo («sto male» ha la sua). */
export function etichettaTipo(e: Pick<EventoPresenze, 'tipo' | 'causale'>): string {
  if (e.tipo === 'ritardo') return 'Ritardo'
  if (e.tipo === 'straordinario') return 'Straordinario'
  if (e.tipo === 'entrata_dichiarata') return 'Entrata dichiarata'
  if (e.tipo === 'pausa_lunga') return 'Pausa più lunga'
  return e.causale === 'malattia' ? 'Sto male' : 'Uscita prima'
}

/** Cosa serve per confermare con un tocco solo; altrimenti si apre la decisione. */
export function confermaDiretta(e: Pick<EventoPresenze, 'tipo' | 'causale'>): boolean {
  if (e.tipo === 'uscita_anticipata') return e.causale === 'personale' || e.causale === 'malattia'
  // 392: va scelto se scalare il permesso
  if (e.tipo === 'pausa_lunga') return false
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
    if (e.stato !== 'confermato' || e.tipo === 'entrata_dichiarata') continue
    const min = e.minuti_confermati ?? e.minuti_proposti
    if (e.tipo === 'ritardo') { r.ritardi++; r.permessoRitardi += min }
    else if (e.tipo === 'pausa_lunga') {
      // 392: permesso (con quelli delle uscite) oppure ore non lavorate
      if (e.esito === 'permesso') r.permessoUscite += min
      else if (e.esito === 'ore_non_lavorate') r.oreNonLavorate += min
    } else if (e.tipo === 'uscita_anticipata') {
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

/**
 * Entrata dichiarata: minuti dopo l'inizio del turno e, se oltre la
 * tolleranza, il permesso che nasce alla conferma (blocchi di 15 per eccesso,
 * come il ritardo timbrato). minuti = ora dichiarata - inizio del turno.
 */
export function esitoEntrataDichiarata(minuti: number, tolleranza: number | null): { ritardo: boolean; permesso: number; testo: string } {
  const tol = tolleranza ?? 10
  if (minuti <= tol) return { ritardo: false, permesso: 0, testo: minuti > 0 ? `${minuti}' dopo, entro la tolleranza` : 'in orario' }
  const permesso = Math.ceil(minuti / 15) * 15
  return { ritardo: true, permesso, testo: `${minuti}' dopo: alla conferma nasce il ritardo (${permesso}' di permesso)` }
}
