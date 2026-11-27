// Cruscotto direzione (Dashboard, Patrizio 27/11/2026).
// Calcoli puri sui dati restituiti da public.cruscotto_direzione(p_anno) (migration 481).
// Regole decise con Patrizio:
// - confronto con l'anno prima solo a parità di negozi e di mesi pieni aperti in tutti e due gli anni;
// - il budget dei ricavi si mostra in tutti i mesi, così com'è in Budget & Controllo;
// - il compenso degli amministratori si divide fra i negozi in proporzione ai ricavi; in Sede restano
//   i dipendenti di sede e magazzino;
// - l'affitto si conta per competenza: chi paga a trimestre anticipato (fatture solo a gennaio, aprile,
//   luglio, ottobre) lo spalma sui tre mesi;
// - la merce venduta viene da MODA (vendite meno costo d'acquisto), non dal bilancio: è un avviso fisso;
// - lo scaduto fornitori arriva già calcolato con la regola dello Scadenzario.

export type Mesi = number[] // 12 valori, gennaio = indice 0

export interface NegozioRaw { id: string; code: string; name: string; cc: string | null; tipo: string | null; attivo: boolean | null; apertura: string | null; chiusura: string | null }
export interface RicaviRaw { o: string; y: number; m: number; netto: number; lordo: number; ultimo: string }
export interface ModaRaw { o: string; y: number; m: number; ingressi: number; scontrini: number; vendite: number; costo: number; listino: number }
export interface PersonaleRaw { o: string | null; f: string | null; m: number; costo: number; amm: number; dip: number }
export interface CostoRaw { cc: string | null; o: string | null; m: number; g: string; v: number }
export interface ScadutoRaw {
  oltre30: number; ultimi30: number; entro30: number; da31a60: number; oltre60: number; fatture_scadute: number
  primo_fornitore: { nome: string; importo: number; fatture: number; dal: string } | null
}
export interface DatiCruscottoRaw {
  anno: number; oggi: string
  negozi: NegozioRaw[]; ricavi: RicaviRaw[]; budget: { cc: string; m: number; v: number }[]
  moda: ModaRaw[]; personale: PersonaleRaw[]; costi: CostoRaw[]
  liquidita: { saldo: number; conti: number; aggiornato: string | null } | null
  scaduto: ScadutoRaw | null
}

export interface Moda { ingressi: number; scontrini: number; vendite: number; costo: number; listino: number }
export interface Negozio {
  id: string; code: string; nome: string; cc: string | null
  aperturaMese: number | null // primo mese pieno nell'anno prima (1-12), null se aperto dopo
  chiuso: boolean
  y1: Mesi; y0: Mesi // ricavi netti anno scelto e anno prima
  budget: Mesi | null
  moda1: Moda | null; moda0: Moda | null // gennaio-meseModa, i due anni
  modaMesi1: (Moda | null)[]; modaMesi0: (Moda | null)[] // mese per mese, per confrontare gli stessi mesi
  personale: Mesi; ammQuota: number // dipendenti mese per mese, quota amministratore del periodo del conto
  affitto: Mesi; spese: Mesi; allestimenti: Mesi
}
export interface Cruscotto {
  anno: number; oggi: string
  meseUltimo: number // ultimo mese con ricavi (1-12), 0 se nessuno
  giornoUltimo: number; giorniMese: number; meseParziale: boolean
  meseModa: number // ultimo mese con MODA
  meseConto: number // ultimo mese con le paghe: il conto si fa su gennaio-meseConto
  negozi: Negozio[]
  sede: { personale: Mesi; affitto: Mesi; spese: Mesi; allestimenti: Mesi } | null
  ammTotale: number
  liquidita: { saldo: number; conti: number; aggiornato: string | null } | null
  scaduto: ScadutoRaw | null
}

const Z = (): Mesi => Array(12).fill(0)
export const somma = (a: number[]): number => a.reduce((s, v) => s + (Number(v) || 0), 0)
export const fino = (a: Mesi, mese: number): number => somma(a.slice(0, Math.max(0, mese)))

/** Primo mese pieno di apertura nell'anno `anno0` (1-12), 1 se aperto prima, null se aperto dopo. */
export function primoMesePieno(apertura: string | null, anno0: number): number | null {
  if (!apertura) return 1
  const [y, m, d] = apertura.split('-').map(Number)
  if (!y || !m) return 1
  if (y < anno0) return 1
  if (y > anno0) return null
  const mese = d && d > 1 ? m + 1 : m
  return mese > 12 ? null : mese
}

