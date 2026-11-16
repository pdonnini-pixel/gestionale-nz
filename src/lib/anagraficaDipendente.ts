// Anagrafica della persona: il modulo «Tutti i dati dell'anagrafica» e come diventa
// una riga di employees. Spostato qui da Dipendenti.tsx (16/11/2026) quando la scheda
// e' diventata una pagina intera: la logica di salvataggio e' la stessa di prima.

/** Codici natura contratto (DB) e la loro etichetta. */
export const CONTRATTO_OPTS: { v: string; l: string }[] = [
  { v: 'indeterminato', l: 'Tempo indeterminato' },
  { v: 'determinato', l: 'Tempo determinato' },
  { v: 'a_chiamata', l: 'A chiamata' },
  { v: 'amministratore', l: 'Amministratore' },
];
export const contrattoLabel = (v?: string | null) => CONTRATTO_OPTS.find((o) => o.v === v)?.l || v || '—';

/** I campi del modulo, tutti come testo (come li scrive la persona). */
export type ModuloAnagrafica = {
  nome: string; cognome: string; matricola: string; codice_fiscale: string;
  data_assunzione: string; contratto: string; data_cessazione: string;
  livello: string; qualifica: string; note: string; part_time_pct: string;
  outlet_id: string; filiale: string;
  scadenza_td: string; durata_mesi: string; proroghe: string; proroghe_disponibili: string;
  mesi_disp_senza_causale: string; mesi_disp_con_causale: string; stato_td: string;
};

type RigaEmployee = Record<string, unknown>;
const testo = (v: unknown) => (v == null ? '' : String(v));

/** Il modulo riempito con i dati di oggi della persona. */
export function moduloDa(e: RigaEmployee | null): ModuloAnagrafica {
  const g = (k: string) => (e ? e[k] : null);
  const cess = testo(g('data_cessazione'));
  return {
    nome: testo(g('nome') || g('first_name')),
    cognome: testo(g('cognome') || g('last_name')),
    matricola: testo(g('matricola')),
    codice_fiscale: testo(g('codice_fiscale') || g('fiscal_code')),
    data_assunzione: testo(g('data_assunzione') || g('hire_date')),
    contratto: testo(g('contratto_tipo') || g('contract_type')) || 'indeterminato',
    data_cessazione: cess === '9999-12-31' ? '' : cess,
    livello: testo(g('livello') || g('level')),
    qualifica: testo(g('qualifica') || g('role_description')),
    note: testo(g('note') || g('notes')),
    part_time_pct: testo(g('part_time_pct')),
    outlet_id: testo(g('outlet_id')),
    filiale: testo(g('filiale')),
    scadenza_td: testo(g('scadenza_td')),
    durata_mesi: testo(g('durata_mesi')),
    proroghe: testo(g('proroghe')),
    proroghe_disponibili: testo(g('proroghe_disponibili')),
    mesi_disp_senza_causale: testo(g('mesi_disp_senza_causale')),
    mesi_disp_con_causale: testo(g('mesi_disp_con_causale')),
    stato_td: testo(g('stato_td')),
  };
}

/** Il modulo come riga di employees: colonne italiane e inglesi allineate, vuoti a NULL. */
export function moduloInRiga(formData: Partial<ModuloAnagrafica> & Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...formData };
  if ('nome' in out) out.first_name = out.nome;
  if ('cognome' in out) out.last_name = out.cognome;
  if ('codice_fiscale' in out) { out.codice_fiscale = out.codice_fiscale || null; out.fiscal_code = out.codice_fiscale; }
  if ('data_assunzione' in out) out.hire_date = out.data_assunzione || null;
  if ('data_cessazione' in out) out.termination_date = out.data_cessazione || null;
  if ('livello' in out) { out.livello = out.livello || null; out.level = out.livello; }
  if ('note' in out) out.notes = out.note || null;
  if ('contratto' in out) { out.contratto_tipo = out.contratto; delete out.contratto; }
  // Qualifica: la colonna e role_description insieme (la sezione «Amministratori» legge role_description).
  if ('qualifica' in out) { out.qualifica = out.qualifica || null; out.role_description = out.qualifica || null; }
  if ('filiale' in out) out.filiale = out.filiale || null;
  if ('outlet_id' in out) out.outlet_id = out.outlet_id || null;
  if ('stato_td' in out) out.stato_td = out.stato_td || null;
  ['part_time_pct', 'durata_mesi', 'proroghe', 'proroghe_disponibili', 'mesi_disp_senza_causale', 'mesi_disp_con_causale'].forEach((k) => {
    if (k in out) out[k] = (out[k] === '' || out[k] == null) ? null : Number(out[k]);
  });
  // date: '' → null. La data di fine resta aperta finche' non c'e' una cessazione.
  ['hire_date', 'termination_date', 'data_assunzione', 'data_cessazione', 'scadenza_td'].forEach((k) => { if (out[k] === '') out[k] = null; });
  // i campi del tempo determinato valgono solo per il tempo determinato
  if (out.contratto_tipo !== 'determinato') {
    ['scadenza_td', 'durata_mesi', 'proroghe', 'proroghe_disponibili', 'mesi_disp_senza_causale', 'mesi_disp_con_causale', 'stato_td'].forEach((k) => { out[k] = null; });
  }
  return out;
}
