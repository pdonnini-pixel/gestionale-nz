import type { CompanyLabels } from '../hooks/useCompanyLabels'

/**
 * Adatta un testo scritto con la parola «outlet» (guide, testi fissi lunghi)
 * all'etichetta del tenant: su NZ («Outlet») il testo resta identico, su Zago
 * diventa «negozio/negozi» con articoli e preposizioni giusti.
 *
 * Restano come sono i valori letterali che il gestionale scrive o legge davvero:
 * «Outlet: CODICE» (nota dei movimenti), il tipo «Outlet, Retail, Corner» e le
 * intestazioni del file della Prima Nota («Outlet, Canale»).
 */
export function adattaTermini(testo: string, labels: CompanyLabels): string {
  if (!testo || labels.pointOfSaleLower === 'outlet') return testo
  const sing = labels.pointOfSaleLower
  const plur = labels.pointOfSalePluralLower
  const artPl = labels.art.i.split(' ')[0] // «gli» o «i»
  const artSi = labels.art.il.startsWith("l'") ? "l'" : labels.art.il.split(' ')[0] // «l'», «il», «lo»
  const maiusc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const comeOrig = (orig: string, nuovo: string) => (/^[A-ZÀ-Ù]/.test(orig) ? maiusc(nuovo) : nuovo)

  // Letterali protetti.
  const protetti: string[] = []
  let t = testo.replace(/Outlet(?=: )|Outlet(?=, (?:Retail|Canale))/g, (m) => {
    protetti.push(m)
    return `\u0000${protetti.length - 1}\u0000`
  })

  // Titoli di pagina al plurale.
  t = t.replace(/\b(Confronto|Margini) Outlet\b/g, (_m, p: string) => `${p} ${labels.pointOfSalePlural}`)
  t = t.replace(/\bOutlet operativi\b/g, `${labels.pointOfSalePlural} operativi`)
  t = t.replace(/\(Outlet\)/g, `(${labels.pointOfSalePlural})`)

  // Plurali con articolo o preposizione articolata.
  const prepPl: Record<string, string> = { gli: '', degli: 'de', agli: 'a', sugli: 'su', negli: 'ne', dagli: 'da' }
  t = t.replace(/\b(gli|degli|agli|sugli|negli|dagli)\s+outlet\b/gi, (m, a: string) => {
    const pre = prepPl[a.toLowerCase()]
    const art = pre === '' ? artPl : pre + (artPl === 'i' ? 'i' : 'gli')
    return comeOrig(m, `${art} ${plur}`)
  })

  // Singolari con articolo apostrofato: le forme vengono da labels.art.
  const formeSi: Record<string, string> = {
    "l'": labels.art.il,
    "dell'": labels.art.del,
    "all'": labels.art.al,
    "nell'": labels.art.nel,
    "dall'": labels.art.dal,
    "sull'": labels.art.al.replace(/^a/, 'su'),
  }
  t = t.replace(/\b(l'|dell'|all'|sull'|nell'|dall')outlet\b/gi, (m, a: string) => comeOrig(m, formeSi[a.toLowerCase()]))
  t = t.replace(/\bquell'outlet\b/gi, (m) =>
    comeOrig(m, artSi === "l'" ? `quell'${sing}` : artSi === 'lo' ? `quello ${sing}` : `quel ${sing}`))

  // Plurale dopo le parole che lo chiedono.
  t = t.replace(/\b(più|quanti|tutti i|altri|alcuni|diversi|vari|molti|pochi|due|tre|quattro|cinque|sei|sette|otto|\d+)\s+outlet\b/gi,
    (_m, p: string) => `${p} ${plur}`)

  // Tutto il resto al singolare.
  t = t.replace(/\b[Oo]utlet\b/g, (m) => comeOrig(m, sing))

  return t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => protetti[Number(i)])
}

/** Adatta tutti i testi di una guida di pagina (titolo, sezioni, passi, FAQ). */
export function adattaGuida<G extends {
  title: string
  description: string
  sections: { heading: string; body: string; steps?: string[] }[]
  faq: { q: string; a: string }[]
}>(guide: G, labels: CompanyLabels): G {
  if (labels.pointOfSaleLower === 'outlet') return guide
  const a = (s: string) => adattaTermini(s, labels)
  return {
    ...guide,
    title: a(guide.title),
    description: a(guide.description),
    sections: guide.sections.map((s) => ({ ...s, heading: a(s.heading), body: a(s.body), steps: s.steps?.map(a) })),
    faq: guide.faq.map((f) => ({ ...f, q: a(f.q), a: a(f.a) })),
  }
}
