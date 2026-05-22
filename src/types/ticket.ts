// ─────────────────────────────────────────────────────────────
// Tipi per il modulo Segnalazioni (tickets) — separato da
// database.ts perché la tabella `tickets` è gestita da una
// migration dedicata (vedi MIGRATION: create_tickets_and_deploy_config).
//
// Workflow: Sabrina/Veronica aprono un ticket dall'app con
// titolo + (opz.) screenshot. Un task scheduled "AutoFix"
// (vedi Cowork → Scheduled Tasks) legge i ticket aperti,
// classifica per complessità, applica fix automatici al codice
// e chiude il ticket lasciando un commento per l'utente +
// note_fix tecniche per Patrizio.
// ─────────────────────────────────────────────────────────────

export type TicketStato = 'aperto' | 'in_corso' | 'risolto' | 'chiuso'
export type TicketTipo = 'bug' | 'funzione'
export type TicketPriorita = 'basso' | 'medio' | 'alto'

export interface TicketCommento {
  id: string
  autore: string
  origine: 'ai' | 'utente'
  testo: string
  creato_il: string  // ISO 8601 UTC
}

export interface Ticket {
  id: string
  tipo: TicketTipo
  modulo: string
  titolo: string
  descrizione: string | null
  priorita: TicketPriorita
  stato: TicketStato
  autore: string
  autore_id: string | null
  screenshot_url: string | null
  commenti: TicketCommento[]
  note_fix: string | null
  creato_il: string  // ISO 8601 UTC
  risolto_il: string | null
  aggiornato_il: string  // ISO 8601 UTC, auto-aggiornato da trigger DB
}

// Etichette visuali (NON usare "Aperto" come label visiva — il task
// AutoFix lo confonderebbe con un nuovo ticket appena creato).
export const TICKET_STATO_LABEL: Record<TicketStato, string> = {
  aperto: 'In attesa',
  in_corso: 'In corso',
  risolto: 'Risolto',
  chiuso: 'Chiuso',
}

export const TICKET_TIPO_LABEL: Record<TicketTipo, string> = {
  bug: 'Bug',
  funzione: 'Nuova funzionalità',
}

export const TICKET_PRIORITA_LABEL: Record<TicketPriorita, string> = {
  basso: 'Basso',
  medio: 'Medio',
  alto: 'Alto',
}

// Moduli del gestionale — usato come opzioni del dropdown nel form
// "Apri segnalazione". Coerente con la sidebar (vedi Sidebar.tsx).
// "Altro" come catch-all per ticket trasversali o di copy che non
// appartengono a una pagina specifica.
export const TICKET_MODULI: readonly string[] = [
  'Dashboard',
  'Banche',
  'Cashflow',
  'Conto Economico',
  'Outlet',
  'Confronto Outlet',
  'Budget & Controllo',
  'Fornitori',
  'Divisione Fornitori',
  'Fatturazione',
  'Scadenzario',
  'Scadenze Fiscali',
  'Dipendenti',
  'AI Categorie',
  'Margini',
  'Produttività',
  'Scenario Planning',
  'Import Hub',
  'Archivio Documenti',
  'Impostazioni',
  'Profilo',
  'Segnalazioni',
  'Altro',
] as const
