// ============================================================================
// VISURA CAMERALE → SCHEDA AZIENDA E SEDI
// ============================================================================
// Patrizio, 24/11/2026: i dati della visura (P.IVA, sede legale, sedi operative
// e il resto) fanno parte della scheda iniziale del gestionale, e «prima hai
// sbagliato tra la partita di Zago e quella di New Zago».
//
// Qui c'è solo logica pura (nessuna chiamata al database), così si prova coi
// test. Le regole:
//   1. La visura deve essere DI QUESTA azienda: P.IVA uguale a
//      companies.vat_number, altrimenti si blocca tutto e non si scrive niente.
//      Lo stesso controllo lo fa il database (migration 460).
//   2. Un campo vuoto, con un segnaposto («XXXXXXX») o scritto da una visura
//      precedente si aggiorna da solo.
//   3. Un campo scritto a mano e diverso dalla visura si sostituisce solo con
//      la conferma di chi carica.
//   4. Differenze di sola forma (maiuscole, accenti, punteggiatura, un refuso
//      di una lettera nell'indirizzo) non contano: resta quello che c'è.
// ============================================================================

export type UnitaLocaleLetta = {
  numero: string | null;
  tipo: string | null;
  insegna: string | null;
  indirizzo: string | null;
  cap: string | null;
  comune: string | null;
  provincia: string | null;
  rea: string | null;
  dataApertura: string | null;
};

export type VisuraLetta = {
  dataEstrazione: string | null;
  ragioneSociale: string | null;
  partitaIva: string | null;
  codiceFiscale: string | null;
  formaGiuridica: string | null;
  rea: string | null;
  sedeLegale: { indirizzo: string | null; cap: string | null; comune: string | null; provincia: string | null };
  pec: string | null;
  capitaleSottoscritto: number | null;
  capitaleVersato: number | null;
  dataCostituzione: string | null;
  ateco: { codice: string | null; descrizione: string | null };
  amministratore: { nome: string | null; carica: string | null; codiceFiscale: string | null };
  soci: { nome: string | null; codiceFiscale: string | null; quotaPct: number | null }[];
  unitaLocali: UnitaLocaleLetta[];
};

export type Socio = { nome: string; ruolo: string; quota: string; codice_fiscale?: string | null };

/** Campi testuali della scheda (company_settings) che la visura può scrivere. */
export const CAMPI_SCHEDA = [
  'ragione_sociale', 'forma_giuridica', 'partita_iva', 'codice_fiscale', 'rea',
  'sede_legale', 'sede_indirizzo', 'sede_cap', 'sede_comune', 'sede_provincia',
  'pec', 'capitale_sociale', 'data_costituzione', 'ateco',
  'amministratore', 'amministratore_codice_fiscale',
] as const;
export type CampoScheda = typeof CAMPI_SCHEDA[number] | 'soci';

export const ETICHETTE_SCHEDA: Record<CampoScheda, string> = {
  ragione_sociale: 'Ragione sociale',
  forma_giuridica: 'Forma giuridica',
  partita_iva: 'P.IVA',
  codice_fiscale: 'Codice fiscale',
  rea: 'REA',
  sede_legale: 'Sede legale',
  sede_indirizzo: 'Sede legale: indirizzo',
  sede_cap: 'Sede legale: CAP',
  sede_comune: 'Sede legale: comune',
  sede_provincia: 'Sede legale: provincia',
  pec: 'PEC',
  capitale_sociale: 'Capitale sociale',
  data_costituzione: 'Data di costituzione',
  ateco: 'ATECO',
  amministratore: 'Amministratore',
  amministratore_codice_fiscale: 'CF amministratore',
  soci: 'Soci',
};

export type SchedaAzienda = Partial<Record<typeof CAMPI_SCHEDA[number], string | null>> & {
  soci?: Socio[] | null;
  campi_da_visura?: Record<string, string> | null;
  visura_estratta_il?: string | null;
};

// ─── Normalizzazione e formati ────────────────────────────────────────────

const senzaAccenti = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Forma di confronto: minuscolo, senza accenti, apostrofi e punteggiatura. */
export function chiave(v: string | null | undefined): string {
  return senzaAccenti(String(v ?? '').toLowerCase())
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();
}

/** Vuoto o segnaposto lasciato da un seed («07XXXXXXXXX», «FI-XXXXXX»). */
export function eVuotoOSegnaposto(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s || s === '—' || s === '-') return true;
  return /x{3,}/i.test(s);
}

