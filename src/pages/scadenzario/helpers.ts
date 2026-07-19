// ─────────────────────────────────────────────────────────────────────────────
// Helper, costanti e configurazioni condivise dello Scadenzario.
// Estratti da ScadenzarioSmart.tsx (spezzatura ondata 9) SENZA cambi funzionali:
// qui vive tutto ciò che non dipende dallo stato del componente pagina.
// ─────────────────────────────────────────────────────────────────────────────

// Tab principale ScadenzarioSmart — persistito in URL come ?section=
export type ScadenzarioSection = 'situazione' | 'scadenze' | 'ricorrenti';
export const VALID_SCADENZARIO_SECTIONS: ScadenzarioSection[] = ['situazione', 'scadenze', 'ricorrenti'];

/**
 * Calcola lo stato di una payable in base alle sue date.
 * Stati terminali (pagato, nota_credito, sospeso, rimandato, annullato,
 * parziale) rispettati. Altrimenti deduce da due_date:
 *   - oggi > due_date  -> 'scaduto'
 *   - 0..30 giorni     -> 'in_scadenza' (allineato al filtro 'Prossimi 30gg')
 *   - oltre 30 giorni  -> 'da_pagare'
 */
// TODO: tighten type
export function calculatePayableStatus(p: any): string {
  const TERMINAL = new Set(['pagato', 'nota_credito', 'sospeso', 'rimandato', 'annullato', 'parziale']);
  if (p.status && TERMINAL.has(p.status)) return p.status;
  if (p.payment_date) return 'pagato';
  if (!p.due_date) return p.status || 'da_pagare';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(p.due_date);
  due.setHours(0, 0, 0, 0);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'scaduto';
  if (days <= 30) return 'in_scadenza';
  return 'da_pagare';
}

/**
 * Formattatore importi unico per tutto lo Scadenzario.
 * Sempre formato italiano "1.234,56" con simbolo o senza, due decimali.
 * Usato per Fix 5.3 (formato numeri inconsistente).
 */
export function formatCurrency(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n)) + ' €';
}

export function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  // Parsing robusto. Supabase puo' ritornare gross_amount come:
  //   - number (1234.56) -> ok
  //   - string '1234.56' -> Number() funziona
  //   - string '1.234,56' (formato IT) -> Number() ritorna NaN, parse a mano
  // useGrouping: 'always' forza il separatore migliaia anche per browser
  // che lo omettono per default su numeri 4 cifre.
  let num
  if (typeof n === 'number') {
    num = n
  } else {
    const s = String(n).trim()
    // Se contiene sia '.' che ',' assumo formato italiano: '.' migliaia, ',' decimali
    if (s.includes(',') && s.includes('.')) {
      num = parseFloat(s.replace(/\./g, '').replace(',', '.'))
    } else if (s.includes(',') && !s.includes('.')) {
      num = parseFloat(s.replace(',', '.'))
    } else {
      num = parseFloat(s)
    }
  }
  if (!isFinite(num)) return '—'
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(num)
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Status config
export const statusConfig = {
  scaduto: { label: 'Scaduto', bg: 'bg-red-100 text-red-700' },
  in_scadenza: { label: 'In scadenza', bg: 'bg-amber-100 text-amber-700' },
  da_pagare: { label: 'Da pagare', bg: 'bg-blue-100 text-blue-700' },
  parziale: { label: 'Parziale', bg: 'bg-orange-100 text-orange-700' },
  sospeso: { label: 'Sospeso', bg: 'bg-slate-100 text-slate-600' },
  rimandato: { label: 'Rimandato', bg: 'bg-purple-100 text-purple-700' },
  pagato: { label: 'Pagato', bg: 'bg-emerald-100 text-emerald-700' },
  annullato: { label: 'Annullato', bg: 'bg-gray-100 text-gray-500' },
  contestato: { label: 'Contestato', bg: 'bg-purple-100 text-purple-700' },
  nota_credito: { label: 'Nota Credito', bg: 'bg-emerald-100 text-emerald-700' },
};

