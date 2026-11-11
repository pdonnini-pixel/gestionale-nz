// Stampa dell'«orario della settimana» di un negozio: un foglio A4 orizzontale
// da appendere in negozio o da allegare a una mail.
//
// Libreria pura: riceve i dati già pronti (nessuna lettura dal database) e
// restituisce il documento jsPDF. La grafica è quella approvata dal cliente:
// logo a sinistra, periodo a destra, griglia persone x giorni, chi apre e chi
// chiude in fondo. Nessuna nota su pause, cambi turno o straordinari.
//
// jsPDF viene importato qui in modo statico: chi usa questa libreria da una
// pagina la carichi con `import('../lib/stampaOrario')` al click, come fanno
// gli altri export, così il peso non entra nel caricamento iniziale.

import { jsPDF } from 'jspdf';

// ─── Dati in ingresso ────────────────────────────────────────────────────────

export interface TurnoStampa {
  /** Ora di inizio, HH:MM. */
  inizio: string;
  /** Ora di fine, HH:MM. */
  fine: string;
  /** Pausa non pagata, in minuti (0 = nessuna pausa). */
  pausaMinuti: number;
  /** Ore di straordinario dentro questo turno, se ce ne sono. */
  oreStraordinario?: number;
}

export interface GiornoStampa {
  /** Data del giorno, YYYY-MM-DD. */
  data: string;
  /** false = giorno della settimana che cade nel mese prima o dopo: colonna grigia vuota. */
  nelMese: boolean;
  chiuso: boolean;
  apre: string | null;
  chiude: string | null;
  /** Nome dell'evento del giorno (es. «Black Friday»). */
  evento?: string | null;
}

export interface PersonaStampa {
  /** «Cognome Nome». */
  nome: string;
  ruolo?: 'responsabile' | 'vice' | null;
  /** Ore di contratto a settimana. */
  oreSettimana: number | null;
  /** Turni per data (YYYY-MM-DD). Di solito uno al giorno. */
  turni: Record<string, TurnoStampa[]>;
  /** Motivo dell'assenza per data (es. 'ferie'): sostituisce «riposo». */
  assenze?: Record<string, string>;
}

export interface OrarioStampa {
  /** 'newzago' disegna il logo; 'testo' scrive il nome dell'azienda. */
  marchio: 'newzago' | 'testo';
  azienda: string;
  negozio: string;
  /** I 7 giorni da lunedì a domenica. */
  giorni: GiornoStampa[];
  persone: PersonaStampa[];
  /** Data di pubblicazione del piano (YYYY-MM-DD); senza, il foglio è una bozza. */
  pubblicatoIl?: string | null;
  /** Data di oggi (YYYY-MM-DD), usata per la dicitura «Bozza del». */
  oggi: string;
}

// ─── Date e numeri ───────────────────────────────────────────────────────────

const MESI = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];
const GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
const GIORNI_BREVI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const TRATTINO = '–';

interface DataSpezzata { anno: number; mese: number; giorno: number }

function spezzaData(data: string): DataSpezzata {
  return {
    anno: Number(data.slice(0, 4)),
    mese: Number(data.slice(5, 7)),
    giorno: Number(data.slice(8, 10)),
  };
}

/** Giorno della settimana, 0 = lunedì … 6 = domenica (senza fusi orari di mezzo). */
function indiceGiorno(data: string): number {
  const { anno, mese, giorno } = spezzaData(data);
  return (new Date(Date.UTC(anno, mese - 1, giorno)).getUTCDay() + 6) % 7;
}

/** Numero della settimana ISO (la settimana 1 è quella con il primo giovedì dell'anno). */
export function numeroSettimana(data: string): number {
  const { anno, mese, giorno } = spezzaData(data);
  const d = new Date(Date.UTC(anno, mese - 1, giorno));
  // Si va al giovedì della stessa settimana: il suo anno è l'anno ISO.
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const primoGennaio = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - primoGennaio) / (7 * 86400000)) + 1;
}

/** I giorni da mostrare davvero: quelli del mese (tutti, se nessuno è marcato). */
function giorniMostrati(giorni: GiornoStampa[]): GiornoStampa[] {
  const dentro = giorni.filter((g) => g.nelMese);
  return dentro.length > 0 ? dentro : giorni;
}

