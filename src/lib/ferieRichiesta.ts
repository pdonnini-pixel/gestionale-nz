// Logica della richiesta di ferie e permessi.
//
// L'unita' di misura e' l'ORA, come nel tabulato delle paghe: una giornata
// non vale otto ore per tutti, vale l'orario settimanale diviso cinque. Su
// 42 persone del tabulato di agosto, sette lavorano davvero 40 ore: contare
// a giornate darebbe numeri sbagliati a trentacinque di loro.
//
// Qui dentro non si parla con il database e non si disegna niente: si
// converte, si somma e si controlla. Cosi' le regole si possono provare.

import { VOCI, type RateoVoce } from './rateiParse';

export type VoceFerie = RateoVoce;
export type TipoGiorno = 'giornata' | 'mezza_giornata' | 'ore';

/** Un giorno chiesto, come sta nella tabella leave_request_days. */
export type GiornoRichiesto = {
  data: string;          // ISO, 'YYYY-MM-DD'
  voce: VoceFerie;
  tipo: TipoGiorno;
  ore: number;
  nota?: string | null;
};

/** Il saldo di una voce, come torna da v_leave_disponibilita. */
export type DisponibilitaVoce = {
  voce: VoceFerie;
  residuo: number | null;
  da_fruire: number | null;
  ore_in_attesa: number;
  ore_approvate: number;
  ore_in_bozza: number;
  residuo_disponibile: number | null;
  da_fruire_disponibile: number | null;
  saldo_alla_data: string | null;
  ore_giornata_dedotte: number | null;
  ore_settimanali_dedotte: number | null;
};

export const ETICHETTE_VOCE: Record<VoceFerie, string> = VOCI;

/** Nome corto, per le colonne strette e per i file esportati. */
export const ETICHETTE_VOCE_BREVI: Record<VoceFerie, string> = {
  F01: 'Ferie',
  F02: 'Ex festività',
  F03: 'ROL',
};

export const ETICHETTE_TIPO: Record<TipoGiorno, string> = {
  giornata: 'Giornata intera',
  mezza_giornata: 'Mezza giornata',
  ore: 'Permesso a ore',
};

export const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'] as const;

export const GIORNI_BREVI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'] as const;

export const GIORNI_LAVORATIVI_SETTIMANA = 5;

/**
 * Ore di una giornata piena, a partire dall'ORARIO SETTIMANALE.
 *
 * Entrambi gli argomenti sono ore a settimana, e si dividono per cinque:
 * chi fa 28 ore ha una giornata da 5,60, non da 28. Se questa funzione
 * ricevesse gia' la giornata il conto verrebbe moltiplicato per cinque, e
 * ogni giorno di ferie ne mangerebbe cinque.
 *
 * Primo, l'orario che risulta dalle paghe. Secondo, quello scritto in
 * anagrafica. Se tacciono tutti e due si usano 8 ore e il chiamante riceve
 * `fonte: 'ripiego'`: un valore di ripiego non e' la scelta di nessuno, e
 * va dichiarato dove lo si mostra.
 */
export function oreGiornata(
  oreSettimanaliPaghe: number | null | undefined,
  oreSettimanaliAnagrafica: number | null | undefined,
): { ore: number; fonte: 'paghe' | 'anagrafica' | 'ripiego' } {
  if (oreSettimanaliPaghe && oreSettimanaliPaghe > 0) {
    return { ore: round2(oreSettimanaliPaghe / GIORNI_LAVORATIVI_SETTIMANA), fonte: 'paghe' };
  }
  if (oreSettimanaliAnagrafica && oreSettimanaliAnagrafica > 0) {
    return { ore: round2(oreSettimanaliAnagrafica / GIORNI_LAVORATIVI_SETTIMANA), fonte: 'anagrafica' };
  }
  return { ore: 8, fonte: 'ripiego' };
}

/** Le ore che un giorno vale, dato il tipo scelto. */
export function oreDelGiorno(
  tipo: TipoGiorno,
  oreGiornataPiena: number,
  oreSpecificate?: number | null,
): number {
  if (tipo === 'giornata') return round2(oreGiornataPiena);
  if (tipo === 'mezza_giornata') return round2(oreGiornataPiena / 2);
  return round2(Math.max(0, oreSpecificate ?? 0));
}

/** Da ore a giornate, per chi ragiona in giorni e non in ore. */
export function giornateDaOre(ore: number | null | undefined, oreGiornataPiena: number): number {
  if (!ore || !oreGiornataPiena) return 0;
  return round2(ore / oreGiornataPiena);
}