/** Affitto di competenza: se le fatture cadono solo a gennaio, aprile, luglio e ottobre il trimestre si spalma sui tre mesi. */
export function affittoCompetenza(fatture: Mesi): Mesi {
  const max = Math.max(...fatture.map(Math.abs), 0)
  if (max === 0) return [...fatture]
  const rilevanti = fatture.map((v, i) => ({ v, i })).filter(x => Math.abs(x.v) >= max * 0.2)
  const trimestrale = rilevanti.length >= 2 && rilevanti.every(x => x.i % 3 === 0)
  if (!trimestrale) return [...fatture]
  const out = Z()
  for (let q = 0; q < 4; q++) {
    const s = fatture[q * 3] + fatture[q * 3 + 1] + fatture[q * 3 + 2]
    for (let k = 0; k < 3; k++) out[q * 3 + k] = s / 3
  }
  return out
}

const modaMesi = (righe: ModaRaw[]): (Moda | null)[] => Array.from({ length: 12 }, (_, i) => sommaModa(righe.filter(r => r.m === i + 1)))

function sommaModa(righe: ModaRaw[]): Moda | null {
  if (!righe.length) return null
  const t = righe.reduce((s, r) => ({ ingressi: s.ingressi + Number(r.ingressi || 0), scontrini: s.scontrini + Number(r.scontrini || 0), vendite: s.vendite + Number(r.vendite || 0), costo: s.costo + Number(r.costo || 0), listino: s.listino + Number(r.listino || 0) }), { ingressi: 0, scontrini: 0, vendite: 0, costo: 0, listino: 0 })
  return t.vendite > 0 || t.ingressi > 0 ? t : null
}

const giorniDelMese = (anno: number, mese: number) => new Date(anno, mese, 0).getDate()
/** Nome del negozio leggibile: «VALMONTONE» → «Valmontone», «SEDE / MAGAZZINO» → «Sede / Magazzino». */
export const nomeLeggibile = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/(^|[\s/(-])\S/g, c => c.toUpperCase())