/** «23 – 29 novembre 2026», «30 novembre 2026»: conta solo i giorni del mese. */
export function titoloPeriodo(giorni: GiornoStampa[]): string {
  const mostrati = giorniMostrati(giorni);
  if (mostrati.length === 0) return '';
  const a = spezzaData(mostrati[0].data);
  const b = spezzaData(mostrati[mostrati.length - 1].data);
  const fine = `${b.giorno} ${MESI[b.mese - 1]} ${b.anno}`;
  if (mostrati.length === 1 || mostrati[0].data === mostrati[mostrati.length - 1].data) return fine;
  if (a.anno !== b.anno) return `${a.giorno} ${MESI[a.mese - 1]} ${a.anno} ${TRATTINO} ${fine}`;
  if (a.mese !== b.mese) return `${a.giorno} ${MESI[a.mese - 1]} ${TRATTINO} ${fine}`;
  return `${a.giorno} ${TRATTINO} ${fine}`;
}

/** Nome del file: 'orario-roma-soratte-2026-11-23.pdf' (primo giorno mostrato). */
export function nomeFileOrario(dati: OrarioStampa): string {
  const negozio = dati.negozio
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const primo = giorniMostrati(dati.giorni)[0]?.data ?? dati.oggi;
  return ['orario', negozio, primo.slice(0, 10)].filter((p) => p !== '').join('-') + '.pdf';
}

/** Numero all'italiana: virgola e niente decimali inutili (7,5 · 8 · 0). */
export function formattaOre(ore: number): string {
  return String(Math.round(ore * 100) / 100).replace('.', ',');
}

/** 'HH:MM' anche quando arriva '9:00' o '10:00:00'. */
function oraPulita(ora: string): string {
  const [h, m] = ora.trim().split(':');
  return `${(h ?? '0').padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`;
}

function minuti(ora: string): number {
  const p = oraPulita(ora);
  return Number(p.slice(0, 2)) * 60 + Number(p.slice(3, 5));
}

/** Ore lavorate di un turno: la pausa non è lavoro e non si conta. */
export function oreTurno(turno: TurnoStampa): number {
  return Math.max(0, minuti(turno.fine) - minuti(turno.inizio) - (turno.pausaMinuti || 0)) / 60;
}

/** «pausa 30'», «pausa 1 h»; stringa vuota senza pausa. La pausa ha solo la durata. */
export function etichettaPausa(pausaMinuti: number): string {
  if (!pausaMinuti || pausaMinuti <= 0) return '';
  const h = Math.floor(pausaMinuti / 60);
  const m = pausaMinuti % 60;
  if (h === 0) return `pausa ${m}'`;
  return m === 0 ? `pausa ${h} h` : `pausa ${h} h ${m}'`;
}

/** Seconda riga della cella: «7,5 ore · pausa 30'». */
export function dettaglioTurno(turno: TurnoStampa): string {
  const ore = oreTurno(turno);
  const pausa = etichettaPausa(turno.pausaMinuti);
  return `${formattaOre(ore)} ${ore === 1 ? 'ora' : 'ore'}${pausa ? ` · ${pausa}` : ''}`;
}

// ─── Totali, chi apre e chi chiude ───────────────────────────────────────────

function giornoContato(g: GiornoStampa): boolean {
  return g.nelMese && !g.chiuso;
}

/** Ore lavorate e di straordinario della persona nei giorni mostrati sul foglio. */
export function totaliPersona(
  persona: PersonaStampa,
  giorni: GiornoStampa[],
): { ore: number; straordinario: number } {
  let ore = 0;
  let straordinario = 0;
  for (const g of giorni) {
    if (!giornoContato(g)) continue;
    for (const t of persona.turni[g.data] ?? []) {
      ore += oreTurno(t);
      straordinario += t.oreStraordinario ?? 0;
    }
  }
  return { ore: Math.round(ore * 100) / 100, straordinario: Math.round(straordinario * 100) / 100 };
}

/**
 * Cognome da scrivere nelle righe «apre» e «chiude»: la prima parola del nome
 * («Cognome Nome»). Se due persone del negozio la condividono, il nome intero.
 */
export function cognomiPerStampa(persone: PersonaStampa[]): string[] {
  const primi = persone.map((p) => p.nome.trim().split(/\s+/)[0] ?? '');
  return persone.map((p, i) =>
    primi.filter((x) => x.toLowerCase() === primi[i].toLowerCase()).length > 1 ? p.nome.trim() : primi[i],
  );
}

function chiHaTurno(
  giorno: GiornoStampa,
  persone: PersonaStampa[],
  ora: string | null,
  campo: 'inizio' | 'fine',
): string[] {
  if (!giornoContato(giorno) || !ora) return [];
  const cognomi = cognomiPerStampa(persone);
  const cercata = oraPulita(ora);
  return persone
    .map((p, i) => ((p.turni[giorno.data] ?? []).some((t) => oraPulita(t[campo]) === cercata) ? cognomi[i] : null))
    .filter((c): c is string => c !== null);
}