/** Totale chiesto per ciascuna voce. */
export function totaliPerVoce(giorni: GiornoRichiesto[]): Record<VoceFerie, number> {
  const t: Record<VoceFerie, number> = { F01: 0, F02: 0, F03: 0 };
  for (const g of giorni) t[g.voce] = round2(t[g.voce] + g.ore);
  return t;
}

export type Avviso = {
  gravita: 'blocco' | 'attenzione' | 'nota';
  testo: string;
  voce?: VoceFerie;
  data?: string;
};

/**
 * Controlli sulla richiesta, prima di salvarla.
 *
 * Blocco: la richiesta non si puo' mandare cosi'.
 * Attenzione: si puo' mandare, ma chi la manda deve sapere cosa sta facendo.
 * Nota: informazione, nessuna conseguenza.
 */
/**
 * LE FERIE SI DICONO A GIORNATE. Una commessa non ragiona in 8,65 ore:
 * ragiona a giornata, mezza giornata, o poche ore di permesso. Le ore sono
 * l'unita' con cui il gestionale fa i conti, non quella con cui si parla
 * alle persone.
 *
 * Non si arrotonda mai per eccesso: chi ha 5,4 giornate legge «5 giornate»,
 * non «5 e mezza», perche' la mezza in piu' non ce l'ha. La mezza si scrive
 * solo quando c'e' davvero.
 */
export function giornateInParole(ore: number | null | undefined, oreGiornata: number): string {
  if (ore == null || !Number.isFinite(ore) || !(oreGiornata > 0)) return '—';
  if (ore < -0.001) return 'nessuna: ne hai già usate in anticipo';
  const giornate = ore / oreGiornata;
  if (giornate < 0.01) return 'nessuna';
  if (giornate < 0.5 - 1e-9) return 'meno di mezza giornata';
  const intere = Math.floor(giornate + 1e-9);
  const mezza = giornate - intere >= 0.5 - 1e-9;
  if (intere === 0) return 'mezza giornata';
  const parte = intere === 1 ? '1 giornata' : `${intere} giornate`;
  return mezza ? `${parte} e mezza` : parte;
}

/**
 * I PERMESSI SI DICONO A ORE, e in ore e minuti: «1 ora e 36 minuti» si
 * capisce, «1,60 h» no.
 */
export function oreInParole(ore: number | null | undefined): string {
  if (ore == null || !Number.isFinite(ore)) return '—';
  if (ore < -0.001) return 'nessuna: ne hai già usate in anticipo';
  const minuti = Math.round(ore * 60);
  if (minuti === 0) return 'nessuna';
  const h = Math.floor(minuti / 60);
  const m = minuti % 60;
  if (h === 0) return m === 1 ? '1 minuto' : `${m} minuti`;
  const parteOre = h === 1 ? '1 ora' : `${h} ore`;
  if (m === 0) return parteOre;
  return `${parteOre} e ${m === 1 ? '1 minuto' : `${m} minuti`}`;
}

/**
 * I permessi si chiedono a ore, ma quando quelle ore fanno giornate intere
 * (o mezze) va detto, altrimenti si perde il senso di quello che si ha.
 * Caso vero: Falchi, 8 ore a settimana, ha 1,60 h di ex festivita'. Scritto
 * «1 ora e 36 minuti» sembra uno spezzone da dentista; e' una giornata
 * intera di permesso, perche' la sua giornata vale 1,60 h.
 * La frase si aggiunge solo quando il conto torna esatto a giornate o
 * mezze giornate: altrimenti sarebbe una precisione finta.
 */
export function permessiInParole(ore: number | null | undefined, oreGiornata: number): string {
  const testo = oreInParole(ore);
  if (ore == null || !Number.isFinite(ore) || ore <= 0 || !(oreGiornata > 0)) return testo;
  const giornate = ore / oreGiornata;
  const meta = Math.round(giornate * 2) / 2;
  if (meta < 0.5 || Math.abs(giornate - meta) > 0.02) return testo;
  const parte =
    meta === 0.5 ? 'mezza giornata'
      : meta === 1 ? 'una giornata intera'
        : Number.isInteger(meta) ? `${meta} giornate intere`
          : Math.floor(meta) === 1 ? 'una giornata e mezza'
            : `${Math.floor(meta)} giornate e mezza`;
  return `${testo}, cioè ${parte}`;
}

