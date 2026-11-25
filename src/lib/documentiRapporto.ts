// ============================================================================
// DOCUMENTI DEL RAPPORTO: tipo e data letti dal nome del file
// ============================================================================
// Lo studio paghe manda i documenti di un'assunzione in un unico zip, con nomi
// come «2026-11-27_Lignoli_lettera-assunzione-TD-PT.pdf». Chiedere a chi carica
// di scegliere tipo e data per dieci file uno alla volta è un passaggio che il
// programma fa da sé (regola «un caricamento arriva in fondo da solo»).

export const DOC_RAPPORTO_OPTS: { v: string; l: string }[] = [
  { v: 'contratto', l: 'Contratto / lettera di assunzione' },
  { v: 'impegnativa', l: 'Impegnativa di assunzione' },
  { v: 'proroga', l: 'Proroga' },
  { v: 'trasformazione', l: 'Trasformazione' },
  { v: 'modifica_orario', l: 'Modifica orario' },
  { v: 'cessazione', l: 'Cessazione / dimissioni' },
  { v: 'modulo_fiscale', l: 'Modulo fiscale / TFR' },
  { v: 'informativa', l: 'Informativa' },
  { v: 'altro', l: 'Altro documento' },
];

export const docRapportoLabel = (v?: string | null) => DOC_RAPPORTO_OPTS.find((o) => o.v === v)?.l || v || 'Documento';

/** Regole in ordine: la prima che corrisponde decide il tipo. */
const REGOLE_TIPO: [RegExp, string][] = [
  [/impegnativ/, 'impegnativa'],
  [/proroga/, 'proroga'],
  [/trasformazion/, 'trasformazione'],
  [/(modifica|variazione).{0,3}orari/, 'modifica_orario'],
  [/cessazion|dimission|licenziament/, 'cessazione'],
  [/(lettera|contratto).{0,3}(di.)?assunzion|^contratto|assunzione/, 'contratto'],
  [/informativa/, 'informativa'],
  [/detrazion|detassazion|tfr|trattamento.integrativo|dichiarazione.sostitutiva|f24|730|cu\b/, 'modulo_fiscale'],
];

const ISO_RX = /(20\d{2})[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])/;
const IT_RX = /(0[1-9]|[12]\d|3[01])[-_.](0[1-9]|1[0-2])[-_.](20\d{2})/;

/** Data scritta nel nome del file (aaaa-mm-gg oppure gg-mm-aaaa), o null. */
export function dataDalNome(nome: string): string | null {
  const iso = nome.match(ISO_RX);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const it = nome.match(IT_RX);
  if (it) return `${it[3]}-${it[2]}-${it[1]}`;
  return null;
}

const base = (nome: string) => (nome.split('/').pop() || nome).replace(/\.[a-z0-9]+$/i, '');

/** Tipo di documento ricavato dal nome; «altro» se il nome non dice niente. */
export function tipoDalNome(nome: string): string {
  const n = base(nome).toLowerCase().replace(/[_\s]+/g, '-');
  for (const [rx, tipo] of REGOLE_TIPO) if (rx.test(n)) return tipo;
  return 'altro';
}

/**
 * Descrizione leggibile dal nome: tolta la data, il cognome della persona e
 * l'estensione. «2026-11-27_Lignoli_modulo-TFR3.pdf» → «Modulo TFR3».
 */
export function descrizioneDalNome(nome: string, cognome?: string | null): string {
  let s = base(nome).replace(ISO_RX, ' ').replace(IT_RX, ' ');
  if (cognome) {
    const c = cognome.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (c) s = s.replace(new RegExp(`(^|[\\s_-])${c}(?=$|[\\s_-])`, 'ig'), ' ');
  }
  s = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : base(nome);
}

/** La data più frequente fra quelle lette nei nomi di un gruppo di file. */
export function dataDelGruppo(nomi: string[]): string | null {
  const conta = new Map<string, number>();
  for (const n of nomi) {
    const d = dataDalNome(n);
    if (d) conta.set(d, (conta.get(d) || 0) + 1);
  }
  let migliore: string | null = null;
  let max = 0;
  for (const [d, k] of conta) if (k > max || (k === max && migliore !== null && d > migliore)) { migliore = d; max = k; }
  return migliore;
}

/** Oggi a Roma, aaaa-mm-gg. */
export const oggiRoma = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

export type DocumentoRiconosciuto = { tipo: string; data: string; descrizione: string; dataDa: 'nome' | 'gruppo' | 'scelta' | 'oggi' };

/**
 * Tipo, data e descrizione di un file da archiviare.
 * Data: quella del nome; se manca, quella degli altri file dello stesso
 * caricamento; poi quella scelta nel modulo; per ultima oggi.
 * Tipo: quello scelto nel modulo, se non è «auto»; altrimenti dal nome.
 */
export function riconosciDocumento(
  nome: string,
  { tipoScelto = 'auto', dataScelta = '', dataGruppo = null, cognome = null, descrizioneScelta = '' }:
  { tipoScelto?: string; dataScelta?: string; dataGruppo?: string | null; cognome?: string | null; descrizioneScelta?: string } = {},
): DocumentoRiconosciuto {
  const dn = dataDalNome(nome);
  const [data, dataDa]: [string, DocumentoRiconosciuto['dataDa']] = dn ? [dn, 'nome']
    : dataGruppo ? [dataGruppo, 'gruppo']
    : dataScelta ? [dataScelta, 'scelta']
    : [oggiRoma(), 'oggi'];
  return {
    tipo: tipoScelto && tipoScelto !== 'auto' ? tipoScelto : tipoDalNome(nome),
    data,
    descrizione: descrizioneScelta.trim() || descrizioneDalNome(nome, cognome),
    dataDa,
  };
}