/** Chi ha il turno che comincia all'apertura di quel giorno. */
export function chiApre(giorno: GiornoStampa, persone: PersonaStampa[]): string[] {
  return chiHaTurno(giorno, persone, giorno.apre, 'inizio');
}

/** Chi ha il turno che finisce alla chiusura di quel giorno. */
export function chiChiude(giorno: GiornoStampa, persone: PersonaStampa[]): string[] {
  return chiHaTurno(giorno, persone, giorno.chiude, 'fine');
}

/** Orario del negozio se è lo stesso in tutti i giorni aperti mostrati, altrimenti null. */
export function orarioUnico(giorni: GiornoStampa[]): { apre: string; chiude: string } | null {
  const aperti = giorni.filter((g) => giornoContato(g) && g.apre && g.chiude);
  if (aperti.length === 0) return null;
  const apre = oraPulita(aperti[0].apre ?? '');
  const chiude = oraPulita(aperti[0].chiude ?? '');
  const tuttiUguali = aperti.every((g) => oraPulita(g.apre ?? '') === apre && oraPulita(g.chiude ?? '') === chiude);
  return tuttiUguali ? { apre, chiude } : null;
}

/**
 * Riga grigia dell'intestazione. Orario unico: «Negozio aperto dalle 10:00 alle
 * 20:00». Orari diversi: elenco compatto («Aperto lun-gio 10:00-20:00 · ven-dom
 * 9:00-21:00»); se servono più di tre gruppi non si scrive niente (null).
 */
export function testoApertura(giorni: GiornoStampa[]): string | null {
  const unico = orarioUnico(giorni);
  if (unico) return `Negozio aperto dalle ${unico.apre} alle ${unico.chiude}`;
  const gruppi: { da: string; a: string; orario: string }[] = [];
  let attaccabile = false;
  for (const g of giorni) {
    if (!giornoContato(g) || !g.apre || !g.chiude) {
      attaccabile = false;
      continue;
    }
    const orario = `${oraPulita(g.apre)}-${oraPulita(g.chiude)}`;
    const breve = GIORNI_BREVI[indiceGiorno(g.data)];
    const ultimo = gruppi[gruppi.length - 1];
    if (attaccabile && ultimo && ultimo.orario === orario) ultimo.a = breve;
    else gruppi.push({ da: breve, a: breve, orario });
    attaccabile = true;
  }
  if (gruppi.length === 0 || gruppi.length > 3) return null;
  return 'Aperto ' + gruppi.map((x) => `${x.da === x.a ? x.da : `${x.da}-${x.a}`} ${x.orario}`).join(' · ');
}

/** «Pubblicato il 12/11/2026», «Pubblicato l'11/11/2026», «Bozza del…», «Bozza dell'11/11/2026». */
export function testoPiede(dati: Pick<OrarioStampa, 'pubblicatoIl' | 'oggi'>): string {
  const pubblicato = Boolean(dati.pubblicatoIl);
  const { anno, mese, giorno } = spezzaData((dati.pubblicatoIl || dati.oggi).slice(0, 10));
  const data = `${String(giorno).padStart(2, '0')}/${String(mese).padStart(2, '0')}/${anno}`;
  // Davanti a 1, 8 e 11 l'articolo si elide («l'11», «dell'8»).
  const elisione = giorno === 1 || giorno === 8 || giorno === 11;
  if (pubblicato) return elisione ? `Pubblicato l'${data}` : `Pubblicato il ${data}`;
  return elisione ? `Bozza dell'${data}` : `Bozza del ${data}`;
}

// ─── Impaginazione ───────────────────────────────────────────────────────────

type Rgb = [number, number, number];
const NERO: Rgb = [0, 0, 0];
const BIANCO: Rgb = [255, 255, 255];
const ROSA: Rgb = [255, 0, 102]; // #ff0066
const ROSA_SCURO: Rgb = [214, 0, 79]; // #d6004f
const ROSA_CHIARO: Rgb = [255, 240, 246]; // #fff0f6
const GRIGIO: Rgb = [85, 85, 85]; // #555
const GRIGIO_RIPOSO: Rgb = [154, 154, 154]; // #9a9a9a
const GRIGIO_FUORI: Rgb = [181, 181, 181]; // #b5b5b5
const GRIGIO_RIGA: Rgb = [207, 207, 207]; // #cfcfcf
const GRIGIO_FONDO: Rgb = [245, 245, 245]; // #f5f5f5