export function verificaRichiesta(
  giorni: GiornoRichiesto[],
  disponibilita: DisponibilitaVoce[],
  oreGiornataPiena: number,
): Avviso[] {
  const avvisi: Avviso[] = [];
  if (!giorni.length) {
    avvisi.push({ gravita: 'blocco', testo: 'Non è stato scelto nessun giorno.' });
    return avvisi;
  }

  // Lo stesso giorno chiesto due volte con voci diverse: si puo' fare (mezza
  // giornata di ferie e mezza di ROL), ma non deve superare la giornata.
  const perData = new Map<string, number>();
  for (const g of giorni) perData.set(g.data, round2((perData.get(g.data) ?? 0) + g.ore));
  for (const [data, ore] of perData) {
    if (ore > oreGiornataPiena + 0.001) {
      avvisi.push({
        gravita: 'blocco',
        data,
        testo: `Il ${formattaData(data)} sono state chieste ${formattaOre(ore)}, più di una giornata intera (${formattaOre(oreGiornataPiena)}).`,
      });
    }
  }

  const totali = totaliPerVoce(giorni);
  for (const d of disponibilita) {
    const chiesto = totali[d.voce];
    if (!chiesto) continue;

    const residuoOggi = d.residuo_disponibile ?? d.residuo ?? 0;
    // «Da fruire» sul tabulato e' residuo + quello che resta da maturare:
    // verificato sulle 85 righe di NZ, coincide al centesimo. Non e' una
    // scadenza: le ferie non scadono (Francesca Signorini, 23/09/2026), e
    // infatti il messaggio non dice piu' «entro fine anno».
    const totaleAnno = d.da_fruire_disponibile ?? d.da_fruire ?? residuoOggi;

    if (chiesto > totaleAnno + 0.001) {
      avvisi.push({
        gravita: 'blocco',
        voce: d.voce,
        testo: `${ETICHETTE_VOCE[d.voce]}: chieste ${formattaOre(chiesto)}, ma anche con tutto l'anno maturato ne risultano ${formattaOre(totaleAnno)}.`,
      });
    } else if (chiesto > residuoOggi + 0.001) {
      avvisi.push({
        gravita: 'attenzione',
        voce: d.voce,
        testo: `${ETICHETTE_VOCE[d.voce]}: chieste ${formattaOre(chiesto)}, più delle ${formattaOre(residuoOggi)} disponibili oggi. Le ore mancanti maturano nei mesi che restano.`,
      });
    }
  }

  // Giorni che le paghe hanno gia' contato: non scalano il saldo, e chi
  // guarda i numeri deve saperlo prima di chiederselo.
  const dataSaldo = disponibilita.find((d) => d.saldo_alla_data)?.saldo_alla_data ?? null;
  if (dataSaldo) {
    const anteriori = giorni.filter((g) => g.data <= dataSaldo);
    if (anteriori.length) {
      avvisi.push({
        gravita: 'nota',
        testo: `${anteriori.length === 1 ? 'Un giorno è' : `${anteriori.length} giorni sono`} precedenti al ${formattaData(dataSaldo)}, la data dell'ultimo tabulato: le paghe li hanno già contati, quindi non tolgono altre ore al saldo.`,
      });
    }
  }

  const festivi = giorni.filter((g) => eFestivoOItaliano(g.data));
  for (const g of festivi) {
    avvisi.push({
      gravita: 'attenzione',
      data: g.data,
      testo: `Il ${formattaData(g.data)} è ${etichettaFestivita(g.data) ?? 'una domenica'}: di solito non si consumano ferie in un giorno non lavorativo.`,
    });
  }

  return avvisi;
}

// ─────────────────────────────────────────────────────────────────────
// Calendario
// ─────────────────────────────────────────────────────────────────────

/** Giorni del mese, con l'indice della prima colonna (lunedì = 0). */
export function grigliaDelMese(anno: number, mese: number): { giorni: string[]; offset: number } {
  const primo = new Date(Date.UTC(anno, mese - 1, 1));
  const offset = (primo.getUTCDay() + 6) % 7;   // domenica = 0 in JS, qui va in fondo
  const ultimo = new Date(Date.UTC(anno, mese, 0)).getUTCDate();
  const giorni: string[] = [];
  for (let d = 1; d <= ultimo; d++) giorni.push(iso(anno, mese, d));
  return { giorni, offset };
}

