// Lettore del tabulato "Situazione ratei di ferie e permessi - Quantita"
// prodotto da Paghe Infinity e pubblicato ogni mese dallo studio paghe.
//
// PERCHE' ESISTE: il gestionale non calcola la maturazione di ferie e
// permessi, la legge da questo documento. E' l'unica fonte che sa davvero
// quante ore ha in tasca ciascuno, e porta anche il monte ore contrattuale
// di ogni persona (vedi oreSettimanaliDaRateo).
//
// COM'E' FATTO IL DOCUMENTO
//   Intestazione:  "Situazione ratei di ferie e permessi - Quantita"
//                  "Periodo di elaborazione: Agosto 2026"
//                  "Azienda: 071041 NEW ZAGO SRL"
//   Poi un blocco per persona:
//                  "0000003 FELICI SILVIA Ass. 10/06/2024 [Cess. 30/06/2026]"
//                  "F01 Ferie        H  173,00 12  ...numeri..."
//                  "F02 Perm.Ex-Fs   H   32,00 12  ...numeri..."
//                  "F03 Permessi     H   28,00 12  ...numeri..."   (solo oltre i 2 anni)
//                  "______ Totali       ...numeri..."
//   In fondo al documento un blocco "Totali ditta" con le stesse tre voci:
//   serve a dimostrare che la lettura e' completa, senza fidarsi del parser.
//
// COME SI LEGGE: le colonne non hanno separatori, e i numeri sono allineati
// a destra. Le posizioni si ricavano dalle INTESTAZIONI stampate su ogni
// pagina (Residuo, Goduto, Saldo, Maturato, ...): ogni numero appartiene
// all'intestazione piu' vicina alla sua sinistra. Cosi' se lo studio cambia
// impaginazione o aggiunge una colonna (per esempio il codice fiscale, che
// gli abbiamo chiesto), il lettore non si rompe: ricalibra da solo.

import type { PdfItem } from './pdfText';

export type RateoVoce = 'F01' | 'F02' | 'F03';

/** Etichette delle tre voci, come le chiama lo studio paghe. */
export const VOCI: Record<RateoVoce, string> = {
  F01: 'Ferie',
  F02: 'Permessi ex festività',
  F03: 'Permessi ROL',
};

// Coefficiente del rateo annuo di ferie: ore settimanali x 4,325.
// Verificato sui 12 valori distinti del tabulato di agosto 2026
// (173,00 = 40 ore, 151,37 = 35, 129,75 = 30, 34,60 = 8).
// DEDOTTO, non confermato dallo studio: finché non arriva la conferma il
// valore va mostrato come tale. Stesso numero nella funzione SQL
// public.leave_ore_settimanali_da_rateo (migration 245): se cambia, cambia
// in tutti e due i posti.
export const RATEO_FERIE_PER_ORA_SETTIMANALE = 4.325;

/** Orario settimanale ricavato dal rateo annuo di ferie. */
export function oreSettimanaliDaRateo(rateoAnnuo: number | null): number | null {
  if (rateoAnnuo == null || !(rateoAnnuo > 0)) return null;
  return Math.round((rateoAnnuo / RATEO_FERIE_PER_ORA_SETTIMANALE) * 100) / 100;
}

/** Ore di una giornata piena: orario settimanale diviso cinque. */
export function oreGiornataDaRateo(rateoAnnuo: number | null): number | null {
  const sett = oreSettimanaliDaRateo(rateoAnnuo);
  if (sett == null) return null;
  return Math.round((sett / 5) * 100) / 100;
}