// Misure in millimetri, prese dal mock-up approvato (A4 orizzontale 297x210).
const MARGINE_SX = 13;
const MARGINE_DX = 284;
const LARGH = MARGINE_DX - MARGINE_SX;
const COL_PERSONA = 41;
const COL_ORE = 21;
const LOGO_Y = 12.9;
const LOGO_H = 11;
const FILETTO_Y = 37.6;
const FILETTO_H = 1.2;
const TABELLA_Y = 43.8;
const TESTATA_H = 14.4;
const TESTATA_EVENTO_H = 19.8;
const RIGA_H = 20.5;
const RIGA_RUOLO_H = 22.3;
const BLOCCO_TURNO_H = 9.2;
const BLOCCO_STRAORD_H = 13;
const STACCO_TURNI = 1.3;
const PIEDE_RIGA_H = 8.7;
const PIEDE_INTERLINEA = 3.7;
/** Righe di nomi al massimo in una cella di «apre» e «chiude». */
const PIEDE_RIGHE_MAX = 3;
const FONDO_TABELLA = 193;
const PIEDE_Y = 199;
/** Sotto questa riduzione le righe non si leggono più: si va su un'altra pagina. */
const RIDUZIONE_MINIMA = 0.7;

interface StileTesto {
  size: number;
  bold?: boolean;
  colore?: Rgb;
  /** Spaziatura fra le lettere, in em (come `letter-spacing` del mock-up). */
  spazio?: number;
  destra?: boolean;
  /** Larghezza massima: se il testo non ci sta, il corpo si riduce. */
  maxL?: number;
}

const PT_MM = 25.4 / 72;

function larghezza(doc: jsPDF, testo: string, size: number, bold: boolean, spazio: number): number {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  return doc.getTextWidth(testo) + spazio * size * PT_MM * Math.max(0, testo.length - 1);
}

/** Scrive una riga di testo e restituisce la larghezza occupata. */
function scrivi(doc: jsPDF, testo: string, x: number, y: number, stile: StileTesto): number {
  if (testo === '') return 0;
  const bold = stile.bold ?? false;
  const spazio = stile.spazio ?? 0;
  let size = stile.size;
  let l = larghezza(doc, testo, size, bold, spazio);
  if (stile.maxL && l > stile.maxL) {
    size = Math.max(4, (size * stile.maxL) / l);
    l = larghezza(doc, testo, size, bold, spazio);
  }
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const [r, g, b] = stile.colore ?? NERO;
  doc.setTextColor(r, g, b);
  doc.text(testo, stile.destra ? x - l : x, y, { charSpace: spazio * size * PT_MM });
  return l;
}

function riempi(doc: jsPDF, x: number, y: number, l: number, h: number, colore: Rgb): void {
  doc.setFillColor(colore[0], colore[1], colore[2]);
  doc.rect(x, y, l, h, 'F');
}

function linea(doc: jsPDF, y: number, spessore: number, colore: Rgb): void {
  riempi(doc, MARGINE_SX, y - spessore / 2, LARGH, spessore, colore);
}

/** Manda a capo un elenco di nomi separati da virgola dentro la larghezza della colonna. */
function righeNomi(doc: jsPDF, nomi: string[], size: number, maxL: number): string[] {
  if (nomi.length === 0) return [TRATTINO];
  const tutte = aCapo(doc, nomi, size, maxL);
  if (tutte.length <= PIEDE_RIGHE_MAX) return tutte;
  // Troppi nomi per la cella: si tengono i primi e si dice quanti ne mancano,
  // così le due righe in fondo non rubano il posto ai turni.
  for (let tenuti = nomi.length - 1; tenuti > 0; tenuti--) {
    const accorciata = aCapo(doc, [...nomi.slice(0, tenuti), `e altri ${nomi.length - tenuti}`], size, maxL, true);
    if (accorciata.length <= PIEDE_RIGHE_MAX) return accorciata;
  }
  return [`${nomi.length} persone`];
}

function aCapo(doc: jsPDF, nomi: string[], size: number, maxL: number, codaSenzaVirgola = false): string[] {
  if (codaSenzaVirgola && nomi.length > 1) {
    // «Rossi, Bianchi e altri 3»: niente virgola prima della coda.
    const coda = nomi[nomi.length - 1];
    const ultimo = nomi[nomi.length - 2];
    const righe = aCapo(doc, [...nomi.slice(0, -2), `${ultimo} `], size, maxL);
    const attaccata = `${righe[righe.length - 1].replace(/ $/, '')} ${coda}`;
    righe[righe.length - 1] = righe[righe.length - 1].replace(/ $/, '');
    if (larghezza(doc, attaccata, size, false, 0) <= maxL) righe[righe.length - 1] = attaccata;
    else righe.push(coda);
    return righe;
  }
  const righe: string[] = [];
  let corrente = '';
  nomi.forEach((nome, i) => {
    const pezzo = i < nomi.length - 1 ? `${nome},` : nome;
    const prova = corrente ? `${corrente} ${pezzo}` : pezzo;
    if (corrente && larghezza(doc, prova, size, false, 0) > maxL) {
      righe.push(corrente);
      corrente = pezzo;
    } else {
      corrente = prova;
    }
  });
  righe.push(corrente);
  return righe;
}