/** Costruisce il modello del cruscotto dai dati grezzi della funzione SQL. */
export function costruisciCruscotto(raw: DatiCruscottoRaw): Cruscotto {
  const anno = Number(raw.anno), anno0 = anno - 1
  const ricavi = raw.ricavi || []
  const r1 = ricavi.filter(r => r.y === anno)
  const meseUltimo = r1.reduce((m, r) => Math.max(m, r.m), 0)
  const ultimoGiorno = r1.reduce((d, r) => (r.ultimo > d ? r.ultimo : d), '')
  const giornoUltimo = ultimoGiorno ? Number(ultimoGiorno.slice(8, 10)) : 0
  const giorniMese = meseUltimo ? giorniDelMese(anno, meseUltimo) : 30
  const meseParziale = meseUltimo > 0 && giornoUltimo < giorniMese
  const moda1 = (raw.moda || []).filter(r => r.y === anno)
  const meseModa = moda1.reduce((m, r) => Math.max(m, r.m), 0)
  const meseConto = (raw.personale || []).reduce((m, r) => Math.max(m, r.m), 0)

  const sedeIds = new Set((raw.negozi || []).filter(n => n.tipo === 'sede').map(n => n.id))
  const vendita = (raw.negozi || []).filter(n => n.tipo !== 'sede')

  // costi dalle fatture per negozio (o sede se senza negozio)
  const costiDi = (pred: (c: CostoRaw) => boolean) => {
    const aff = Z(), spe = Z(), all = Z()
    for (const c of (raw.costi || []).filter(pred)) {
      const i = c.m - 1; if (i < 0 || i > 11) continue
      const v = Number(c.v) || 0
      if (c.g === 'locazione') aff[i] += v
      else if (c.g === 'allestimenti') all[i] += v
      else if (c.g === 'costo_venduto') continue // la merce viene da MODA
      else spe[i] += v
    }
    return { affitto: affittoCompetenza(aff), spese: spe, allestimenti: all }
  }
  const personaleDi = (pred: (p: PersonaleRaw) => boolean) => { const a = Z(); for (const p of (raw.personale || []).filter(pred)) if (p.m >= 1 && p.m <= 12) a[p.m - 1] += Number(p.costo) || 0; return a }
  const ammTotale = somma((raw.personale || []).map(p => Number(p.amm) || 0))

  const negozi: Negozio[] = vendita.map(n => {
    const y1 = Z(), y0 = Z()
    for (const r of ricavi.filter(r => r.o === n.id)) { if (r.y === anno) y1[r.m - 1] += Number(r.netto) || 0; else if (r.y === anno0) y0[r.m - 1] += Number(r.netto) || 0 }
    const bud = (raw.budget || []).filter(b => n.cc && b.cc === n.cc)
    let budget: Mesi | null = null
    if (bud.length) { budget = Z(); for (const b of bud) budget[b.m - 1] += Number(b.v) || 0 }
    const mm = (raw.moda || []).filter(r => r.o === n.id && r.m <= meseModa)
    // chiuso per l'anno scelto: chiusura prima dell'anno, oppure inattivo senza ricavi nell'anno
    const chiuso = (!!n.chiusura && n.chiusura < `${anno}-01-01`) || (n.attivo === false && somma(y1) === 0)
    return {
      id: n.id, code: n.code, nome: nomeLeggibile(n.name), cc: n.cc, aperturaMese: primoMesePieno(n.apertura, anno0), chiuso,
      y1, y0, budget, moda1: sommaModa(mm.filter(r => r.y === anno)), moda0: sommaModa(mm.filter(r => r.y === anno0)),
      modaMesi1: modaMesi(mm.filter(r => r.y === anno)), modaMesi0: modaMesi(mm.filter(r => r.y === anno0)),
      personale: personaleDi(p => p.o === n.id), ammQuota: 0, ...costiDi(c => c.o === n.id),
    }
  })
  // quota amministratore sui ricavi del periodo del conto
  const ricConto = somma(negozi.map(n => fino(n.y1, meseConto)))
  if (ricConto > 0) negozi.forEach(n => { n.ammQuota = ammTotale * fino(n.y1, meseConto) / ricConto })

  // il personale senza negozio (non attribuito nel Prospetto) va in Sede, così il totale torna con le paghe
  const idVendita = new Set(vendita.map(n => n.id))
  const haSede = sedeIds.size > 0 || (raw.costi || []).some(c => !c.o) || (raw.personale || []).some(p => !p.o || !idVendita.has(p.o))
  const sede = haSede ? { personale: personaleDi(p => !p.o || !idVendita.has(p.o)), ...costiDi(c => !c.o || sedeIds.has(c.o)) } : null

  return { anno, oggi: raw.oggi, meseUltimo, giornoUltimo, giorniMese, meseParziale, meseModa, meseConto, negozi, sede, ammTotale, liquidita: raw.liquidita, scaduto: raw.scaduto }
}

/** Margine sulla merce (vendite meno costo, sul venduto) a parità: stessi negozi e stessi mesi con importi MODA nei due anni. */
export function margineParita(ns: Negozio[]): { ora: number; prima: number; punti: number } | null {
  let v1 = 0, c1 = 0, v0 = 0, c0 = 0
  for (const n of ns) {
    if (!n.aperturaMese) continue
    for (let i = n.aperturaMese - 1; i < 12; i++) {
      const a = n.modaMesi1[i], b = n.modaMesi0[i]
      if (a && b && a.vendite > 0 && b.vendite > 0) { v1 += a.vendite; c1 += a.costo; v0 += b.vendite; c0 += b.costo }
    }
  }
  if (!v1 || !v0) return null
  const ora = (1 - c1 / v1) * 100, prima = (1 - c0 / v0) * 100
  return { ora, prima, punti: ora - prima }
}

/** Ultimo mese pieno con i ricavi. */
export const mesePieno = (c: Cruscotto): number => (c.meseParziale ? c.meseUltimo - 1 : c.meseUltimo)

/** Confronto a parità: mesi pieni aperti in tutti e due gli anni, fino all'ultimo mese pieno. */
export function parita(n: Negozio, finoMese: number): { prima: number; ora: number; pct: number } | null {
  if (!n.aperturaMese) return null
  let prima = 0, ora = 0
  for (let i = n.aperturaMese - 1; i < finoMese; i++) if (n.y0[i] > 0 && n.y1[i] > 0) { prima += n.y0[i]; ora += n.y1[i] }
  return prima > 0 ? { prima, ora, pct: (ora / prima - 1) * 100 } : null
}
export function paritaInsieme(ns: Negozio[], finoMese: number): number | null {
  let a = 0, b = 0; ns.forEach(n => { const p = parita(n, finoMese); if (p) { a += p.prima; b += p.ora } })
  return a > 0 ? (b / a - 1) * 100 : null
}

