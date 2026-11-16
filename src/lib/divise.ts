// Divise e acquisti delle dipendenti (Patrizio, 16/11/2026; migration 422).
// Tre voci: divisa fornita dall'azienda (la dipendente non paga), divisa con sconto,
// acquisto personale. Una divisa è un insieme di pezzi letti sotto lo stesso numero,
// tutta fornita oppure tutta con sconto. Il prezzo outlet lo scrive la dipendente in
// negozio; la sede può correggerlo (vale la correzione). Lo sconto è fissato sul capo
// al momento della registrazione. Funzioni pure: nessuna query. Test in divise.test.ts.

export type VoceCapo = 'divisa_fornita' | 'divisa_sconto' | 'acquisto'
export type TipoDivisa = 'fornita' | 'sconto'

export const VOCI: { k: VoceCapo; nome: string; sotto: string }[] = [
  { k: 'divisa_fornita', nome: 'Divisa fornita dall’azienda', sotto: 'la divisa che ti dà l’azienda' },
  { k: 'divisa_sconto', nome: 'Divisa con sconto', sotto: 'una divisa in più, o pezzi in più della divisa' },
  { k: 'acquisto', nome: 'Acquisto personale', sotto: 'capi per te, non della divisa' },
]
export const NOME_VOCE: Record<VoceCapo, string> = {
  divisa_fornita: 'Divisa fornita dall’azienda',
  divisa_sconto: 'Divisa con sconto',
  acquisto: 'Acquisto personale',
}
export const ETICHETTA_VOCE: Record<VoceCapo, string> = {
  divisa_fornita: 'fornita dall’azienda',
  divisa_sconto: 'con sconto',
  acquisto: 'acquisto personale',
}

/** Il tipo di divisa di una voce (null per l'acquisto personale). */
export function tipoDellaVoce(v: VoceCapo): TipoDivisa | null {
  return v === 'divisa_fornita' ? 'fornita' : v === 'divisa_sconto' ? 'sconto' : null
}

/** Il prezzo outlet serve per divisa con sconto e acquisto personale; per la divisa fornita è facoltativo. */
export function prezzoObbligatorio(v: VoceCapo): boolean {
  return v !== 'divisa_fornita'
}

/** Il codice a barre come lo accetta il database: 4-40 cifre, lettere, punto o trattino. */
export function codiceValido(c: string): boolean {
  return /^[0-9A-Za-z.-]{4,40}$/.test(c.trim())
}

/** «50», «50,5», «1.234,50», «49.90» → numero; vuoto o non valido → null. */
export function leggiPrezzo(testo: string): number | null {
  let t = testo.trim().replace(/\s|€/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null
}

/** Arrotonda al centesimo. */
export function centesimi(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export interface Capo {
  id: string
  employee_id: string
  outlet_id: string | null
  divisa_id: string | null
  voce: VoceCapo
  codice: string
  prezzo_outlet: number | null
  prezzo_corretto: number | null
  corretto_il: string | null
  corretto_da: string | null
  sconto_pct: number | null
  registrato_il: string
  registrato_con: 'qr' | 'pin'
  scaricato_il: string | null
  scaricato_da: string | null
  addebitato_il: string | null
  addebitato_da: string | null
}

/** Il prezzo che vale: la correzione della sede se c'è, altrimenti quello scritto in negozio. */
export function prezzoCheVale(c: Pick<Capo, 'prezzo_outlet' | 'prezzo_corretto'>): number | null {
  const v = c.prezzo_corretto ?? c.prezzo_outlet
  return v == null ? null : Number(v)
}

/** Quanto vale lo sconto in euro (0 per la divisa fornita o senza prezzo). */
export function valoreSconto(c: Pick<Capo, 'voce' | 'prezzo_outlet' | 'prezzo_corretto' | 'sconto_pct'>): number {
  const p = prezzoCheVale(c)
  if (c.voce === 'divisa_fornita' || p == null) return 0
  return centesimi(p - prezzoDaPagare(c))
}

/** Quanto paga la dipendente: 0 per la divisa fornita; altrimenti prezzo meno lo sconto fissato. */
export function prezzoDaPagare(c: Pick<Capo, 'voce' | 'prezzo_outlet' | 'prezzo_corretto' | 'sconto_pct'>): number {
  if (c.voce === 'divisa_fornita') return 0
  const p = prezzoCheVale(c)
  if (p == null) return 0
  return centesimi(p * (100 - Number(c.sconto_pct ?? 0)) / 100)
}

/** Lo sconto che si applicherebbe oggi: quello personale se c'è, altrimenti lo standard. */
export function scontoEffettivo(personale: number | null | undefined, standard: number | null | undefined): number {
  return Number(personale ?? standard ?? 0)
}

export interface Divisa { id: string; numero: number; tipo: TipoDivisa; outlet_id: string | null; aperta_il: string }

export interface Contatori {
  diviseFornite: number
  capiForniti: number
  diviseSconto: number
  capiSconto: number
  acquisti: number
  daScaricare: number
  daAddebitare: number
  importoDaAddebitare: number
  pagato: number
}

/** I numeri della sezione: divise (non capi) per le divise, capi per gli acquisti. */
export function contatori(capi: Capo[], divise: Divisa[]): Contatori {
  const conPezzi = new Set(capi.map((c) => c.divisa_id).filter(Boolean))
  const da = capi.filter((c) => c.voce !== 'divisa_fornita' && !c.addebitato_il)
  return {
    diviseFornite: divise.filter((d) => d.tipo === 'fornita' && conPezzi.has(d.id)).length,
    capiForniti: capi.filter((c) => c.voce === 'divisa_fornita').length,
    diviseSconto: divise.filter((d) => d.tipo === 'sconto' && conPezzi.has(d.id)).length,
    capiSconto: capi.filter((c) => c.voce === 'divisa_sconto').length,
    acquisti: capi.filter((c) => c.voce === 'acquisto').length,
    daScaricare: capi.filter((c) => !c.scaricato_il).length,
    daAddebitare: da.length,
    importoDaAddebitare: centesimi(da.reduce((a, c) => a + prezzoDaPagare(c), 0)),
    pagato: centesimi(capi.filter((c) => c.voce !== 'divisa_fornita').reduce((a, c) => a + prezzoDaPagare(c), 0)),
  }
}

/** Da sistemare per persona, per l'elenco dei dipendenti. */
export function daSistemarePerPersona(capi: Pick<Capo, 'employee_id' | 'voce' | 'scaricato_il' | 'addebitato_il'>[]): Map<string, { scaricare: number; addebitare: number }> {
  const m = new Map<string, { scaricare: number; addebitare: number }>()
  for (const c of capi) {
    const x = m.get(c.employee_id) ?? { scaricare: 0, addebitare: 0 }
    if (!c.scaricato_il) x.scaricare += 1
    if (c.voce !== 'divisa_fornita' && !c.addebitato_il) x.addebitare += 1
    m.set(c.employee_id, x)
  }
  for (const [k, v] of m) if (!v.scaricare && !v.addebitare) m.delete(k)
  return m
}

export const euro = (n: number | null | undefined): string =>
  n == null ? '·' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n))
export const percento = (n: number | null | undefined): string =>
  n == null ? '·' : `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(Number(n))}%`