/**
 * Logo New Zago in vettoriale: gli stessi tracciati di public/brand/newzago-logo.svg
 * (viewBox -3 -3 290 46, tratto nero 2.4), così non serve caricare un'immagine.
 */
function disegnaLogo(doc: jsPDF, x0: number, y0: number, altezza: number): void {
  const k = altezza / 46;
  const X = (x: number): number => x0 + (x + 3) * k;
  const Y = (y: number): number => y0 + (y + 3) * k;
  const spezzata = (punti: [number, number][]): void => {
    doc.moveTo(X(punti[0][0]), Y(punti[0][1]));
    for (const [px, py] of punti.slice(1)) doc.lineTo(X(px), Y(py));
    doc.stroke();
  };
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(2.4 * k);
  doc.setLineCap('butt');
  doc.setLineJoin('miter');
  doc.setLineMiterLimit(4); // come l'SVG: gli angoli più stretti della W restano smussati
  spezzata([[0, 40], [0, 0], [28, 40], [28, 0]]); // N
  spezzata([[58, 0], [37, 0], [37, 40], [58, 40]]); // E
  spezzata([[37, 20], [54, 20]]);
  spezzata([[66, 0], [74, 40], [83, 10], [92, 40], [100, 0]]); // W
  spezzata([[120, 0], [148, 0], [120, 40], [148, 40]]); // Z
  spezzata([[156, 40], [170, 0], [184, 40]]); // A
  spezzata([[161, 26], [179, 26]]);
  // G: arco di centro (212,20) e raggio 20, dal punto in alto a destra passando
  // per sinistra fino alla barretta; reso con curve di Bézier da 45 gradi al più.
  const cx = 212;
  const cy = 20;
  const r = 20;
  const a0 = Math.atan2(8.5 - cy, 228.4 - cx);
  const a1 = Math.atan2(23.5 - cy, 231.7 - cx) - 2 * Math.PI;
  const pezzi = 8;
  const passo = (a1 - a0) / pezzi;
  const kappa = (4 / 3) * Math.tan(passo / 4);
  doc.moveTo(X(228.4), Y(8.5));
  for (let i = 0; i < pezzi; i++) {
    const da = a0 + passo * i;
    const a = da + passo;
    const p0x = cx + r * Math.cos(da);
    const p0y = cy + r * Math.sin(da);
    const p3x = i === pezzi - 1 ? 231.7 : cx + r * Math.cos(a);
    const p3y = i === pezzi - 1 ? 23.5 : cy + r * Math.sin(a);
    doc.curveTo(
      X(p0x - kappa * r * Math.sin(da)), Y(p0y + kappa * r * Math.cos(da)),
      X(p3x + kappa * r * Math.sin(a)), Y(p3y - kappa * r * Math.cos(a)),
      X(p3x), Y(p3y),
    );
  }
  doc.lineTo(X(215), Y(23.5));
  doc.stroke();
  doc.circle(X(264), Y(20), r * k, 'S'); // O
}

function maiuscolo(testo: string): string {
  return testo.toLocaleUpperCase('it-IT');
}

function turniDelGiorno(persona: PersonaStampa, giorno: GiornoStampa): TurnoStampa[] {
  return giornoContato(giorno) ? persona.turni[giorno.data] ?? [] : [];
}

/** Altezza naturale della riga di una persona (cresce con il ruolo e con più turni nello stesso giorno). */
function altezzaRiga(persona: PersonaStampa, giorni: GiornoStampa[]): number {
  let h = persona.ruolo ? RIGA_RUOLO_H : RIGA_H;
  for (const g of giorni) {
    const turni = turniDelGiorno(persona, g);
    if (turni.length < 2) continue;
    const blocchi = turni.reduce((a, t) => a + (t.oreStraordinario ? BLOCCO_STRAORD_H : BLOCCO_TURNO_H), 0);
    h = Math.max(h, 2.8 + blocchi + STACCO_TURNI * (turni.length - 1) + 3.2);
  }
  return h;
}

