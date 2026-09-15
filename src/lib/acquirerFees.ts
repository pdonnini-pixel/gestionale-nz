// ============================================================================
// COMMISSIONI DI INCASSO ELETTRONICO (Amex, Nexi)
// ============================================================================
// Il costo dell'incasso arriva in due forme, e la forma dipende dal CONTRATTO
// del singolo punto vendita (vedi COMMISSIONI_INCASSO_NOTES.md):
//
//   al lordo -> l'accredito e' il transato pieno e la commissione viene
//               addebitata a parte con un SDD mensile. Il costo si vede.
//   al netto -> l'accredito e' gia' decurtato: in banca del costo non resta
//               traccia, e il ricavo registrato e' piu' basso del vero.
//
// Qui: i parser degli estratti conto e le letture da `acquirer_fees`.
// I parser lavorano sul testo gia' estratto dal PDF (src/lib/pdfText.ts) e
// non toccano ne' rete ne' database: sono puri e testabili.
import { supabase } from './supabase';

// --- Tipi -------------------------------------------------------------------

export type SettlementMode = 'lordo' | 'netto';
export type FeeSource = 'documento' | 'banca' | 'stima';

/** Una riga di costo, come la mostra la scheda Commissioni. */
export type CommissioneRiga = {
  outlet_id: string | null;
  outlet_code: string | null;
  outlet_name: string | null;
  period_year: number;
  period_month: number;
  acquirer: string;
  merchant_code: string;
  payment_contract: string | null;
  settlement_mode: SettlementMode;
  source: FeeSource;
  gross_amount: number | null;
  fee_amount: number;
  fixed_amount: number;
  stamp_amount: number;
  costo_totale: number;
  aliquota_pct: number | null;
};

/** Un punto vendita dentro un estratto Amex. */
export type AmexPuntoVendita = {
  merchant_code: string;   // codice AX
  nome: string;
  lordo: number;
  commissioni: number;     // sempre positivo
  operazioni: number;
};

export type AmexStatement = {
  numero: string;          // es. 26DY48D
  anno: number;
  mese: number;            // 1-12
  puntiVendita: AmexPuntoVendita[];
  lordoTotale: number;
  commissioniTotali: number;
  bollo: number;
  totaleAddebitato: number;
};

export type NexiStatement = {
  merchant_code: string;   // LN…
  payment_contract: string | null;
  settlement_mode: SettlementMode;
  anno: number;
  mese: number;
  negoziato: number;
  accrediti: number;
  commissioni: number;
  acquiring: number;       // commissione di acquiring in euro
  bollo: number;
  totaleAddebitato: number;
};

// --- Utilità ----------------------------------------------------------------