/** Stima di chiusura anno: incassato, più il mese in corso in proiezione, più i mesi che mancano a budget
 *  (o, senza budget, lo stesso mese dell'anno prima con la crescita a parità del negozio). */
export function stimaChiusura(n: Negozio, c: Cruscotto): number {
  if (n.chiuso) return somma(n.y1)
  let tot = somma(n.y1)
  const p = parita(n, mesePieno(c)), g = p ? 1 + p.pct / 100 : 1
  if (c.meseParziale && c.giornoUltimo > 0) {
    const i = c.meseUltimo - 1
    tot += n.y1[i] / c.giornoUltimo * c.giorniMese - n.y1[i]
  }
  for (let i = c.meseUltimo; i < 12; i++) tot += n.budget && n.budget[i] ? n.budget[i] : n.y0[i] * g
  return tot
}

export interface ContoNegozio { ricavi: number; merce: number | null; personale: number; affitto: number; spese: number; allestimenti: number; lascia: number | null }
/** Conto a scalare di un negozio sui mesi gennaio-meseConto. */
export function contoNegozio(n: Negozio, c: Cruscotto): ContoNegozio {
  const M = c.meseConto, ricavi = fino(n.y1, M)
  const merce = n.moda1 && n.moda1.vendite > 0 ? ricavi * (n.moda1.costo / n.moda1.vendite) : null
  const personale = fino(n.personale, M) + n.ammQuota, affitto = fino(n.affitto, M), spese = fino(n.spese, M), allestimenti = fino(n.allestimenti, M)
  return { ricavi, merce, personale, affitto, spese, allestimenti, lascia: merce != null ? ricavi - merce - personale - affitto - spese : null }
}

export interface Avviso { livello: 'critico' | 'serio' | 'attenzione' | 'info' | 'buono'; titolo: string; dettaglio: string }
const eur = (v: number) => '€ ' + new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(Math.round(v))
export const eurCompatto = (v: number): string => {
  const a = Math.abs(v)
  if (a >= 1e6) return '€ ' + new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(v / 1e6) + ' mln'
  if (a >= 1000) return '€ ' + new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(Math.round(v / 1000)) + ' mila'
  return eur(v)
}
const pct1 = (v: number) => (v > 0 ? '+' : '') + new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v) + '%'
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