export function iso(anno: number, mese: number, giorno: number): string {
  return `${anno}-${String(mese).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
}

/** Domenica secondo il calendario, non secondo il contratto. */
export function eDomenica(dataIso: string): boolean {
  return new Date(`${dataIso}T00:00:00Z`).getUTCDay() === 0;
}

/**
 * Festività nazionali italiane, Pasqua compresa (algoritmo di Gauss).
 * I patroni locali non ci sono: cambiano da outlet a outlet e nessuno li
 * ha ancora dichiarati. Meglio tacere che indovinare.
 */
export function festivitaItaliane(anno: number): Record<string, string> {
  const f: Record<string, string> = {
    [iso(anno, 1, 1)]: 'Capodanno',
    [iso(anno, 1, 6)]: 'Epifania',
    [iso(anno, 4, 25)]: 'Festa della Liberazione',
    [iso(anno, 5, 1)]: 'Festa del lavoro',
    [iso(anno, 6, 2)]: 'Festa della Repubblica',
    [iso(anno, 8, 15)]: 'Ferragosto',
    [iso(anno, 11, 1)]: 'Ognissanti',
    [iso(anno, 12, 8)]: 'Immacolata',
    [iso(anno, 12, 25)]: 'Natale',
    [iso(anno, 12, 26)]: 'Santo Stefano',
  };
  const pasqua = domenicaDiPasqua(anno);
  const pasquetta = new Date(pasqua.getTime() + 86400000);
  f[pasqua.toISOString().slice(0, 10)] = 'Pasqua';
  f[pasquetta.toISOString().slice(0, 10)] = 'Lunedì dell\'Angelo';
  return f;
}

function domenicaDiPasqua(anno: number): Date {
  const a = anno % 19, b = Math.floor(anno / 100), c = anno % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const g = Math.floor((8 * b + 13) / 25);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 19 * l) / 433);
  const mese = Math.floor((h + l - 7 * m + 90) / 25);
  const giorno = (h + l - 7 * m + 33 * mese + 19) % 32;
  return new Date(Date.UTC(anno, mese - 1, giorno));
}

export function etichettaFestivita(dataIso: string): string | null {
  const anno = Number(dataIso.slice(0, 4));
  return festivitaItaliane(anno)[dataIso] ?? null;
}

function eFestivoOItaliano(dataIso: string): boolean {
  return eDomenica(dataIso) || etichettaFestivita(dataIso) !== null;
}

// ─────────────────────────────────────────────────────────────────────
// Formati
// ─────────────────────────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formattaOre(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
}

export function formattaGiornate(ore: number | null | undefined, oreGiornataPiena: number): string {
  const g = giornateDaOre(ore, oreGiornataPiena);
  if (!g) return '—';
  const arrotondato = Math.round(g * 2) / 2;   // mezze giornate
  return `${arrotondato.toLocaleString('it-IT', { maximumFractionDigits: 1 })} ${arrotondato === 1 ? 'giorno' : 'giorni'}`;
}

export function formattaData(dataIso: string): string {
  const [a, m, g] = dataIso.split('-');
  return `${g}/${m}/${a}`;
}

export function formattaDataLunga(dataIso: string): string {
  const d = new Date(`${dataIso}T00:00:00Z`);
  const giorno = GIORNI_BREVI[(d.getUTCDay() + 6) % 7];
  return `${giorno} ${formattaData(dataIso)}`;
}

/** I giorni raggruppati per mese, in ordine: come si legge un modulo. */
export function perMese(giorni: GiornoRichiesto[]): { chiave: string; etichetta: string; giorni: GiornoRichiesto[] }[] {
  const mappa = new Map<string, GiornoRichiesto[]>();
  for (const g of [...giorni].sort((a, b) => a.data.localeCompare(b.data))) {
    const k = g.data.slice(0, 7);
    if (!mappa.has(k)) mappa.set(k, []);
    mappa.get(k)!.push(g);
  }
  return [...mappa.entries()].map(([chiave, gg]) => ({
    chiave,
    etichetta: `${MESI[Number(chiave.slice(5, 7))]} ${chiave.slice(0, 4)}`,
    giorni: gg,
  }));
}

/**
 * Intervalli continui, per scrivere «dal 3 al 9 agosto» invece di sette
 * righe uguali. Si spezza quando cambia la voce o il tipo, o quando il
 * giorno dopo non c'e'.
 */
export function intervalli(giorni: GiornoRichiesto[]): { dal: string; al: string; voce: VoceFerie; tipo: TipoGiorno; ore: number; giorni: number }[] {
  const ordinati = [...giorni].sort((a, b) => a.data.localeCompare(b.data));
  const out: { dal: string; al: string; voce: VoceFerie; tipo: TipoGiorno; ore: number; giorni: number }[] = [];
  for (const g of ordinati) {
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.voce === g.voce && ultimo.tipo === g.tipo && giornoSuccessivo(ultimo.al) === g.data) {
      ultimo.al = g.data;
      ultimo.ore = round2(ultimo.ore + g.ore);
      ultimo.giorni += 1;
    } else {
      out.push({ dal: g.data, al: g.data, voce: g.voce, tipo: g.tipo, ore: g.ore, giorni: 1 });
    }
  }
  return out;
}

function giornoSuccessivo(dataIso: string): string {
  const d = new Date(`${dataIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