/** "1.456,95" -> 1456.95; "-2,69" -> -2.69. */
export function importoIt(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

const MESI: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

/** Il testo del PDF come stringa unica, spazi normalizzati. */
const testoDi = (righe: string[]): string => righe.join(' \n ').replace(/[ \t]+/g, ' ');

// --- Parser Amex ------------------------------------------------------------

// Riga giornaliera: 01.08.26 Abi 08457 - Operazione Elettronica <rif> 2 179,20 -2,69 176,51
const AMEX_RIGA =
  /(\d{2})\.(\d{2})\.(\d{2})\s+Abi\s+(\d{4,5})\s*-\s*[^\d]{0,60}?(\d{10,})\s+(\d+)\s+([\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})/g;
// Il nome del punto vendita e' il resto della riga: fermarsi a parole chiave
// non regge, perche' l'intestazione «Data …» a volte manca del tutto.
const AMEX_PV = /Codice AX N\.\s*(\d{10})\s*([^\n]*)/g;
const AMEX_INTESTAZIONE = /Estratto Conto n\.\s*(\w+)\s+di\s+(\w+)\s+(\d{4})/i;
const AMEX_TOTALE = /TOTALE EURO\s+([\d.]+,\d{2})\s+(-?[\d.]+,\d{2})/i;
const AMEX_BOLLO = /Bollo su estratto conto[^\n]*?(-[\d.]+,\d{2})/i;
const AMEX_TOTALE_EC = /TOTALE ESTRATTO CONTO EURO\s+(-?[\d.]+,\d{2})/i;

/**
 * Legge un «Estratto Conto Commissioni» American Express.
 * Un solo documento per azienda, con dentro tutti i punti vendita: il
 * raggruppamento e' per codice AX, che e' anche la chiave dell'SDD con cui le
 * commissioni vengono addebitate il mese dopo.
 */
export function parseAmexStatement(righe: string[]): AmexStatement | null {
  const testo = testoDi(righe);
  const intest = AMEX_INTESTAZIONE.exec(testo);
  if (!intest) return null;
  const mese = MESI[intest[2].toLowerCase()];
  if (!mese) return null;

  // Ogni riga giornaliera appartiene all'ultimo «Codice AX» che la precede.
  const confini: { ax: string; nome: string; da: number }[] = [];
  AMEX_PV.lastIndex = 0;
  for (let m = AMEX_PV.exec(testo); m; m = AMEX_PV.exec(testo)) {
    if (!confini.some(c => c.ax === m![1] && c.da === m!.index)) {
      const nome = m[2].replace(/\s*Data\b.*$/i, '').replace(/\s+/g, ' ').trim();
      confini.push({ ax: m[1], nome, da: m.index });
    }
  }
  if (!confini.length) return null;

  const perAx = new Map<string, AmexPuntoVendita>();
  AMEX_RIGA.lastIndex = 0;
  for (let m = AMEX_RIGA.exec(testo); m; m = AMEX_RIGA.exec(testo)) {
    let pv = confini[0];
    for (const c of confini) if (c.da < m.index) pv = c;
    const riga = perAx.get(pv.ax) ?? { merchant_code: pv.ax, nome: pv.nome, lordo: 0, commissioni: 0, operazioni: 0 };
    riga.lordo += importoIt(m[7]);
    riga.commissioni += Math.abs(importoIt(m[8]));
    riga.operazioni += Number(m[6]);
    perAx.set(pv.ax, riga);
  }
  if (!perAx.size) return null;

  const tot = AMEX_TOTALE.exec(testo);
  const bollo = AMEX_BOLLO.exec(testo);
  const totEc = AMEX_TOTALE_EC.exec(testo);
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return {
    numero: intest[1],
    anno: Number(intest[3]),
    mese,
    puntiVendita: [...perAx.values()].map(p => ({ ...p, lordo: r2(p.lordo), commissioni: r2(p.commissioni) })),
    lordoTotale: tot ? importoIt(tot[1]) : r2([...perAx.values()].reduce((s, p) => s + p.lordo, 0)),
    commissioniTotali: tot ? Math.abs(importoIt(tot[2])) : r2([...perAx.values()].reduce((s, p) => s + p.commissioni, 0)),
    bollo: bollo ? Math.abs(importoIt(bollo[1])) : 0,
    totaleAddebitato: totEc ? Math.abs(importoIt(totEc[1])) : 0,
  };
}

// --- Parser Nexi ------------------------------------------------------------

const NEXI_PV = /punto vendita cod\.\s*(LN\d{8,})/i;
const NEXI_CONTRATTO = /Payment Contract\s*(PC\d{8,})\s*:\s*al\s*(lordo|netto)/i;
const NEXI_DATA = /ESTRATTO CONTO DEL\s*(\d{2})\.(\d{2})\.(\d{4})/i;
const NEXI_NEGOZIATO = /TOTALE NEGOZIATO\s+([\d.]+,\d{2})/i;
const NEXI_ACCREDITI = /TOTALE ACCREDITI\s+([\d.]+,\d{2})/i;
const NEXI_ADDEBITI = /TOTALE ADDEBITI[^\n]*?([\d.]+,\d{2})/i;
const NEXI_ACQUIRING = /Commissione di Acquiring in Euro\W*([\d.]+,\d{2})/i;
const NEXI_BOLLO = /Imposta di Bollo\s+([\d.]+,\d{2})/i;
// Le commissioni sul transato: una riga sola («sul Transato») oppure spezzate
// per circuito («INTERNAZ. E APM», «CIRCUITI INTERNAZ.», «BANCOMAT»).
const NEXI_COMMISSIONI = /Commissioni sul [Tt]ransato(?:\s+(?:INTERNAZ\. E APM|CIRCUITI INTERNAZ\.|BANCOMAT))?\s+([\d.]+,\d{2})/g;

/**
 * Legge un estratto conto Nexi: un documento per PUNTO VENDITA.
 * Il regime di accredito e' scritto accanto al Payment Contract, ed e' il dato
 * che cambia tutto: al lordo la commissione arriva come addebito separato, al
 * netto non passa mai dal conto.
 *
 * Il totale del riquadro e la somma delle righe giornaliere possono differire
 * di qualche centesimo: fa fede il riquadro, che coincide con l'addebito.
 */
export function parseNexiStatement(righe: string[]): NexiStatement | null {
  const testo = testoDi(righe);
  const pv = NEXI_PV.exec(testo);
  const data = NEXI_DATA.exec(testo);
  if (!pv || !data) return null;

  const contratto = NEXI_CONTRATTO.exec(testo);
  const negoziato = NEXI_NEGOZIATO.exec(testo);
  const accrediti = NEXI_ACCREDITI.exec(testo);
  const addebiti = NEXI_ADDEBITI.exec(testo);
  const acquiring = NEXI_ACQUIRING.exec(testo);
  const bollo = NEXI_BOLLO.exec(testo);

  let commissioni = 0;
  NEXI_COMMISSIONI.lastIndex = 0;
  const viste = new Set<number>();
  for (let m = NEXI_COMMISSIONI.exec(testo); m; m = NEXI_COMMISSIONI.exec(testo)) {
    if (viste.has(m.index)) continue;
    viste.add(m.index);
    commissioni += importoIt(m[1]);
  }

  const neg = negoziato ? importoIt(negoziato[1]) : 0;
  const acc = accrediti ? importoIt(accrediti[1]) : 0;
  // Rete di sicurezza: se le righe «Commissioni sul transato» non si leggono,
  // al netto la differenza fra negoziato e accreditato E' la commissione.
  if (!commissioni && neg && acc && neg > acc) commissioni = Math.round((neg - acc) * 100) / 100;

  return {
    merchant_code: pv[1],
    payment_contract: contratto ? contratto[1] : null,
    settlement_mode: (contratto ? contratto[2].toLowerCase() : 'netto') as SettlementMode,
    anno: Number(data[3]),
    mese: Number(data[2]),
    negoziato: neg,
    accrediti: acc,
    commissioni: Math.round(commissioni * 100) / 100,
    acquiring: acquiring ? importoIt(acquiring[1]) : 0,
    bollo: bollo ? importoIt(bollo[1]) : 0,
    totaleAddebitato: addebiti ? importoIt(addebiti[1]) : 0,
  };
}

/** Riconosce di che documento si tratta prima di provare a leggerlo. */
export function tipoEstratto(righe: string[]): 'amex' | 'nexi' | null {
  const testo = testoDi(righe);
  if (/Estratto Conto Commissioni/i.test(testo) || /Codice AX N\./i.test(testo)) return 'amex';
  if (/Nexi Payments/i.test(testo) || /punto vendita cod\.\s*LN/i.test(testo)) return 'nexi';
  return null;
}

// --- Lettura dal database ---------------------------------------------------

export async function fetchCommissioni(companyId: string, anno: number): Promise<CommissioneRiga[]> {
  const { data, error } = await supabase
    .from('v_commissioni_incasso')
    .select('*')
    .eq('company_id', companyId)
    .eq('period_year', anno)
    .order('period_month');
  if (error) throw error;
  return (data ?? []) as CommissioneRiga[];
}

export type ContrattoAcquirer = {
  id: string;
  outlet_id: string | null;
  acquirer: string;
  merchant_code: string;
  payment_contract: string | null;
  settlement_mode: SettlementMode;
  label: string | null;
  is_active: boolean;
};

export async function fetchContratti(companyId: string): Promise<ContrattoAcquirer[]> {
  const { data, error } = await supabase
    .from('acquirer_contracts')
    .select('id, outlet_id, acquirer, merchant_code, payment_contract, settlement_mode, label, is_active')
    .eq('company_id', companyId)
    .order('acquirer')
    .order('merchant_code');
  if (error) throw error;
  return (data ?? []) as ContrattoAcquirer[];
}

/** Totali per outlet, per la tabella della scheda. */
export type TotaleOutlet = {
  outlet_id: string | null;
  outlet_code: string;
  perMese: Record<number, number>;
  totale: number;
  lordo: number;
  aliquota: number | null;
  soloNetto: boolean;
};

export function totaliPerOutlet(righe: CommissioneRiga[]): TotaleOutlet[] {
  const map = new Map<string, TotaleOutlet & { conLordo: number }>();
  for (const r of righe) {
    const key = r.outlet_code ?? '—';
    let t = map.get(key);
    if (!t) {
      t = { outlet_id: r.outlet_id, outlet_code: key, perMese: {}, totale: 0, lordo: 0, aliquota: null, soloNetto: true, conLordo: 0 };
      map.set(key, t);
    }
    t.perMese[r.period_month] = Math.round(((t.perMese[r.period_month] ?? 0) + r.fee_amount) * 100) / 100;
    t.totale = Math.round((t.totale + r.fee_amount) * 100) / 100;
    if (r.gross_amount) {
      t.lordo = Math.round((t.lordo + r.gross_amount) * 100) / 100;
      t.conLordo = Math.round((t.conLordo + r.fee_amount) * 100) / 100;
    }
    if (r.settlement_mode === 'lordo') t.soloNetto = false;
  }
  return [...map.values()]
    .map(t => ({ ...t, aliquota: t.lordo > 0 ? Math.round((t.conLordo / t.lordo) * 100000) / 1000 : null }))
    .sort((a, b) => b.totale - a.totale);
}