/** Avvisi scritti dal sistema sui numeri del giorno. */
export function avvisi(c: Cruscotto): Avviso[] {
  const out: Avviso[] = []
  const aperti = c.negozi.filter(n => !n.chiuso)
  const s = c.scaduto
  const totScad = s ? s.oltre30 + s.ultimi30 : 0
  if (s && s.primo_fornitore && totScad > 0 && s.primo_fornitore.importo / totScad >= 0.5) {
    const f = s.primo_fornitore
    out.push({ livello: 'critico', titolo: `${f.nome} vale ${eurCompatto(f.importo)} dei ${eurCompatto(totScad)} scaduti (${f.fatture} fatture).`, dettaglio: `La fattura più vecchia scadeva il ${f.dal.split('-').reverse().join('/')}. Senza ${f.nome} lo scaduto è ${eurCompatto(totScad - f.importo)}.` })
  } else if (totScad > 0 && s) {
    out.push({ livello: 'serio', titolo: `Fornitori scaduti: ${eurCompatto(totScad)} su ${s.fatture_scadute} fatture.`, dettaglio: `Di cui ${eurCompatto(s.oltre30)} scaduti da oltre 30 giorni.` })
  }
  const mp = mesePieno(c), lfl = paritaInsieme(aperti, mp)
  if (lfl != null && lfl < 0) out.push({ livello: 'critico', titolo: `Ricavi a parità di negozi ${pct1(lfl)} sull'anno prima.`, dettaglio: `Gennaio-${MESI_LUNGHI[mp - 1] || ''}, solo i mesi pieni aperti in tutti e due gli anni.` })
  if (c.liquidita && s) {
    const usc = totScad + s.entro30
    if (usc > 0 && c.liquidita.saldo < usc) out.push({ livello: 'serio', titolo: `La liquidità copre il ${Math.round(c.liquidita.saldo / usc * 100)}% di scaduto e uscite dei prossimi 30 giorni.`, dettaglio: `${eurCompatto(c.liquidita.saldo)} sui conti, ${eurCompatto(usc)} da pagare.` })
  }
  // mese in corso contro lo stesso mese dell'anno prima, in proporzione ai giorni
  if (c.meseParziale && c.giornoUltimo > 0) {
    const i = c.meseUltimo - 1
    for (const n of aperti) {
      if (!n.aperturaMese || n.aperturaMese > c.meseUltimo || !n.y0[i] || !n.y1[i]) continue
      const p = (n.y1[i] / (n.y0[i] * c.giornoUltimo / c.giorniMese) - 1) * 100
      if (p <= -10) out.push({ livello: 'serio', titolo: `${n.nome} a ${MESI_LUNGHI[i]} è ${pct1(p)} sullo stesso mese dell'anno prima.`, dettaglio: `Primi ${c.giornoUltimo} giorni contro la stessa parte del mese dell'anno prima.` })
    }
    for (const n of aperti) {
      if (!n.budget || !n.budget[i] || !n.y1[i] || n.aperturaMese) continue
      const proj = n.y1[i] / c.giornoUltimo * c.giorniMese
      if (proj >= n.budget[i] * 1.1) out.push({ livello: 'buono', titolo: `${n.nome}: ${eurCompatto(n.y1[i])} nei primi ${c.giornoUltimo} giorni, in proiezione al ${Math.round(proj / n.budget[i] * 100)}% del budget del mese.`, dettaglio: 'Negozio nuovo: nessun anno prima da confrontare.' })
    }
  }
  // budget
  const conBudget = aperti.filter(n => n.budget)
  if (!conBudget.length) out.push({ livello: 'info', titolo: 'Nessun budget dei ricavi per quest\'anno.', dettaglio: 'La stima di chiusura usa i mesi che mancano dell\'anno prima con la crescita a parità di negozi.' })
  else if (mp > 0) {
    const b = somma(conBudget.map(n => fino(n.budget as Mesi, mp))), r = somma(conBudget.map(n => fino(n.y1, mp)))
    if (b > 0) out.push({ livello: Math.abs(r / b - 1) < 0.02 ? 'info' : r >= b ? 'buono' : 'attenzione', titolo: `Ricavi contro budget, gennaio-${MESI_LUNGHI[mp - 1]}: ${pct1((r / b - 1) * 100)}.`, dettaglio: `${eurCompatto(r)} incassati, budget ${eurCompatto(b)}.` })
  }
  // affitti mancanti
  const M = c.meseConto
  for (const n of aperti) if (fino(n.y1, M) > 0 && fino(n.affitto, M) === 0) out.push({ livello: 'attenzione', titolo: `${n.nome}: nessuna fattura d'affitto da gennaio a ${MESI_LUNGHI[M - 1] || ''}.`, dettaglio: c.sede && fino(c.sede.affitto, M) > 0 ? `Gli affitti arrivati sono tutti della sede (${eurCompatto(fino(c.sede.affitto, M))}). Se il negozio ne paga uno, quelle fatture mancano e il suo margine è troppo alto.` : 'Se il negozio paga un affitto, quelle fatture mancano e il suo margine è troppo alto.' })
  // allestimenti importanti
  for (const n of aperti) { const a = fino(n.allestimenti, M); if (a >= 20000) out.push({ livello: 'info', titolo: `${n.nome}: ${eurCompatto(a)} di allestimenti.`, dettaglio: 'Spese una tantum: stanno nella colonna a parte, fuori dal margine del negozio.' }) }
  // dati fermi
  if (c.meseUltimo && c.oggi) {
    const ultimo = new Date(c.anno, c.meseUltimo - 1, c.giornoUltimo), oggi = new Date(c.oggi)
    const gg = Math.round((oggi.getTime() - ultimo.getTime()) / 86400000)
    if (gg > 10 && c.anno === oggi.getFullYear()) out.push({ livello: 'attenzione', titolo: `I ricavi arrivano fino al ${c.giornoUltimo}/${c.meseUltimo}.`, dettaglio: 'Il cruscotto si ferma lì finché non arrivano i dati dei giorni dopo (chiusure di cassa o registro corrispettivi).' })
  }
  out.push({ livello: 'info', titolo: 'La merce venduta viene da MODA, non dal bilancio.', dettaglio: 'Il costo della merce di MODA è più alto di quello del bilancio: finché non si chiarisce, la colonna «Lascia all\'azienda» è prudente.' })
  const ordine = { critico: 0, serio: 1, attenzione: 2, buono: 3, info: 4 }
  return out.sort((a, b) => ordine[a.livello] - ordine[b.livello])
}