/** Divide le persone in pagine: il meno possibile, in gruppi di dimensione simile. */
function dividiInPagine(altezze: number[], disponibile: number): number[][] {
  const n = altezze.length;
  if (n === 0) return [[]];
  for (let pagine = 1; pagine <= n; pagine++) {
    const gruppi: number[][] = [];
    let da = 0;
    for (let p = 0; p < pagine; p++) {
      const quanti = Math.floor(n / pagine) + (p < n % pagine ? 1 : 0);
      gruppi.push(Array.from({ length: quanti }, (_, i) => da + i));
      da += quanti;
    }
    const ciStanno = gruppi.every(
      (g) => g.reduce((a, i) => a + altezze[i], 0) * RIDUZIONE_MINIMA <= disponibile + 0.001,
    );
    if (ciStanno || pagine === n) return gruppi;
  }
  return [altezze.map((_, i) => i)];
}

/** Quante pagine servono per queste persone (stessa regola usata da `creaPdfOrario`). */
export function pagineOrario(dati: OrarioStampa): number {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  return pianoPagine(doc, dati).gruppi.length;
}

interface PianoPagine {
  colL: number;
  testataH: number;
  apre: string[][];
  chiude: string[][];
  apreH: number;
  chiudeH: number;
  altezze: number[];
  gruppi: number[][];
  riduzione: number;
}

function pianoPagine(doc: jsPDF, dati: OrarioStampa): PianoPagine {
  const { giorni, persone } = dati;
  const colL = (LARGH - COL_PERSONA - COL_ORE) / Math.max(1, giorni.length);
  const conEvento = giorni.some((g) => g.nelMese && g.evento);
  const testataH = conEvento ? TESTATA_EVENTO_H : TESTATA_H;
  const maxNomi = colL - 5;
  const apre = giorni.map((g) => (g.nelMese ? righeNomi(doc, g.chiuso ? [] : chiApre(g, persone), 8.5, maxNomi) : []));
  const chiude = giorni.map((g) => (g.nelMese ? righeNomi(doc, g.chiuso ? [] : chiChiude(g, persone), 8.5, maxNomi) : []));
  const altezzaPiede = (righe: string[][]): number =>
    PIEDE_RIGA_H + PIEDE_INTERLINEA * (Math.max(1, ...righe.map((r) => r.length)) - 1);
  const apreH = altezzaPiede(apre);
  const chiudeH = altezzaPiede(chiude);
  const altezze = persone.map((p) => altezzaRiga(p, giorni));
  const disponibile = FONDO_TABELLA - TABELLA_Y - testataH - apreH - chiudeH;
  const gruppi = dividiInPagine(altezze, disponibile);
  // Una sola riduzione per tutte le pagine, così i fogli dello stesso negozio sono uguali.
  const riduzione = Math.min(
    1,
    ...gruppi.map((g) => {
      const somma = g.reduce((a, i) => a + altezze[i], 0);
      return somma > 0 ? disponibile / somma : 1;
    }),
  );
  return { colL, testataH, apre, chiude, apreH, chiudeH, altezze, gruppi, riduzione: Math.max(0.45, riduzione) };
}

function disegnaIntestazione(doc: jsPDF, dati: OrarioStampa): void {
  if (dati.marchio === 'newzago') {
    disegnaLogo(doc, MARGINE_SX, LOGO_Y, LOGO_H);
  } else {
    scrivi(doc, maiuscolo(dati.azienda), MARGINE_SX, LOGO_Y + LOGO_H - 1.6, { size: 27, maxL: 120 });
  }
  scrivi(doc, maiuscolo(dati.negozio), MARGINE_SX, 31.2, { size: 13, spazio: 0.32, maxL: 125 });

  const primo = giorniMostrati(dati.giorni)[0];
  const settimana = primo ? ` ${numeroSettimana(primo.data)}` : '';
  scrivi(doc, `ORARIO DELLA SETTIMANA${settimana}`, MARGINE_DX, 15.3, {
    size: 9, bold: true, colore: ROSA, spazio: 0.2, destra: true,
  });
  scrivi(doc, titoloPeriodo(dati.giorni), MARGINE_DX, 25.6, { size: 25, destra: true, maxL: 140 });
  const apertura = testoApertura(dati.giorni);
  if (apertura) scrivi(doc, apertura, MARGINE_DX, 31.5, { size: 9, colore: GRIGIO, destra: true, maxL: 140 });
  riempi(doc, MARGINE_SX, FILETTO_Y, LARGH, FILETTO_H, NERO);
}

