#!/usr/bin/env node
/**
 * Assembla i frammenti JSON delle guide (uno per pagina) in un unico file
 * sorgente TypeScript `src/data/pageGuides.ts` (fonte unica delle guide).
 *
 * Uso:  GUIDES_DIR=/percorso/ai/frammenti node tools/assemble-guides.mjs
 *
 * Ogni frammento <slug>.json deve avere:
 *   { title, description, sections:[{heading, body, steps?}], faq:[{q,a}] }
 *
 * L'ordine, la rotta e l'icona di ogni pagina sono definiti in ROUTE_META.
 * NB: il file generato è comunque MODIFICABILE a mano (regola CLAUDE.md):
 * dopo la prima generazione si aggiorna direttamente lì.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const GUIDES_DIR = process.env.GUIDES_DIR
if (!GUIDES_DIR) {
  console.error('Manca GUIDES_DIR')
  process.exit(1)
}

// slug -> rotta canonica + nome icona lucide (mappata nel componente)
const ROUTE_META = [
  ['dashboard', '/', 'LayoutDashboard'],
  ['outlet-operativi', '/outlet/operativi', 'Store'],
  ['outlet-valutazione', '/outlet/valutazione', 'Store'],
  ['confronto-outlet', '/confronto-outlet', 'GitCompare'],
  ['margini', '/margini', 'BarChart3'],
  ['margini-categoria', '/margini-categoria', 'BarChart3'],
  ['scadenzario', '/scadenzario', 'Receipt'],
  ['storico-distinte', '/storico-distinte', 'Receipt'],
  ['banche', '/banche', 'Landmark'],
  ['ai-categorie', '/ai-categorie', 'Sparkles'],
  ['dipendenti', '/dipendenti', 'Users'],
  ['conto-economico', '/conto-economico', 'BarChart3'],
  ['budget', '/budget', 'Calculator'],
  ['stock', '/stock', 'Package'],
  ['analytics-pos', '/analytics-pos', 'BarChart3'],
  ['cash-flow', '/cash-flow', 'Wallet'],
  ['open-to-buy', '/open-to-buy', 'Wallet'],
  ['produttivita', '/produttivita', 'Users'],
  ['scenario', '/scenario', 'BarChart3'],
  ['store-manager', '/store-manager', 'Store'],
  ['import-hub', '/import-hub', 'DatabaseZap'],
  ['fornitori', '/fornitori', 'Building2'],
  ['scheda-contabile-fornitore', '/fornitori/scheda-contabile', 'Building2'],
  ['fatturazione', '/fatturazione', 'FileCode'],
  ['fatturazione-nuova-acube', '/fatturazione/nuova-acube', 'FileCode'],
  ['fatturazione-converti-xml', '/fatturazione/converti-xml', 'FileCode'],
  ['scadenze-fiscali', '/scadenze-fiscali', 'CalendarClock'],
  ['archivio', '/archivio', 'Archive'],
  ['impostazioni', '/impostazioni', 'Settings'],
  ['report-sincronizzazioni', '/report-sincronizzazioni', 'DatabaseZap'],
  ['profilo', '/profilo', 'UserCircle'],
  ['ticket', '/ticket', 'FileText'],
  ['ticket-admin', '/ticket/admin', 'FileText'],
]

const guides = []
const missing = []

for (const [slug, path, icon] of ROUTE_META) {
  const file = join(GUIDES_DIR, `${slug}.json`)
  if (!existsSync(file)) {
    missing.push(slug)
    continue
  }
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`JSON non valido per ${slug}: ${e.message}`)
    process.exit(1)
  }
  guides.push({
    path,
    icon,
    title: data.title,
    description: data.description,
    sections: (data.sections || []).map((s) => ({
      heading: s.heading,
      body: s.body,
      ...(Array.isArray(s.steps) && s.steps.length ? { steps: s.steps } : {}),
    })),
    faq: (data.faq || []).map((f) => ({ q: f.q, a: f.a })),
  })
}

if (missing.length) {
  console.error(`⚠ Frammenti mancanti: ${missing.join(', ')}`)
  process.exit(2)
}

const header = `// ─────────────────────────────────────────────────────────────────────────────
// FONTE UNICA DELLE GUIDE PAGINA — usata da HelpPanel (tab "Guida") e
// dall'assistente AI (edge function help-chat, che riceve la guida come contesto).
//
// ⚠️ REGOLA (CLAUDE.md): ogni volta che modifichi/aggiungi una funzione di una
// pagina, aggiorna QUI la voce corrispondente nello stesso commit. La CI
// (tools/check-guide-alignment.mjs) blocca la PR se dimentichi di farlo.
// Le voci sono state generate leggendo il codice reale, ma da ora si aggiornano
// a mano insieme al codice.
// ─────────────────────────────────────────────────────────────────────────────

export interface GuideSection {
  heading: string
  body: string
  steps?: string[]
}

export interface GuideFaq {
  q: string
  a: string
}

export interface PageGuide {
  /** Rotta canonica della pagina (chiave di matching). */
  path: string
  /** Nome icona lucide (mappato in HelpPanel). */
  icon: string
  title: string
  description: string
  sections: GuideSection[]
  faq: GuideFaq[]
}

export const PAGE_GUIDES: PageGuide[] = `

const body = JSON.stringify(guides, null, 2)

writeFileSync(join(process.cwd(), 'src/data/pageGuides.ts'), header + body + '\n', 'utf8')
console.log(`✓ Scritto src/data/pageGuides.ts con ${guides.length} guide.`)
