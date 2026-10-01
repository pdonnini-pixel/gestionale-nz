// Elenco dipendenti dello studio paghe (file «ELEDIP», es. Elenco_dipendenti_01_10_2026.xlsx).
// Lo studio lo manda ogni mese: per la regola del 29/09/2026 vale come dato vero e
// sostituisce l'anagrafica. Qui si legge il file e si confronta con i dipendenti a
// database; la scrittura la fa la pagina Dipendenti dopo la conferma.

export type TipoContratto = 'indeterminato' | 'determinato' | string;

export interface RigaElenco {
  matricola: string;
  cognome: string;
  nome: string;
  codiceFiscale: string | null;
  assunzione: string | null; // ISO yyyy-mm-dd
  qualifica: string | null;
  livello: string | null;
  tipo: TipoContratto | null;
  /** null = full time (nel file 100%). */
  partTimePct: number | null;
  filiale: string | null;
  scadenza: string | null;
  durataMesi: number | null;
  proroghe: number | null;
  prorogheDisponibili: number | null;
  mesiSenzaCausale: number | null;
  mesiConCausale: number | null;
  stato: string | null;
}

/** I campi dell'anagrafica che l'elenco governa. */
export interface DipendenteConfronto {
  id: string;
  matricola: string | null;
  cognome: string | null;
  nome: string | null;
  codice_fiscale: string | null;
  data_assunzione: string | null;
  qualifica: string | null;
  livello: string | null;
  contratto_tipo: string | null;
  part_time_pct: number | string | null;
  filiale: string | null;
  scadenza_td: string | null;
  durata_mesi: number | string | null;
  proroghe: number | null;
  proroghe_disponibili: number | null;
  mesi_disp_senza_causale: number | string | null;
  mesi_disp_con_causale: number | string | null;
  stato_td: string | null;
  is_active: boolean | null;
}

export interface Differenza {
  campo: string;
  label: string;
  prima: string;
  dopo: string;
}