function disegnaTestata(doc: jsPDF, dati: OrarioStampa, piano: PianoPagine): void {
  const fondo = TABELLA_Y + piano.testataH;
  dati.giorni.forEach((g, i) => {
    const x = MARGINE_SX + COL_PERSONA + piano.colL * i + 2.5;
    const maxL = piano.colL - 4;
    const nome = maiuscolo(GIORNI[indiceGiorno(g.data)]);
    const { mese, giorno } = spezzaData(g.data);
    if (!g.nelMese) {
      // Giorno del mese prima o dopo: niente numero, solo il nome del mese in piccolo.
      scrivi(doc, nome, x, fondo - 9.2, { size: 8, colore: GRIGIO_FUORI, spazio: 0.15, maxL });
      scrivi(doc, maiuscolo(MESI[mese - 1]), x, fondo - 4.1, { size: 8, colore: GRIGIO_FUORI, spazio: 0.15, maxL });
      return;
    }
    const su = g.evento ? 5.3 : 0;
    scrivi(doc, nome, x, fondo - 12.1 - su, { size: 8, colore: GRIGIO, spazio: 0.15, maxL });
    // Sabato e domenica hanno il numero in grassetto.
    scrivi(doc, String(giorno), x, fondo - 4.8 - su, { size: 19, bold: indiceGiorno(g.data) >= 5 });
    if (g.evento) {
      const testo = maiuscolo(g.evento);
      const maxTesto = piano.colL - 2.5 - 2 - 3.2 - 1;
      let size = 6.5;
      let l = larghezza(doc, testo, size, true, 0.08);
      if (l > maxTesto) {
        size = Math.max(4, (size * maxTesto) / l);
        l = larghezza(doc, testo, size, true, 0.08);
      }
      riempi(doc, x + 2, fondo - 7.2, l + 3.2, 3.7, ROSA);
      scrivi(doc, testo, x + 3.6, fondo - 4.55, { size, bold: true, colore: BIANCO, spazio: 0.08 });
    }
  });
  scrivi(doc, 'ORE', MARGINE_DX - 2.5, fondo - 4.2, { size: 8, spazio: 0.15, destra: true });
  linea(doc, fondo, 0.3, NERO);
}

function disegnaRigaPersona(
  doc: jsPDF,
  dati: OrarioStampa,
  piano: PianoPagine,
  persona: PersonaStampa,
  y: number,
  h: number,
): void {
  const s = piano.riduzione;
  const xGiorni = MARGINE_SX + COL_PERSONA;

  // Fondi: prima i colori, poi le scritte.
  dati.giorni.forEach((g, i) => {
    const x = xGiorni + piano.colL * i;
    if (!g.nelMese) {
      riempi(doc, x, y, piano.colL, h, GRIGIO_FONDO);
    } else if (turniDelGiorno(persona, g).some((t) => (t.oreStraordinario ?? 0) > 0)) {
      riempi(doc, x, y, piano.colL, h, ROSA_CHIARO);
      riempi(doc, x, y, 0.9, h, ROSA);
    }
  });

  // Colonna della persona.
  scrivi(doc, persona.nome, MARGINE_SX, y + 7 * s, { size: 12.5 * s, bold: true, maxL: COL_PERSONA - 2.5 });
  let yContratto = y + 12.3 * s;
  if (persona.ruolo) {
    const testo = persona.ruolo === 'responsabile' ? 'RESPONSABILE' : 'VICE RESPONSABILE';
    const size = 6.5 * s;
    const l = larghezza(doc, testo, size, false, 0.12);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.25);
    doc.rect(MARGINE_SX + 0.125, y + 10.4 * s, l + 3.4 * s, 3.7 * s, 'S');
    scrivi(doc, testo, MARGINE_SX + 0.125 + 1.7 * s, y + 13.05 * s, { size, spazio: 0.12 });
    yContratto = y + 18.1 * s;
  }
  if (persona.oreSettimana !== null && persona.oreSettimana !== undefined) {
    scrivi(doc, `${formattaOre(persona.oreSettimana)} ore a settimana`, MARGINE_SX, yContratto, {
      size: 8 * s, colore: GRIGIO,
    });
  }

  // Una cella per giorno.
  dati.giorni.forEach((g, i) => {
    if (!g.nelMese) return;
    const x = xGiorni + piano.colL * i + 2.2;
    const maxL = piano.colL - 3.6;
    const turni = turniDelGiorno(persona, g);
    if (turni.length === 0) {
      // Giorno chiuso, assenza con il suo motivo (es. FERIE) oppure riposo.
      const motivo = g.chiuso ? 'chiuso' : persona.assenze?.[g.data]?.trim() || 'riposo';
      scrivi(doc, maiuscolo(motivo), x, y + 6.2 * s, { size: 9 * s, colore: GRIGIO_RIPOSO, spazio: 0.1, maxL });
      return;
    }
    let yTurno = y;
    for (const t of turni) {
      scrivi(doc, `${oraPulita(t.inizio)} ${TRATTINO} ${oraPulita(t.fine)}`, x, yTurno + 6.5 * s, {
        size: 10.5 * s, bold: true, maxL,
      });
      scrivi(doc, dettaglioTurno(t), x, yTurno + 11.1 * s, { size: 7.5 * s, colore: GRIGIO, maxL });
      const straord = t.oreStraordinario ?? 0;
      if (straord > 0) {
        scrivi(doc, `${formattaOre(straord)} h di straordinario`, x, yTurno + 14.9 * s, {
          size: 7 * s, bold: true, colore: ROSA_SCURO, maxL,
        });
      }
      yTurno += ((straord > 0 ? BLOCCO_STRAORD_H : BLOCCO_TURNO_H) + STACCO_TURNI) * s;
    }
  });

  // Colonna Ore: totale dei giorni mostrati e, sotto, lo straordinario.
  const totali = totaliPersona(persona, dati.giorni);
  scrivi(doc, formattaOre(totali.ore), MARGINE_DX - 2.2, y + 8.2 * s, { size: 15 * s, destra: true });
  if (totali.straordinario > 0) {
    scrivi(doc, `${formattaOre(totali.straordinario)} straord.`, MARGINE_DX - 2.2, y + 12.5 * s, {
      size: 7 * s, bold: true, colore: ROSA_SCURO, destra: true,
    });
  }
  linea(doc, y + h, 0.2, GRIGIO_RIGA);
}