// Payment method labels
export const paymentMethodLabels = {
  bonifico_ordinario: 'Bonifico ordinario',
  bonifico_urgente: 'Bonifico urgente',
  bonifico_sepa: 'Bonifico SEPA',
  bonifico: 'Bonifico',
  riba_30: 'RiBa 30 gg',
  riba_60: 'RiBa 60 gg',
  riba_90: 'RiBa 90 gg',
  riba_120: 'RiBa 120 gg',
  riba: 'RiBa',
  rid: 'RID',
  sdd_core: 'SDD Core',
  sdd_b2b: 'SDD B2B',
  rimessa_diretta: 'Rimessa diretta',
  carta_credito: 'Carta di credito',
  carta_debito: 'Carta di debito',
  carta: 'Carta',
  assegno: 'Assegno',
  contanti: 'Contanti',
  compensazione: 'Compensazione',
  f24: 'F24',
  mav: 'MAV',
  rav: 'RAV',
  bollettino_postale: 'Bollettino postale',
  altro: 'Altro',
};

// Payment groups for filtering
export const paymentGroups = [
  { label: 'Bonifici', key: 'bonifici', methods: ['bonifico_ordinario', 'bonifico_urgente', 'bonifico_sepa', 'bonifico'] },
  { label: 'RiBa', key: 'riba', methods: ['riba_30', 'riba_60', 'riba_90', 'riba_120', 'riba'] },
  { label: 'Addebito diretto', key: 'addebito', methods: ['rid', 'sdd_core', 'sdd_b2b'] },
  { label: 'Altro', key: 'altro', methods: ['rimessa_diretta', 'carta_credito', 'carta_debito', 'carta', 'assegno', 'contanti', 'compensazione', 'f24', 'mav', 'rav', 'bollettino_postale', 'altro'] },
];

export const RIBA_DAYS = { riba_30: 30, riba_60: 60, riba_90: 90, riba_120: 120 };

// ── SCADENZE-STIMA da ricorrenza (on-the-fly) ─────────────────────────────
// Orizzonte mobile e tolleranza di riconciliazione: definiti UNA volta qui,
// niente valori sparsi. La finestra parte sempre dal mese corrente (mobile:
// si sposta da sola a ogni apertura, nessun job schedulato necessario).
export const ESTIMATE_HORIZON_MONTHS = 12;
// Tolleranza importo per considerare una stima "coperta" da una fattura reale
// (stesso fornitore + stesso mese). ±8% oppure ±€20, il maggiore: copre IVA/
// arrotondamenti senza abbinare importi palesemente diversi.
export const ESTIMATE_MATCH_TOLERANCE_PCT = 0.08;
export const ESTIMATE_MATCH_TOLERANCE_ABS = 20;
// Passo in mesi per frequenza ricorrenza (allineato a recurring_costs.frequency
// e alla tab Ricorrenze / cashflow).
export const RECURRENCE_STEP_MONTHS: Record<string, number> = {
  monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12,
};
// Normalizza un nome fornitore per il match (case/spazi).
export function normSupplier(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Categorizzazione automatica degli INCASSI dalla descrizione del movimento.
// Solo etichetta categoriale (chip), NON un numero: niente verde sugli importi.
// Per rispettare la convenzione "niente verde" evito classi emerald: Accredito/
// Incasso/Giroconto/Altro su slate, gli altri su tinte non-verdi.
export function categorizeIncome(desc: string | null | undefined): { tipo: string; cls: string } {
  const d = (desc || '').toLowerCase();
  if (d.includes('p.o.s.') || /\bpos\b/.test(d)) return { tipo: 'POS', cls: 'bg-violet-50 text-violet-700' };
  if (d.includes('bonifico') && (d.includes('favore') || d.includes('ordinante'))) return { tipo: 'Bonifico', cls: 'bg-blue-50 text-blue-700' };
  if (d.includes('versamento') && d.includes('contant')) return { tipo: 'Contanti', cls: 'bg-amber-50 text-amber-700' };
  if (d.includes('accredito')) return { tipo: 'Accredito', cls: 'bg-slate-100 text-slate-600' };
  if (d.includes('incass')) return { tipo: 'Incasso', cls: 'bg-slate-100 text-slate-600' };
  if (d.includes('giroconto')) return { tipo: 'Giroconto', cls: 'bg-slate-100 text-slate-600' };
  return { tipo: 'Altro', cls: 'bg-slate-100 text-slate-600' };
}