const ROMANO = /^(X{0,3})(IX|IV|V?I{0,3})$/;

/** «VIA IX FEBBRAIO 7» → «Via IX Febbraio 7»; «BARBERINO DI MUGELLO» → «Barberino di Mugello». */
export function inChiaro(v: string | null | undefined): string {
  const minuscole = new Set(['di', 'de', 'del', 'della', 'dei', 'degli', 'delle', 'e', 'a', 'al', 'alla', 'in', 'da', 'su', 'sul', 'per', 'c/o']);
  return String(v ?? '').trim().split(/\s+/).filter(Boolean).map((w, i) => {
    const up = w.toUpperCase();
    if (up.length > 0 && ROMANO.test(up) && up !== '') return up;
    if (/\d/.test(w)) return up;
    const low = w.toLowerCase();
    if (low === 'snc') return low;
    if (i > 0 && minuscole.has(low)) return low;
    return low.replace(/(^|[-'])([a-zà-ù])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  }).join(' ');
}

const prima = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** «FI - 698232» → «FI-698232». */
export function reaPulito(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^([A-Z]{2})[-/]?(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : (s || null);
}

/** «2024-04-17» → «17/04/2024». */
export function dataInItaliano(iso: string | null | undefined): string | null {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

const euro = (n: number) =>
  `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function formaGiuridicaInChiaro(v: string | null | undefined): string | null {
  const k = chiave(v);
  if (!k) return null;
  if (k.includes('responsabilita limitata') && k.includes('semplificata')) return 'Società a responsabilità limitata semplificata';
  if (k.includes('responsabilita limitata')) return 'Società a responsabilità limitata';
  if (k.includes('per azioni')) return 'Società per azioni';
  if (k.includes('accomandita semplice')) return 'Società in accomandita semplice';
  if (k.includes('nome collettivo')) return 'Società in nome collettivo';
  return prima(String(v).trim().toLowerCase());
}

/** I valori che la visura scriverebbe nella scheda, già nel formato della scheda. */
export function valoriDaVisura(v: VisuraLetta): Partial<Record<CampoScheda, string | Socio[]>> {
  const out: Partial<Record<CampoScheda, string | Socio[]>> = {};
  const put = (k: CampoScheda, val: string | null | undefined) => { if (val && String(val).trim()) out[k] = String(val).trim(); };

  put('ragione_sociale', v.ragioneSociale);
  put('forma_giuridica', formaGiuridicaInChiaro(v.formaGiuridica));
  put('partita_iva', v.partitaIva);
  put('codice_fiscale', v.codiceFiscale);
  put('rea', reaPulito(v.rea));

  const s = v.sedeLegale || { indirizzo: null, cap: null, comune: null, provincia: null };
  if (s.indirizzo && s.comune) {
    put('sede_legale', `${inChiaro(s.indirizzo)}, ${s.cap ? `${s.cap} ` : ''}${inChiaro(s.comune)}${s.provincia ? ` (${s.provincia})` : ''}`);
  }
  put('sede_indirizzo', s.indirizzo?.toUpperCase());
  put('sede_cap', s.cap);
  put('sede_comune', s.comune?.toUpperCase());
  put('sede_provincia', s.provincia?.toUpperCase());

  put('pec', v.pec?.toLowerCase());
  if (v.capitaleSottoscritto != null) {
    const versato = v.capitaleVersato;
    put('capitale_sociale', versato == null || versato === v.capitaleSottoscritto
      ? `${euro(v.capitaleSottoscritto)}${versato === v.capitaleSottoscritto ? ' i.v.' : ''}`
      : `${euro(v.capitaleSottoscritto)} sottoscritto, ${euro(versato)} versato`);
  }
  put('data_costituzione', dataInItaliano(v.dataCostituzione));
  if (v.ateco?.codice) {
    put('ateco', v.ateco.descrizione ? `${v.ateco.codice} – ${prima(v.ateco.descrizione.trim().toLowerCase())}` : v.ateco.codice);
  }
  if (v.amministratore?.nome) {
    put('amministratore', `${v.amministratore.nome.toUpperCase()}${v.amministratore.carica ? ` (${inChiaro(v.amministratore.carica)})` : ''}`);
  }
  put('amministratore_codice_fiscale', v.amministratore?.codiceFiscale);

  const soci = (v.soci || []).filter((x) => x.nome).map<Socio>((x) => ({
    nome: String(x.nome).trim(),
    quota: x.quotaPct != null ? `${x.quotaPct.toLocaleString('it-IT')}%` : '',
    ruolo: x.quotaPct != null && x.quotaPct > 50 ? 'Socio di maggioranza' : 'Socio',
    codice_fiscale: x.codiceFiscale ?? null,
  }));
  if (soci.length) out.soci = soci;
  return out;
}

const chiaveSoci = (soci: Socio[] | null | undefined) =>
  (soci || [])
    .map((s) => `${chiave(s.nome)}|${chiave(String(s.quota).replace('%', ''))}`)
    .sort()
    .join(';');

/** Due soci uguali se nome e quota coincidono e il CF, dove c'è da tutte e due le parti, pure. */
function stessiSoci(a: Socio[] | null | undefined, b: Socio[] | null | undefined): boolean {
  if (chiaveSoci(a) !== chiaveSoci(b)) return false;
  const cf = new Map((a || []).map((s) => [chiave(s.nome), s.codice_fiscale || '']));
  return (b || []).every((s) => !s.codice_fiscale || !cf.get(chiave(s.nome)) || cf.get(chiave(s.nome)) === s.codice_fiscale);
}

// ─── Confronto della scheda ───────────────────────────────────────────────

export type Differenza = { campo: CampoScheda; etichetta: string; attuale: string; nuovo: string };

export type EsitoScheda = {
  /** Motivo del blocco: se valorizzato non si scrive niente. */
  blocco: string | null;
  /** Campi che si scrivono senza chiedere (vuoti, segnaposto, scritti da una visura). */
  automatici: Partial<Record<CampoScheda, string | Socio[]>>;
  /** Campi scritti a mano e diversi dalla visura: serve la conferma. */
  daConfermare: Differenza[];
  uguali: number;
};

const testoSoci = (soci: Socio[] | null | undefined) =>
  (soci || []).map((s) => `${s.nome}${s.quota ? ` ${s.quota}` : ''}`).join(', ') || '—';

export function confrontaScheda(
  attuale: SchedaAzienda | null,
  letta: VisuraLetta,
  azienda: { partitaIva: string | null; nome: string | null },
): EsitoScheda {
  const pivaVisura = (letta.partitaIva || '').replace(/\D/g, '');
  const pivaAzienda = (azienda.partitaIva || '').replace(/\D/g, '');
  const vuoto: EsitoScheda = { blocco: null, automatici: {}, daConfermare: [], uguali: 0 };

  if (!pivaVisura) {
    return { ...vuoto, blocco: 'Nella visura non trovo una partita IVA leggibile: non ho scritto niente.' };
  }
  if (pivaAzienda && pivaVisura !== pivaAzienda) {
    return {
      ...vuoto,
      blocco: `Questa visura è di ${letta.ragioneSociale || 'un\'altra società'} (P.IVA ${pivaVisura}), `
        + `ma questo gestionale è di ${azienda.nome || 'un\'altra azienda'} (P.IVA ${pivaAzienda}). Non ho scritto niente.`,
    };
  }

  const scheda = attuale || {};
  const daVisura = scheda.campi_da_visura || {};
  const precedente = scheda.visura_estratta_il || null;
  // Una visura più vecchia di quella già letta non sovrascrive da sola.
  const piuVecchia = !!(precedente && letta.dataEstrazione && letta.dataEstrazione < precedente);

  const esito: EsitoScheda = { ...vuoto };
  const valori = valoriDaVisura(letta);
  for (const [k, nuovo] of Object.entries(valori) as [CampoScheda, string | Socio[]][]) {
    if (k === 'soci') {
      const cur = scheda.soci || [];
      const nuovi = nuovo as Socio[];
      if (stessiSoci(cur, nuovi)) { esito.uguali++; continue; }
      if (!cur.length || (daVisura.soci && !piuVecchia)) { esito.automatici.soci = nuovi; continue; }
      esito.daConfermare.push({ campo: 'soci', etichetta: ETICHETTE_SCHEDA.soci, attuale: testoSoci(cur), nuovo: testoSoci(nuovi) });
      continue;
    }
    const cur = (scheda as Record<string, unknown>)[k] as string | null | undefined;
    const testo = nuovo as string;
    if (!eVuotoOSegnaposto(cur) && chiave(cur) === chiave(testo)) { esito.uguali++; continue; }
    if (eVuotoOSegnaposto(cur) || (daVisura[k] && !piuVecchia)) { esito.automatici[k] = testo; continue; }
    esito.daConfermare.push({ campo: k, etichetta: ETICHETTE_SCHEDA[k], attuale: String(cur), nuovo: testo });
  }
  return esito;
}

// ─── Sedi operative (unità locali ↔ outlets) ─────────────────────────────

export type OutletSede = {
  id: string;
  code: string | null;
  name: string | null;
  city: string | null;
  address: string | null;
  cap: string | null;
  province: string | null;
  rea: string | null;
  opening_date: string | null;
  is_active: boolean | null;
};

export type CampoSede = 'address' | 'cap' | 'province' | 'rea' | 'opening_date';
export const ETICHETTE_SEDE: Record<CampoSede, string> = {
  address: 'indirizzo', cap: 'CAP', province: 'provincia', rea: 'REA', opening_date: 'data di apertura',
};

export type DifferenzaSede = { outletId: string; negozio: string; campo: CampoSede; attuale: string; nuovo: string };

export type EsitoSedi = {
  automatici: { outletId: string; negozio: string; patch: Partial<Record<CampoSede, string>> }[];
  daConfermare: DifferenzaSede[];
  /** Unità locali della visura senza un negozio nel gestionale. */
  nonNelGestionale: UnitaLocaleLetta[];
  /** Negozi attivi che la visura non riporta (aperti dopo, o da chiudere in Camera di Commercio). */
  nonInVisura: OutletSede[];
};

const TIPI_VIA = /^(via|viale|v le|piazza|p zza|piazzale|corso|largo|strada|localita|loc|frazione|fraz|vicolo)\s+/;

function distanza(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)] as number[]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/** Stesso indirizzo salvo la forma: «Località Pian di Rona 120/B» = «VIA PIAN DI ROMA 120/B». */
export function stessoIndirizzo(a: string | null | undefined, b: string | null | undefined): boolean {
  const pulisci = (s: string | null | undefined) => chiave(s).replace(TIPI_VIA, '').replace(/\s+0$/, '').trim();
  const x = pulisci(a), y = pulisci(b);
  if (!x || !y) return false;
  if (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)) return true;
  return distanza(x, y) <= 2;
}

const stessoComune = (a: string | null | undefined, b: string | null | undefined) => {
  const x = chiave(a), y = chiave(b);
  return !!x && x === y;
};

export function confrontaSedi(outlets: OutletSede[], unita: UnitaLocaleLetta[], dataVisura: string | null): EsitoSedi {
  const esito: EsitoSedi = { automatici: [], daConfermare: [], nonNelGestionale: [], nonInVisura: [] };
  const usati = new Set<string>();

  for (const ul of unita) {
    const candidati = outlets.filter((o) => stessoComune(o.city, ul.comune) && !usati.has(o.id));
    const o = candidati.find((c) => c.is_active !== false && ul.cap && c.cap === ul.cap)
      ?? candidati.find((c) => c.is_active !== false)
      ?? null;
    if (!o) { esito.nonNelGestionale.push(ul); continue; }
    usati.add(o.id);
    const negozio = o.name || o.code || o.city || '';

    const proposte: Partial<Record<CampoSede, string>> = {};
    if (ul.indirizzo) proposte.address = inChiaro(ul.indirizzo);
    if (ul.cap) proposte.cap = ul.cap;
    if (ul.provincia) proposte.province = ul.provincia;
    const rea = reaPulito(ul.rea);
    if (rea) proposte.rea = rea;
    if (ul.dataApertura) proposte.opening_date = ul.dataApertura;

    const patch: Partial<Record<CampoSede, string>> = {};
    for (const [campo, nuovo] of Object.entries(proposte) as [CampoSede, string][]) {
      const cur = o[campo];
      if (eVuotoOSegnaposto(cur)) { patch[campo] = nuovo; continue; }
      const uguale = campo === 'address' ? stessoIndirizzo(cur, nuovo) : chiave(cur) === chiave(nuovo);
      if (uguale) continue;
      esito.daConfermare.push({ outletId: o.id, negozio, campo, attuale: String(cur), nuovo });
    }
    if (Object.keys(patch).length) esito.automatici.push({ outletId: o.id, negozio, patch });
  }

  esito.nonInVisura = outlets.filter((o) =>
    o.is_active !== false && !usati.has(o.id)
    // Un negozio aperto dopo la visura non può esserci: non è una mancanza.
    && !(dataVisura && o.opening_date && o.opening_date > dataVisura));
  return esito;
}