export interface EsitoConfronto {
  /** In elenco, assenti a database: da creare. */
  nuovi: RigaElenco[];
  /** Stesso codice fiscale ma matricola nuova e assunzione successiva: il vecchio rapporto si chiude, se ne apre uno nuovo. */
  nuoviRapporti: { dip: DipendenteConfronto; riga: RigaElenco }[];
  aggiornati: { dip: DipendenteConfronto; riga: RigaElenco; differenze: Differenza[] }[];
  invariati: number;
  /** Attivi a database ma assenti dall'elenco: non si toccano, si chiede allo studio. */
  mancanti: DipendenteConfronto[];
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// Intestazioni del file, normalizzate (gli a capo nelle celle diventano spazi).
const COLONNE: Record<keyof RigaElenco, string[]> = {
  matricola: ['mtr', 'matricola'],
  cognome: ['cognome'],
  nome: ['nome'],
  codiceFiscale: ['codice fiscale'],
  assunzione: ['data assunzione'],
  qualifica: ['qualifica'],
  livello: ['livello'],
  tipo: ['natura rapporto'],
  partTimePct: ['% part time'],
  filiale: ['filiale'],
  scadenza: ['scadenza td'],
  durataMesi: ['durata in mesi'],
  proroghe: ['proroghe'],
  prorogheDisponibili: ['proroghe disponibili'],
  mesiSenzaCausale: ['mesi disponibili senza causale'],
  mesiConCausale: ['mesi disponibili con causale'],
  stato: ['stato'],
};

const pad2 = (n: number) => String(n).padStart(2, '0');

export function dataIso(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Numero seriale di Excel (giorni dal 30/12/1899).
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function numero(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim().replace('%', '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}

const testo = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

function tipoContratto(v: unknown): TipoContratto | null {
  const s = norm(v);
  if (!s) return null;
  if (s.includes('indeterminato')) return 'indeterminato';
  if (s.includes('determinato')) return 'determinato';
  return String(v).trim();
}

/** Nel file la quota è una frazione (0,875) o una percentuale (87,5). 100% = full time = null. */
function partTime(v: unknown): number | null {
  const n = numero(v);
  if (n == null) return null;
  const pct = n <= 1 ? n * 100 : n;
  const r = Math.round(pct * 100) / 100;
  return r >= 100 ? null : r;
}

/** Legge la matrice del foglio (riga per riga) e restituisce le righe dell'elenco. */
export function parseElenco(matrix: unknown[][]): { righe: RigaElenco[]; errore: string | null } {
  const headerIdx = matrix.findIndex((r) => Array.isArray(r) && r.some((c) => norm(c) === 'cognome') && r.some((c) => ['mtr', 'matricola'].includes(norm(c))));
  if (headerIdx < 0) return { righe: [], errore: 'Non trovo l\'intestazione dell\'elenco (colonne «Mtr» e «Cognome»): è il file giusto?' };
  const header = matrix[headerIdx].map(norm);
  const col = {} as Record<keyof RigaElenco, number>;
  (Object.keys(COLONNE) as (keyof RigaElenco)[]).forEach((k) => {
    col[k] = header.findIndex((h) => COLONNE[k].includes(h));
  });
  const mancanti = (['matricola', 'cognome', 'codiceFiscale', 'tipo'] as const).filter((k) => col[k] < 0);
  if (mancanti.length) return { righe: [], errore: `Nel file mancano colonne necessarie: ${mancanti.join(', ')}.` };
  const cell = (r: unknown[], k: keyof RigaElenco) => (col[k] >= 0 ? r[col[k]] : null);

  const righe: RigaElenco[] = [];
  for (const r of matrix.slice(headerIdx + 1)) {
    if (!Array.isArray(r)) continue;
    const cognome = testo(cell(r, 'cognome'));
    const mtrRaw = testo(cell(r, 'matricola'));
    if (!cognome || !mtrRaw) continue;
    const tipo = tipoContratto(cell(r, 'tipo'));
    const td = tipo === 'determinato';
    righe.push({
      matricola: /^\d+$/.test(mtrRaw) ? mtrRaw.padStart(7, '0') : mtrRaw,
      cognome,
      nome: testo(cell(r, 'nome')) || '',
      codiceFiscale: testo(cell(r, 'codiceFiscale'))?.toUpperCase() || null,
      assunzione: dataIso(cell(r, 'assunzione')),
      qualifica: testo(cell(r, 'qualifica')),
      livello: testo(cell(r, 'livello')),
      tipo,
      partTimePct: partTime(cell(r, 'partTimePct')),
      filiale: testo(cell(r, 'filiale')),
      // I dati del determinato valgono solo per i determinati: per gli altri si azzerano.
      scadenza: td ? dataIso(cell(r, 'scadenza')) : null,
      durataMesi: td ? numero(cell(r, 'durataMesi')) : null,
      proroghe: td ? numero(cell(r, 'proroghe')) : null,
      prorogheDisponibili: td ? numero(cell(r, 'prorogheDisponibili')) : null,
      mesiSenzaCausale: td ? numero(cell(r, 'mesiSenzaCausale')) : null,
      mesiConCausale: td ? numero(cell(r, 'mesiConCausale')) : null,
      stato: td ? testo(cell(r, 'stato')) : null,
    });
  }
  return { righe, errore: righe.length ? null : 'Il file non contiene righe di dipendenti.' };
}

/** Una riga senza tipo di contratto (l'amministratore) non porta dati da allineare. */
const rigaSenzaDati = (r: RigaElenco) => !r.tipo && !r.assunzione;

const fmtNum = (n: number | null) => (n == null ? '—' : String(Math.round(n * 100) / 100).replace('.', ','));
const fmtData = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtPt = (n: number | null) => (n == null ? 'full time' : `${fmtNum(n)}%`);
const numDb = (v: number | string | null) => (v == null || v === '' ? null : Number(v));
const uguali = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 0.005);

export function differenze(d: DipendenteConfronto, r: RigaElenco): Differenza[] {
  const out: Differenza[] = [];
  const txt = (campo: string, label: string, a: string | null, b: string | null) => {
    if ((a || null) !== (b || null)) out.push({ campo, label, prima: a || '—', dopo: b || '—' });
  };
  txt('matricola', 'Matricola', d.matricola, r.matricola);
  txt('codice_fiscale', 'Codice fiscale', d.codice_fiscale, r.codiceFiscale);
  if ((d.data_assunzione || null) !== r.assunzione) out.push({ campo: 'data_assunzione', label: 'Assunzione', prima: fmtData(d.data_assunzione), dopo: fmtData(r.assunzione) });
  txt('qualifica', 'Qualifica', d.qualifica, r.qualifica);
  txt('livello', 'Livello', d.livello, r.livello);
  txt('contratto_tipo', 'Contratto', d.contratto_tipo, r.tipo);
  if (!uguali(numDb(d.part_time_pct), r.partTimePct)) out.push({ campo: 'part_time_pct', label: 'Part time', prima: fmtPt(numDb(d.part_time_pct)), dopo: fmtPt(r.partTimePct) });
  txt('filiale', 'Filiale', d.filiale, r.filiale);
  if ((d.scadenza_td || null) !== r.scadenza) out.push({ campo: 'scadenza_td', label: 'Scadenza TD', prima: fmtData(d.scadenza_td), dopo: fmtData(r.scadenza) });
  const contatori: [string, string, number | null, number | null][] = [
    ['durata_mesi', 'Durata (mesi)', numDb(d.durata_mesi), r.durataMesi],
    ['proroghe', 'Proroghe usate', d.proroghe, r.proroghe],
    ['proroghe_disponibili', 'Proroghe disponibili', d.proroghe_disponibili, r.prorogheDisponibili],
    ['mesi_disp_senza_causale', 'Mesi senza causale', numDb(d.mesi_disp_senza_causale), r.mesiSenzaCausale],
    ['mesi_disp_con_causale', 'Mesi con causale', numDb(d.mesi_disp_con_causale), r.mesiConCausale],
  ];
  contatori.forEach(([campo, label, a, b]) => { if (!uguali(a, b)) out.push({ campo, label, prima: fmtNum(a), dopo: fmtNum(b) }); });
  txt('stato_td', 'Stato TD', d.stato_td, r.stato);
  return out;
}

export function confrontaElenco(righe: RigaElenco[], dipendenti: DipendenteConfronto[]): EsitoConfronto {
  const attivi = dipendenti.filter((d) => d.is_active !== false);
  const usati = new Set<string>();
  const esito: EsitoConfronto = { nuovi: [], nuoviRapporti: [], aggiornati: [], invariati: 0, mancanti: [] };

  for (const r of righe) {
    // Prima il codice fiscale; poi la matricola, ma solo verso chi non ha ancora il codice fiscale.
    const perCf = r.codiceFiscale ? attivi.find((d) => !usati.has(d.id) && (d.codice_fiscale || '').toUpperCase() === r.codiceFiscale) : undefined;
    const dip = perCf || attivi.find((d) => !usati.has(d.id) && !d.codice_fiscale && d.matricola === r.matricola);
    if (!dip) {
      if (!rigaSenzaDati(r)) esito.nuovi.push(r);
      continue;
    }
    usati.add(dip.id);
    if (rigaSenzaDati(r)) { esito.invariati++; continue; }
    if (dip.matricola && dip.matricola !== r.matricola && r.assunzione && dip.data_assunzione && r.assunzione > dip.data_assunzione) {
      esito.nuoviRapporti.push({ dip, riga: r });
      continue;
    }
    const diff = differenze(dip, r);
    if (diff.length) esito.aggiornati.push({ dip, riga: r, differenze: diff });
    else esito.invariati++;
  }
  esito.mancanti = attivi.filter((d) => !usati.has(d.id) && (d.contratto_tipo || '') !== 'amministratore');
  return esito;
}

/** Testo della nota datata lasciata sulla scheda. */
export function notaAllineamento(oggi: string, dataElenco: string, diff: Differenza[]): string {
  const parti = diff.map((x) => `${x.label.toLowerCase()} ${x.prima} -> ${x.dopo}`);
  return `[${fmtData(oggi)}] Allineato all'elenco dipendenti dello studio paghe al ${fmtData(dataElenco)}: ${parti.join('; ')}.`;
}

/** Valori da scrivere in anagrafica per una riga dell'elenco. */
export function valoriDaRiga(r: RigaElenco) {
  return {
    matricola: r.matricola,
    codice_fiscale: r.codiceFiscale,
    fiscal_code: r.codiceFiscale,
    data_assunzione: r.assunzione,
    hire_date: r.assunzione,
    qualifica: r.qualifica,
    role_description: r.qualifica,
    livello: r.livello,
    level: r.livello,
    contratto_tipo: r.tipo,
    part_time_pct: r.partTimePct,
    ore_settimanali: Math.round((r.partTimePct ?? 100) * 0.4 * 10) / 10,
    filiale: r.filiale,
    scadenza_td: r.scadenza,
    durata_mesi: r.durataMesi,
    proroghe: r.proroghe,
    proroghe_disponibili: r.prorogheDisponibili,
    mesi_disp_senza_causale: r.mesiSenzaCausale,
    mesi_disp_con_causale: r.mesiConCausale,
    stato_td: r.stato,
  };
}

/** Outlet a cui appartiene una filiale del file: nome dell'outlet contenuto nella filiale, oppure le filiali paghe dichiarate sull'outlet. */
export function outletDaFiliale<T extends { id: string; name: string; payroll_filiali?: string[] | null }>(filiale: string | null, outlets: T[]): T | null {
  const f = norm(filiale);
  if (!f) return null;
  return outlets.find((o) => (o.payroll_filiali || []).some((p) => f.includes(norm(p))))
    || outlets.find((o) => f.includes(norm(o.name)))
    || null;
}

/** Data dell'elenco dal nome del file («Elenco_dipendenti_01_10_2026.xlsx»). */
export function dataDalNomeFile(nome: string): string | null {
  const m = nome.match(/(\d{1,2})[_.-](\d{1,2})[_.-](\d{4})/);
  return m ? `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}` : null;
}

/** Badge di scadenza del determinato rispetto al mese che si sta guardando. */
export function badgeScadenza(scadenza: string | null, tipo: string | null, meseInizio: string, meseFine: string, oggi: string): { testo: string; tono: 'rosso' | 'ambra' } | null {
  if (!scadenza || tipo !== 'determinato') return null;
  const s = scadenza.slice(0, 10);
  if (s > meseFine) return null;
  if (s < oggi) return { testo: `scaduto il ${fmtData(s)}`, tono: 'rosso' };
  if (s >= meseInizio) return { testo: `scade il ${fmtData(s)}`, tono: 'ambra' };
  return null;
}