export type RateoValori = {
  rateoAnnuo: number | null;
  mesi: number | null;
  residuoPrec: number | null;
  godutoPrec: number | null;
  saldoPrec: number | null;
  maturato: number | null;
  goduto: number | null;
  saldoCorso: number | null;
  residuo: number | null;
  daMaturare: number | null;
  daFruire: number | null;
  /**
   * DUE CONTATORI INTERNI DEL PROGRAMMA DELLE PAGHE: si leggono e si
   * conservano, ma NON si guardano e non entrano in nessun calcolo.
   * Francesca Signorini (studio paghe), 23/09/2026: «ti chiedo di non
   * guardarle, sono contatori interni del programma. Le ferie non scadono.»
   * Restano salvati perche' stanno nel documento e buttarli sarebbe perdere
   * un dato; usarli sarebbe peggio.
   */
  nonIndennizzabile: number | null;
  /** Vedi sopra: contatore interno, da non usare. */
  daGodereAnno: number | null;
};

export type RateoRow = RateoValori & {
  matricola: string | null;
  nominativo: string;
  dataAssunzione: string | null; // ISO
  dataCessazione: string | null; // ISO
  voce: RateoVoce;
  voceLabel: string;
  unita: string | null;
};

export type RateiQuadratura = {
  voce: RateoVoce;
  campo: 'residuo' | 'daFruire';
  somma: number;
  dichiarato: number;
  scarto: number;
};

export type RateiParsed = {
  aziendaCodice: string | null;
  aziendaNome: string | null;
  periodo: { anno: number; mese: number } | null;
  righe: RateoRow[];
  /** Blocco "Totali ditta" in fondo al documento, voce per voce. */
  totaliDitta: Partial<Record<RateoVoce, RateoValori>>;
  /** Confronto fra la somma delle righe lette e i totali dichiarati. */
  quadratura: RateiQuadratura[];
  quadraturaOk: boolean;
  avvisi: string[];
};

// ---------------------------------------------------------------------------
// Utilità di lettura
// ---------------------------------------------------------------------------

const MESI: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