function disegnaRigaPiede(
  doc: jsPDF,
  dati: OrarioStampa,
  piano: PianoPagine,
  etichetta: string,
  righe: string[][],
  y: number,
  h: number,
): void {
  const xGiorni = MARGINE_SX + COL_PERSONA;
  dati.giorni.forEach((g, i) => {
    if (!g.nelMese) riempi(doc, xGiorni + piano.colL * i, y, piano.colL, h, GRIGIO_FONDO);
  });
  scrivi(doc, etichetta, MARGINE_SX, y + h / 2 + 0.95, {
    size: 7.5, colore: GRIGIO, spazio: 0.08, maxL: COL_PERSONA - 2,
  });
  dati.giorni.forEach((g, i) => {
    if (!g.nelMese) return;
    const nomi = righe[i];
    const primo = y + h / 2 - (PIEDE_INTERLINEA * (nomi.length - 1)) / 2 + 1.05;
    nomi.forEach((riga, k) => {
      scrivi(doc, riga, xGiorni + piano.colL * i + 2.5, primo + PIEDE_INTERLINEA * k, {
        size: 8.5, maxL: piano.colL - 3.5,
      });
    });
  });
  linea(doc, y + h, 0.2, GRIGIO_RIGA);
}

/**
 * Crea il PDF dell'orario della settimana. Con tante persone le righe si
 * stringono; se non basta si continua su altre pagine, ognuna con la sua
 * intestazione, la testata dei giorni e le righe di chi apre e chi chiude.
 */
export function creaPdfOrario(dati: OrarioStampa): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const piano = pianoPagine(doc, dati);
  const unico = orarioUnico(dati.giorni);
  const piede = testoPiede(dati);

  piano.gruppi.forEach((gruppo, pagina) => {
    if (pagina > 0) doc.addPage('a4', 'landscape');
    disegnaIntestazione(doc, dati);
    disegnaTestata(doc, dati, piano);
    let y = TABELLA_Y + piano.testataH;
    for (const i of gruppo) {
      const h = piano.altezze[i] * piano.riduzione;
      disegnaRigaPersona(doc, dati, piano, dati.persone[i], y, h);
      y += h;
    }
    // L'ora si scrive nell'etichetta solo se è la stessa tutti i giorni.
    disegnaRigaPiede(doc, dati, piano, unico ? `APRE ALLE ${unico.apre}` : 'APRE', piano.apre, y, piano.apreH);
    y += piano.apreH;
    disegnaRigaPiede(doc, dati, piano, unico ? `CHIUDE ALLE ${unico.chiude}` : 'CHIUDE', piano.chiude, y, piano.chiudeH);

    // Nel piè di pagina c'è solo la data: nessuna nota, per scelta del cliente.
    scrivi(doc, piede, MARGINE_DX, PIEDE_Y, { size: 8, colore: GRIGIO, destra: true });
  });

  doc.setProperties({ title: `Orario ${dati.negozio} ${TRATTINO} ${titoloPeriodo(dati.giorni)}` });
  return doc;
}
