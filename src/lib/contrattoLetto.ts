// ============================================================================
// CONTRATTO LETTO: confronto fra un documento del rapporto e la scheda
// ============================================================================
// Patrizio, 26/11/2026: caricato il contratto firmato di una dipendente, il
// gestionale lo archiviava senza leggerlo. Ora i documenti del rapporto
// (assunzione, proroga, trasformazione, modifica d'orario, cessazione) si
// leggono (edge function `contratto-leggi`) e si confrontano con la scheda.
//
// Regole (CLAUDE.md):
// - «Documenti dello studio paghe = dato vero»: il documento sostituisce
//   l'anagrafica, con una nota datata in coda alla scheda.
// - «Un caricamento arriva in fondo da solo»: un campo VUOTO della scheda si
//   riempie da sé; si chiede conferma solo quando il documento SOSTITUIREBBE un
//   valore già presente.
// - Un documento più vecchio di un altro già archiviato non cambia la scheda.
// - Un cambio d'orario o di contratto che vale da una data futura non si
//   scrive oggi: cambierebbe turni e organico prima del tempo.
// - Se il codice fiscale del documento non è quello della scheda non si tocca
//   niente: il documento potrebbe essere di un'altra persona.
// Funzioni pure, testate in contrattoLetto.test.ts.

export type TipoDocumentoLetto = 'assunzione' | 'proroga' | 'trasformazione' | 'modifica_orario' | 'cessazione' | 'altro';
export type ContrattoTipo = 'determinato' | 'indeterminato' | 'a_chiamata';

export interface ContrattoLetto {
  eRapporto: boolean;
  tipoDocumento: TipoDocumentoLetto;
  dataDocumento: string | null;
  decorrenza: string | null;
  nominativo: string | null;
  codiceFiscale: string | null;
  contrattoTipo: ContrattoTipo | null;
  /** «apprendistato» non è fra i tipi della scheda: si riporta solo nella nota. */
  apprendistato: boolean;
  dataInizio: string | null;
  dataFine: string | null;
  oreSettimanali: number | null;
  livello: string | null;
  qualifica: string | null;
  mansione: string | null;
  sede: string | null;
  periodoProva: string | null;
  dataCessazione: string | null;
  firmato: boolean | null;
}

/** I campi della scheda che un documento del rapporto governa. */
export interface SchedaContratto {
  codice_fiscale?: string | null;
  fiscal_code?: string | null;
  contratto_tipo?: string | null;
  data_assunzione?: string | null;
  hire_date?: string | null;
  scadenza_td?: string | null;
  ore_settimanali?: number | string | null;
  part_time_pct?: number | string | null;
  livello?: string | null;
  level?: string | null;
  qualifica?: string | null;
  role_description?: string | null;
  data_cessazione?: string | null;
  termination_date?: string | null;
}

export interface CampoContratto {
  campo: string;
  label: string;
  prima: string;
  dopo: string;
  /** Colonne da scrivere sulla scheda. */
  valori: Record<string, string | number | null>;
  /** La scheda era vuota: si scrive da sé, senza conferma. */
  riempimento: boolean;
}

export type EsitoLettura =
  | { stato: 'non_rapporto'; testo: string }
  | { stato: 'altra_persona'; testo: string }
  | { stato: 'storico'; testo: string }
  | { stato: 'allineata'; testo: string; rinviati: CampoContratto[]; decorrenza: string | null }
  | { stato: 'da_scrivere'; testo: string; riempimenti: CampoContratto[]; sostituzioni: CampoContratto[]; rinviati: CampoContratto[]; decorrenza: string | null };

/** Tipi di documento dell'archivio che si leggono. */
export const TIPI_DA_LEGGERE = new Set(['contratto', 'impegnativa', 'proroga', 'trasformazione', 'modifica_orario', 'cessazione']);