/** "1.114,52147" -> 1114.52147, "-2,18750" -> -2.1875, "12" -> 12 */
export function parseRateoNum(v: string): number | null {
  const s = v.trim();
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "10/06/2024" -> "2024-06-10" */
function toIso(d: string | undefined | null): string | null {
  if (!d) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

type Token = { str: string; x: number };
type Line = { y: number; items: PdfItem[]; tokens: Token[]; text: string };

/**
 * Spezza un item in parole, stimando la X di ognuna.
 * Serve perché pdfjs restituisce più valori in un item solo: il rateo annuo
 * e i mesi arrivano insieme come "173,00 12". Senza spezzarli, due colonne
 * diverse finirebbero nella stessa.
 */
function tokenizza(it: PdfItem): Token[] {
  const parti = it.str.split(/\s+/).filter((s) => s !== '');
  if (parti.length <= 1) return parti.length ? [{ str: parti[0], x: it.x }] : [];
  const larghezza = it.w ?? 0;
  const totale = it.str.length || 1;
  let offset = 0;
  const out: Token[] = [];
  for (const p of parti) {
    const i = it.str.indexOf(p, offset);
    out.push({ str: p, x: it.x + (larghezza * (i >= 0 ? i : offset)) / totale });
    offset = (i >= 0 ? i : offset) + p.length;
  }
  return out;
}

/**
 * Raggruppa gli item di una pagina in righe per coordinata Y.
 *
 * Gli item arrivano in coordinate di DISPLAY (extractPdfItemsOriented): il
 * tabulato è stampato in orizzontale su pagina verticale, quindi senza la
 * rotazione applicata gli assi sarebbero scambiati. Qui la Y cresce verso il
 * basso e l'ordine di lettura è Y crescente.
 */
function righeDaItem(items: PdfItem[], tol = 1.5): Line[] {
  const lines: Line[] = [];
  for (const it of items) {
    const l = lines.find((x) => Math.abs(x.y - it.y) <= tol);
    if (l) l.items.push(it);
    else lines.push({ y: it.y, items: [it], tokens: [], text: '' });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.tokens = l.items.flatMap(tokenizza).sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  }
  lines.sort((a, b) => a.y - b.y);
  return lines;
}

type ColKey = keyof RateoValori | 'unita';
type Anchor = { key: ColKey; x: number };

/**
 * Ricava le colonne dalle intestazioni stampate sulla pagina.
 * La riga chiave è quella che porta in fila: Residuo, Goduto, Saldo
 * (esercizio precedente), Maturato, Goduto, Saldo (esercizio in corso),
 * Residuo (totale), Da fruire, Non inden.
 */
function colonneDaIntestazioni(lines: Line[]): Anchor[] {
  const anchors: Anchor[] = [];

  // Riga principale delle colonne.
  const seqAttesa: ColKey[] = [
    'residuoPrec', 'godutoPrec', 'saldoPrec',
    'maturato', 'goduto', 'saldoCorso',
    'residuo',
  ];
  let yRif: number | null = null;
  for (const l of lines) {
    const etichette = l.items.filter((i) => /^(Residuo|Goduto|Saldo|Maturato|Da fruire|Non inden\.?)$/i.test(i.str.trim()));
    if (etichette.length < 5) continue;
    let idx = 0;
    for (const it of etichette) {
      const t = it.str.trim().toLowerCase();
      if (t === 'da fruire') { anchors.push({ key: 'daFruire', x: it.x }); continue; }
      if (t.startsWith('non inden')) { anchors.push({ key: 'nonIndennizzabile', x: it.x }); continue; }
      if (idx < seqAttesa.length) anchors.push({ key: seqAttesa[idx++], x: it.x });
    }
    yRif = l.y;
    break;
  }
  if (!anchors.length || yRif == null) return [];

  // Colonne che stanno su altre righe della stessa intestazione.
  for (const l of lines) {
    if (Math.abs(l.y - yRif) > 30) continue;
    for (const it of l.items) {
      const t = it.str.trim();
      if (/^TP$/i.test(t)) anchors.push({ key: 'unita', x: it.x });
      else if (/^annuo$/i.test(t)) anchors.push({ key: 'rateoAnnuo', x: it.x });
      else if (/^CH$/i.test(t)) anchors.push({ key: 'mesi', x: it.x });
      else if (/^(Maturab\.?|Spett\.?)$/i.test(t)) anchors.push({ key: 'daMaturare', x: it.x });
      else if (/^Da god\.?$/i.test(t)) anchors.push({ key: 'daGodereAnno', x: it.x });
    }
  }

  // Una sola àncora per colonna (la più a sinistra), ordinate per X.
  const perKey = new Map<ColKey, number>();
  for (const a of anchors) {
    const cur = perKey.get(a.key);
    if (cur == null || a.x < cur) perKey.set(a.key, a.x);
  }
  return [...perKey.entries()]
    .map(([key, x]) => ({ key, x }))
    .sort((a, b) => a.x - b.x);
}

/** Assegna i numeri di una riga alle colonne: vince l'àncora più vicina a sinistra. */
function valoriDaRiga(items: Token[], anchors: Anchor[]): RateoValori {
  const out: RateoValori = {
    rateoAnnuo: null, mesi: null, residuoPrec: null, godutoPrec: null, saldoPrec: null,
    maturato: null, goduto: null, saldoCorso: null, residuo: null,
    daMaturare: null, daFruire: null, nonIndennizzabile: null, daGodereAnno: null,
  };
  for (const it of items) {
    const n = parseRateoNum(it.str);
    if (n == null) continue;
    let scelta: Anchor | null = null;
    for (const a of anchors) {
      if (a.x <= it.x + 2) scelta = a;
      else break;
    }
    if (!scelta || scelta.key === 'unita') continue;
    // La prima lettura vince: i totali di riga stampati più a destra non
    // devono sovrascrivere il valore di colonna.
    if (out[scelta.key] == null) out[scelta.key] = scelta.key === 'mesi' ? Math.round(n) : n;
  }
  return out;
}

const RE_PERSONA = /^(\d{4,8})\s+(.+?)\s+Ass\.\s*(\d{2}\/\d{2}\/\d{4})(?:\s*Cess\.\s*(\d{2}\/\d{2}\/\d{4}))?\s*$/;
const RE_VOCE = /^F0([123])\b\s*(.*)$/;

// ---------------------------------------------------------------------------
// Lettura del documento
// ---------------------------------------------------------------------------

/** Riconosce se un PDF è il tabulato dei ratei (prima pagina). */
export function isTabulatoRatei(pages: PdfItem[][]): boolean {
  const prima = pages[0] ?? [];
  const testo = prima.map((i) => i.str).join(' ').toLowerCase();
  return testo.includes('situazione ratei') && testo.includes('ferie');
}

export function parseRatei(pages: PdfItem[][]): RateiParsed {
  const avvisi: string[] = [];
  const righe: RateoRow[] = [];
  const totaliDitta: Partial<Record<RateoVoce, RateoValori>> = {};

  let aziendaCodice: string | null = null;
  let aziendaNome: string | null = null;
  let periodo: { anno: number; mese: number } | null = null;
  let anchors: Anchor[] = [];
  let inTotaliDitta = false;
  // La persona resta "in corso" anche oltre il salto pagina: il blocco di
  // qualcuno può cominciare in fondo a una pagina e finire in cima a quella
  // dopo, ed è così che si perdono le righe.
  let persona: { matricola: string | null; nominativo: string; ass: string | null; cess: string | null } | null = null;

  for (const items of pages) {
    const lines = righeDaItem(items);

    // Le intestazioni sono ristampate su ogni pagina: si ricalibra ogni volta,
    // e se una pagina non le porta si tengono quelle della precedente.
    const nuove = colonneDaIntestazioni(lines);
    if (nuove.length >= 6) anchors = nuove;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const testo = l.text;

      if (!periodo) {
        const mp = /Periodo di elaborazione:?\s*([A-Za-zàèéìòù]+)\s+(\d{4})/i.exec(testo);
        if (mp) {
          const mese = MESI[mp[1].toLowerCase()];
          if (mese) periodo = { anno: Number(mp[2]), mese };
        }
      }
      if (!aziendaCodice) {
        const ma = /Azienda:?\s*(\d{4,8})\s+(.+?)\s*$/i.exec(testo);
        if (ma) { aziendaCodice = ma[1]; aziendaNome = ma[2].trim(); }
      }

      if (/^Totali ditta$/i.test(testo)) { inTotaliDitta = true; persona = null; continue; }

      const mp2 = RE_PERSONA.exec(testo);
      if (mp2) {
        persona = {
          matricola: mp2[1],
          nominativo: mp2[2].trim(),
          ass: toIso(mp2[3]),
          cess: toIso(mp2[4]),
        };
        continue;
      }

      const primo = l.items[0];
      if (!primo || primo.x > 40) continue;
      const mv = RE_VOCE.exec(primo.str.trim());
      if (!mv) continue;

      const valori = valoriDaRiga(l.tokens, anchors);
      const voce = (`F0${mv[1]}`) as RateoVoce;

      if (inTotaliDitta) {
        totaliDitta[voce] = valori;
        continue;
      }
      if (!persona) {
        avvisi.push(`Riga "${primo.str.trim()}" senza intestazione della persona: saltata.`);
        continue;
      }
      const unita = l.tokens.find((t) => /^[A-Z]$/.test(t.str))?.str ?? null;
      // A volte l'unità sta dentro lo stesso item dell'etichetta
      // ("F02 Perm.Ex-Fs H"): non deve finire nel nome della voce.
      const label = mv[2].trim().replace(/\s+H$/, '');
      righe.push({
        matricola: persona.matricola,
        nominativo: persona.nominativo,
        dataAssunzione: persona.ass,
        dataCessazione: persona.cess,
        voce,
        voceLabel: label || VOCI[voce],
        unita,
        ...valori,
      });
    }
  }

  if (!periodo) avvisi.push('Periodo di elaborazione non trovato nel documento.');
  if (!righe.length) avvisi.push('Nessuna riga di ratei letta: il documento non sembra un tabulato ratei.');

  // Quadratura con i totali ditta: è la prova che la lettura è completa.
  const quadratura: RateiQuadratura[] = [];
  for (const voce of ['F01', 'F02', 'F03'] as RateoVoce[]) {
    const tot = totaliDitta[voce];
    if (!tot) continue;
    const mie = righe.filter((r) => r.voce === voce);
    if (!mie.length) continue;
    for (const campo of ['residuo', 'daFruire'] as const) {
      const dichiarato = tot[campo];
      if (dichiarato == null) continue;
      const somma = Math.round(mie.reduce((s, r) => s + (r[campo] ?? 0), 0) * 100) / 100;
      const scarto = Math.round((somma - dichiarato) * 100) / 100;
      quadratura.push({ voce, campo, somma, dichiarato, scarto });
    }
  }
  const quadraturaOk = quadratura.length > 0 && quadratura.every((q) => Math.abs(q.scarto) < 0.02);
  if (quadratura.length && !quadraturaOk) {
    const ko = quadratura.filter((q) => Math.abs(q.scarto) >= 0.02);
    for (const q of ko) {
      avvisi.push(
        `${VOCI[q.voce]}: la somma delle righe lette (${q.somma.toFixed(2)}) non coincide con il totale ditta (${q.dichiarato.toFixed(2)}), differenza ${q.scarto.toFixed(2)} ore.`,
      );
    }
  }
  if (!quadratura.length) avvisi.push('Il documento non porta il blocco "Totali ditta": la lettura non si può verificare.');

  return {
    aziendaCodice, aziendaNome, periodo,
    righe, totaliDitta, quadratura, quadraturaOk, avvisi,
  };
}

// ---------------------------------------------------------------------------
// Aggancio alle persone del gestionale
// ---------------------------------------------------------------------------

export type MatchMetodo = 'matricola_e_nome' | 'nome_e_assunzione' | 'nome' | 'matricola' | 'manuale';

export type DipendenteRif = {
  id: string;
  matricola: string | null;
  nome: string | null;
  cognome: string | null;
  dataAssunzione: string | null;
  isActive: boolean;
  /** Serve per i contratti a chiamata, dove il rateo non dice l'orario. */
  contrattoTipo?: string | null;
};

/**
 * Nel contratto a chiamata il programma delle paghe non puo' stimare la
 * maturazione, quindi fa maturare il rateo PER INTERO: 168,00 ore, come
 * un tempo pieno. Dividerlo per 4,325 darebbe 38,84 ore a settimana, che
 * non sono le ore di nessuno.
 * (Francesca Signorini, studio paghe, 23/09/2026.)
 */
export const eAChiamata = (contratto: string | null | undefined): boolean =>
  (contratto ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'achiamata';

export type Abbinamento = {
  nominativo: string;
  matricola: string | null;
  employeeId: string | null;
  metodo: MatchMetodo | null;
  /** Perché il sistema propone questo abbinamento, o perché non ne propone. */
  nota: string;
  /** true quando serve l'occhio di una persona prima di salvare. */
  daConfermare: boolean;
};

/** Toglie accenti, apostrofi e doppi spazi: "D'ALESSANDRO  Nicolà" -> "DALESSANDRO NICOLA". */
export function normNome(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Abbina una riga del tabulato a un dipendente del gestionale.
 *
 * La matricola da sola NON basta: fra gestionale e paghe differisce su 5
 * persone su 40 (agosto 2026). Quindi si parte dal nome e la matricola fa
 * da conferma, non da chiave. Quando il nome coincide con una persona sola
 * l'abbinamento è sicuro; quando il nome non basta, si propone e si chiede.
 */
export function abbinaDipendente(
  riga: Pick<RateoRow, 'nominativo' | 'matricola' | 'dataAssunzione'>,
  dipendenti: DipendenteRif[],
): Abbinamento {
  const nomeRiga = normNome(riga.nominativo);
  const candidati = dipendenti.filter((d) => {
    const cn = normNome(`${d.cognome ?? ''} ${d.nome ?? ''}`);
    const nc = normNome(`${d.nome ?? ''} ${d.cognome ?? ''}`);
    return cn === nomeRiga || nc === nomeRiga;
  });

  if (candidati.length === 1) {
    const d = candidati[0];
    if (riga.matricola && d.matricola && riga.matricola === d.matricola) {
      return { nominativo: riga.nominativo, matricola: riga.matricola, employeeId: d.id, metodo: 'matricola_e_nome', nota: 'Nome e matricola coincidono.', daConfermare: false };
    }
    if (riga.dataAssunzione && d.dataAssunzione && riga.dataAssunzione === d.dataAssunzione) {
      return { nominativo: riga.nominativo, matricola: riga.matricola, employeeId: d.id, metodo: 'nome_e_assunzione', nota: `Nome e data di assunzione coincidono; la matricola no (paghe ${riga.matricola ?? 'vuota'}, gestionale ${d.matricola ?? 'vuota'}).`, daConfermare: false };
    }
    return {
      nominativo: riga.nominativo, matricola: riga.matricola, employeeId: d.id, metodo: 'nome',
      nota: `Trovata per nome. Matricola: paghe ${riga.matricola ?? 'vuota'}, gestionale ${d.matricola ?? 'vuota'}. Assunzione: paghe ${riga.dataAssunzione ?? 'non indicata'}, gestionale ${d.dataAssunzione ?? 'non indicata'}.`,
      daConfermare: true,
    };
  }

  if (candidati.length > 1) {
    // Omonimia: si prova a distinguere con la data di assunzione.
    const perData = candidati.filter((d) => riga.dataAssunzione && d.dataAssunzione === riga.dataAssunzione);
    if (perData.length === 1) {
      return { nominativo: riga.nominativo, matricola: riga.matricola, employeeId: perData[0].id, metodo: 'nome_e_assunzione', nota: 'Due persone con lo stesso nome: scelta quella con la stessa data di assunzione.', daConfermare: true };
    }
    // Quasi sempre l'omonimia è un doppione in anagrafica, con una sola riga
    // in forza: il tabulato delle paghe elenca chi lavora, quindi si propone
    // quella, e la conferma resta a chi importa.
    const attivi = candidati.filter((d) => d.isActive);
    if (attivi.length === 1) {
      return {
        nominativo: riga.nominativo, matricola: riga.matricola, employeeId: attivi[0].id, metodo: 'nome',
        nota: `Ci sono ${candidati.length} persone con questo nome in anagrafica, ma una sola in forza: proposta quella (matricola ${attivi[0].matricola ?? 'vuota'}). Da confermare.`,
        daConfermare: true,
      };
    }
    return { nominativo: riga.nominativo, matricola: riga.matricola, employeeId: null, metodo: null, nota: `Ci sono ${candidati.length} persone con questo nome: va scelta a mano.`, daConfermare: true };
  }

  // Nessun nome uguale: ultimo tentativo sulla matricola, sempre da confermare.
  const perMatricola = riga.matricola ? dipendenti.filter((d) => d.matricola === riga.matricola) : [];
  if (perMatricola.length === 1) {
    const d = perMatricola[0];
    return {
      nominativo: riga.nominativo, matricola: riga.matricola, employeeId: d.id, metodo: 'matricola',
      nota: `Nessun nome uguale nel gestionale. Stessa matricola di ${[d.cognome, d.nome].filter(Boolean).join(' ')}: da confermare, i nomi sono diversi.`,
      daConfermare: true,
    };
  }

  return {
    nominativo: riga.nominativo, matricola: riga.matricola, employeeId: null, metodo: null,
    nota: 'Questa persona non è nell\'anagrafica del gestionale.', daConfermare: true,
  };
}