// ── Normalizzazione della risposta del modello ───────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | null => {
  const s = (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
  return s ? s : null;
};
const data = (v: unknown): string | null => {
  const s = str(v);
  if (!s || !ISO.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const cf = (v: unknown): string | null => {
  const s = str(v)?.replace(/[^0-9A-Za-z]/g, '').toUpperCase() ?? '';
  return /^[A-Z0-9]{16}$/.test(s) ? s : null;
};

const ROMANI: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7' };

/** «4», «4°», «IV», «4 Livello», «quarto» → «4 Livello» (come scrive l'elenco dello studio); «Quadro» resta. */
export function livelloScheda(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/quadr/i.test(s)) return 'Quadro';
  const cifra = s.match(/\d/);
  if (cifra) return `${cifra[0]} Livello`;
  const romano = s.toUpperCase().match(/\b(VII|VI|IV|V|III|II|I)\b/);
  if (romano) return `${ROMANI[romano[1]]} Livello`;
  const parole: Record<string, string> = { primo: '1', secondo: '2', terzo: '3', quarto: '4', quinto: '5', sesto: '6', settimo: '7' };
  const p = Object.keys(parole).find((k) => s.toLowerCase().includes(k));
  return p ? `${parole[p]} Livello` : null;
}

/** «impiegata», «IMPIEGATO», «operaia» → «Impiegato», «Operaio» (come la scheda). */
export function qualificaScheda(v: unknown): string | null {
  const s = (str(v) ?? '').toLowerCase();
  if (!s) return null;
  if (s.startsWith('impiegat')) return 'Impiegato';
  if (s.startsWith('opera')) return 'Operaio';
  if (s.startsWith('quadr')) return 'Quadro';
  if (s.startsWith('apprendist')) return 'Apprendista';
  return null;
}

const TIPI_DOC: TipoDocumentoLetto[] = ['assunzione', 'proroga', 'trasformazione', 'modifica_orario', 'cessazione', 'altro'];

export function normalizzaLettura(raw: unknown): ContrattoLetto {
  const p = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const tipoRaw = str(p.contrattoTipo)?.toLowerCase() ?? '';
  const contrattoTipo: ContrattoTipo | null = tipoRaw.startsWith('indeterminat') ? 'indeterminato'
    : tipoRaw.startsWith('determinat') ? 'determinato'
      : /chiamata|intermittent/.test(tipoRaw) ? 'a_chiamata' : null;
  const tipoDoc = str(p.tipoDocumento)?.toLowerCase() as TipoDocumentoLetto | undefined;
  let ore = num(p.oreSettimanali);
  if (ore != null && (ore <= 0 || ore > 48)) ore = null;
  if (ore == null && p.fullTime === true) ore = 40;
  return {
    eRapporto: p.eRapporto === true,
    tipoDocumento: tipoDoc && TIPI_DOC.includes(tipoDoc) ? tipoDoc : 'altro',
    dataDocumento: data(p.dataDocumento),
    decorrenza: data(p.decorrenza),
    nominativo: str(p.nominativo),
    codiceFiscale: cf(p.codiceFiscale),
    contrattoTipo,
    apprendistato: /apprendist/.test(tipoRaw),
    dataInizio: data(p.dataInizio),
    dataFine: data(p.dataFine),
    oreSettimanali: ore,
    livello: livelloScheda(p.livello),
    qualifica: qualificaScheda(p.qualifica),
    mansione: str(p.mansione),
    sede: str(p.sede),
    periodoProva: str(p.periodoProva),
    dataCessazione: data(p.dataCessazione),
    firmato: typeof p.firmato === 'boolean' ? p.firmato : null,
  };
}

// ── Confronto ────────────────────────────────────────────────────────────────

const fmtData = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtOre = (n: number | null) => (n == null ? '—' : `${String(Math.round(n * 100) / 100).replace('.', ',')} ore`);
const numDb = (v: number | string | null | undefined) => (v == null || v === '' ? null : Number(v));
const TIPO_LABEL: Record<string, string> = { determinato: 'tempo determinato', indeterminato: 'tempo indeterminato', a_chiamata: 'a chiamata' };
const fmtTipo = (t: string | null | undefined) => (t ? TIPO_LABEL[t] ?? t : '—');

/** Ore settimanali della scheda: quelle scritte, oppure dal part time; null se la scheda non lo dice. */
export function oreDellaScheda(s: SchedaContratto): number | null {
  const ore = numDb(s.ore_settimanali);
  if (ore != null) return ore;
  const pt = numDb(s.part_time_pct);
  return pt != null ? Math.round(pt * 0.4 * 100) / 100 : null;
}

/** Colonne delle ore come le scrive l'elenco dello studio: part time null = full time. */
export function valoriOre(ore: number): Record<string, number | null> {
  return { ore_settimanali: ore, part_time_pct: ore >= 40 ? null : Math.round((ore / 40) * 1000) / 10 };
}

/** Data che conta per dire se un documento è più recente di un altro. */
export function dataEffettiva(l: Pick<ContrattoLetto, 'dataDocumento' | 'decorrenza'>, ripiego?: string | null): string | null {
  const d = [l.dataDocumento, l.decorrenza].filter((x): x is string => !!x).sort();
  return d.length ? d[d.length - 1] : (ripiego ?? null);
}

/**
 * Confronta quello che dice il documento con la scheda.
 * @param altreDate date effettive degli altri documenti del rapporto già archiviati
 *                  della stessa persona (lette o, se mai letti, quelle del nome del file)
 */
export function confrontaContratto(s: SchedaContratto, l: ContrattoLetto, oggi: string, altreDate: (string | null)[] = []): EsitoLettura {
  if (!l.eRapporto || l.tipoDocumento === 'altro') {
    return { stato: 'non_rapporto', testo: 'Nel documento non c\'è un contratto, una proroga o un altro atto del rapporto: la scheda non cambia.' };
  }
  const cfScheda = (s.codice_fiscale || s.fiscal_code || '').toUpperCase().trim() || null;
  if (l.codiceFiscale && cfScheda && l.codiceFiscale !== cfScheda) {
    return { stato: 'altra_persona', testo: `Il codice fiscale del documento (${l.codiceFiscale}) non è quello della scheda: non ho cambiato niente. Controlla che il documento sia di questa persona.` };
  }
  const mia = dataEffettiva(l);
  const piuNuova = altreDate.filter((d): d is string => !!d).sort().pop() ?? null;
  if (mia && piuNuova && piuNuova > mia) {
    return { stato: 'storico', testo: `Documento del ${fmtData(mia)}, più vecchio di un altro già archiviato (${fmtData(piuNuova)}): resta nello storico e non cambia la scheda.` };
  }

  const campi: CampoContratto[] = [];
  const rinviati: CampoContratto[] = [];
  const t = l.tipoDocumento;
  const futuro = !!l.decorrenza && l.decorrenza > oggi && (t === 'trasformazione' || t === 'modifica_orario');

  const aggiungi = (c: Omit<CampoContratto, 'riempimento'>, vuoto: boolean, rinvia = false) => {
    const campo = { ...c, riempimento: vuoto };
    (rinvia && !vuoto ? rinviati : campi).push(campo);
  };

  // Codice fiscale: solo se la scheda non ce l'ha (se è diverso ci si è fermati sopra).
  if (l.codiceFiscale && !cfScheda) {
    aggiungi({ campo: 'codice_fiscale', label: 'Codice fiscale', prima: '—', dopo: l.codiceFiscale, valori: { codice_fiscale: l.codiceFiscale, fiscal_code: l.codiceFiscale } }, true);
  }

  // Tipo di contratto.
  if (l.contrattoTipo && (t === 'assunzione' || t === 'trasformazione' || t === 'proroga')) {
    const prima = s.contratto_tipo || null;
    if (prima !== l.contrattoTipo && prima !== 'amministratore') {
      const valori: Record<string, string | null> = { contratto_tipo: l.contrattoTipo };
      if (l.contrattoTipo === 'indeterminato') valori.scadenza_td = null;
      aggiungi({ campo: 'contratto_tipo', label: 'Contratto', prima: fmtTipo(prima), dopo: fmtTipo(l.contrattoTipo), valori }, !prima, futuro);
    }
  }

  // Inizio del rapporto: solo dalla lettera di assunzione.
  if (t === 'assunzione' && l.dataInizio) {
    const prima = s.data_assunzione || s.hire_date || null;
    if ((prima || '').slice(0, 10) !== l.dataInizio) {
      aggiungi({ campo: 'data_assunzione', label: 'Assunzione', prima: fmtData(prima), dopo: fmtData(l.dataInizio), valori: { data_assunzione: l.dataInizio, hire_date: l.dataInizio } }, !prima);
    }
  }

  // Scadenza del determinato: assunzione o proroga (la trasformazione in indeterminato la toglie sopra).
  const tipoFinale = l.contrattoTipo ?? s.contratto_tipo ?? null;
  if (l.dataFine && (t === 'assunzione' || t === 'proroga') && tipoFinale !== 'indeterminato') {
    const prima = s.scadenza_td || null;
    if ((prima || '').slice(0, 10) !== l.dataFine) {
      aggiungi({ campo: 'scadenza_td', label: 'Scadenza', prima: fmtData(prima), dopo: fmtData(l.dataFine), valori: { scadenza_td: l.dataFine } }, !prima);
    }
  }

  // Ore settimanali.
  if (l.oreSettimanali != null && t !== 'cessazione') {
    const prima = oreDellaScheda(s);
    if (prima == null || Math.abs(prima - l.oreSettimanali) >= 0.01) {
      aggiungi({ campo: 'ore_settimanali', label: 'Ore settimanali', prima: fmtOre(prima), dopo: fmtOre(l.oreSettimanali), valori: valoriOre(l.oreSettimanali) }, prima == null, futuro);
    }
  }

  // Livello e qualifica.
  if (l.livello && t !== 'cessazione') {
    const primaRaw = s.livello || s.level || null;
    const prima = livelloScheda(primaRaw) ?? primaRaw;
    if (prima !== l.livello) {
      aggiungi({ campo: 'livello', label: 'Livello', prima: primaRaw || '—', dopo: l.livello, valori: { livello: l.livello, level: l.livello } }, !primaRaw, futuro);
    }
  }
  if (l.qualifica && t !== 'cessazione') {
    const prima = s.qualifica || null;
    if ((prima || '').toLowerCase() !== l.qualifica.toLowerCase()) {
      aggiungi({ campo: 'qualifica', label: 'Qualifica', prima: prima || '—', dopo: l.qualifica, valori: { qualifica: l.qualifica } }, !prima, futuro);
    }
  }
  // Mansione: solo se la scheda non la dice (la scrive anche chi tiene l'organico, a parole sue).
  if (l.mansione && !s.role_description) {
    const m = l.mansione.charAt(0).toUpperCase() + l.mansione.slice(1).toLowerCase();
    aggiungi({ campo: 'role_description', label: 'Mansione', prima: '—', dopo: m, valori: { role_description: m } }, true);
  }

  // Cessazione: la data di fine vera (regola dei documenti dello studio).
  if (t === 'cessazione' && l.dataCessazione) {
    const prima = s.data_cessazione || s.termination_date || null;
    if ((prima || '').slice(0, 10) !== l.dataCessazione) {
      aggiungi({ campo: 'data_cessazione', label: 'Cessazione', prima: fmtData(prima), dopo: fmtData(l.dataCessazione), valori: { data_cessazione: l.dataCessazione, termination_date: l.dataCessazione } }, !prima);
    }
  }

  const riempimenti = campi.filter((c) => c.riempimento);
  const sostituzioni = campi.filter((c) => !c.riempimento);
  const decorrenza = futuro ? l.decorrenza : null;
  if (!campi.length) {
    return {
      stato: 'allineata', rinviati, decorrenza,
      testo: rinviati.length
        ? `La scheda è allineata a oggi. Dal ${fmtData(l.decorrenza)} cambia: ${rinviati.map((c) => `${c.label.toLowerCase()} ${c.dopo}`).join(', ')}.`
        : 'Letto: la scheda dice già quello che dice il documento.',
    };
  }
  return {
    stato: 'da_scrivere', riempimenti, sostituzioni, rinviati, decorrenza,
    testo: sostituzioni.length
      ? `Il documento cambia ${sostituzioni.length === 1 ? 'un dato' : `${sostituzioni.length} dati`} della scheda: conferma per allinearla.`
      : `Completati dalla lettura ${riempimenti.length === 1 ? 'un campo vuoto' : `${riempimenti.length} campi vuoti`} della scheda.`,
  };
}

/** Colonne da scrivere sulla scheda per un elenco di campi. */
export function valoriDaScrivere(campi: CampoContratto[]): Record<string, string | number | null> {
  return campi.reduce<Record<string, string | number | null>>((acc, c) => ({ ...acc, ...c.valori }), {});
}

/** Nota datata lasciata in coda alla scheda (regola dei documenti dello studio). */
export function notaContratto(oggi: string, nomeFile: string, l: ContrattoLetto, campi: CampoContratto[]): string {
  const doc = { assunzione: 'lettera di assunzione', proroga: 'proroga', trasformazione: 'trasformazione', modifica_orario: 'modifica d\'orario', cessazione: 'cessazione', altro: 'documento' }[l.tipoDocumento];
  const del = l.dataDocumento ? ` del ${fmtData(l.dataDocumento)}` : '';
  const parti = campi.map((c) => `${c.label.toLowerCase()} ${c.prima} -> ${c.dopo}`);
  return `[${fmtData(oggi)}] Allineata al documento «${nomeFile}» (${doc}${del}, letto dal gestionale): ${parti.join('; ')}.`;
}
