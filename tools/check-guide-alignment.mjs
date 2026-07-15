#!/usr/bin/env node
/**
 * Guardia di allineamento GUIDE ↔ CODICE (regola CLAUDE.md).
 *
 * Regola: ogni volta che si modifica/aggiunge/crea una funzione in una PAGINA
 * (o in un componente che ne implementa una sezione), la guida utente di quella
 * pagina DEVE essere aggiornata nello stesso commit/PR.
 *
 * Questo script confronta i file cambiati nella PR con `src/data/pageGuides.ts`:
 * se cambia codice "guida-rilevante" ma la fonte delle guide NON viene toccata,
 * esce con codice 1 e BLOCCA la CI, elencando le guide da rivedere.
 *
 * Uso:
 *   node tools/check-guide-alignment.mjs            # base = origin/main
 *   BASE_SHA=<sha> node tools/check-guide-alignment.mjs
 *
 * Bypass volontario (usare con parsimonia, es. refactor puramente interno che
 * non cambia nulla per l'utente): includere nel messaggio dell'ultimo commit
 * la stringa  [skip-guide-check]  .
 */

import { execSync } from 'node:child_process'

const GUIDES_FILE = 'src/data/pageGuides.ts'

// File di codice che, se cambiano, implicano una revisione della guida.
// Chiave = file sorgente ; valore = slug/e guida coinvolte (solo per il messaggio).
const SOURCE_TO_GUIDES = {
  'src/pages/Dashboard.tsx': ['dashboard'],
  'src/pages/Outlet.tsx': ['outlet-operativi', 'outlet-valutazione'],
  'src/components/OutletWizard.tsx': ['outlet-operativi'],
  'src/components/OutletValutazione.tsx': ['outlet-valutazione'],
  'src/pages/ConfrontoOutlet.tsx': ['confronto-outlet'],
  'src/pages/MarginiOutlet.tsx': ['margini'],
  'src/pages/MarginiCategoria.tsx': ['margini-categoria'],
  'src/pages/Scadenzario.tsx': ['scadenzario'],
  'src/pages/ScadenzarioSmart.tsx': ['scadenzario'],
  'src/components/ScadenzarioSmart.tsx': ['scadenzario'],
  'src/pages/StoricoDistinte.tsx': ['storico-distinte'],
  'src/pages/Banche.tsx': ['banche'],
  'src/components/OpenBankingAcube.tsx': ['banche'],
  'src/components/AICategorization.tsx': ['banche', 'ai-categorie'],
  'src/components/PaymentAnomaliesPanel.tsx': ['banche'],
  'src/pages/AICategoriePage.tsx': ['ai-categorie'],
  'src/pages/Dipendenti.tsx': ['dipendenti'],
  'src/pages/ContoEconomico.tsx': ['conto-economico'],
  'src/pages/BudgetControl.tsx': ['budget'],
  'src/pages/StockSellthrough.tsx': ['stock'],
  'src/pages/AnalyticsPOS.tsx': ['analytics-pos'],
  'src/pages/CashFlow.tsx': ['cash-flow'],
  'src/pages/CashflowProspettico.tsx': ['cash-flow'],
  'src/pages/OpenToBuy.tsx': ['open-to-buy'],
  'src/pages/Produttivita.tsx': ['produttivita'],
  'src/pages/ScenarioPlanning.tsx': ['scenario'],
  'src/pages/StoreManager.tsx': ['store-manager'],
  'src/pages/ImportHub.tsx': ['import-hub'],
  'src/pages/Fornitori.tsx': ['fornitori'],
  'src/components/SupplierAllocationEditor.tsx': ['fornitori'],
  'src/pages/SchedaContabileFornitore.tsx': ['scheda-contabile-fornitore'],
  'src/pages/Fatturazione.tsx': ['fatturazione'],
  'src/pages/AcubeFatturaForm.tsx': ['fatturazione-nuova-acube'],
  'src/pages/ConvertitoreFattureXML.tsx': ['fatturazione-converti-xml'],
  'src/pages/ScadenzeFiscali.tsx': ['scadenze-fiscali'],
  'src/pages/ArchivioDocumenti.tsx': ['archivio'],
  'src/pages/Impostazioni.tsx': ['impostazioni'],
  'src/pages/ReportSincronizzazioni.tsx': ['report-sincronizzazioni'],
  'src/pages/Profilo.tsx': ['profilo'],
  'src/pages/Ticket.tsx': ['ticket'],
  'src/pages/TicketAdmin.tsx': ['ticket-admin'],
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}

function resolveBase() {
  if (process.env.BASE_SHA) return process.env.BASE_SHA
  try {
    sh('git rev-parse --verify origin/main')
    return 'origin/main'
  } catch {
    return 'HEAD~1'
  }
}

function main() {
  const base = resolveBase()
  let changed = []
  try {
    changed = sh(`git diff --name-only ${base}...HEAD`).split('\n').filter(Boolean)
  } catch {
    // Fallback: diff a due punti se la merge-base non è disponibile
    changed = sh(`git diff --name-only ${base} HEAD`).split('\n').filter(Boolean)
  }

  // Bypass esplicito nel messaggio dell'ultimo commit
  const lastMsg = sh('git log -1 --pretty=%B')
  if (lastMsg.includes('[skip-guide-check]')) {
    console.log('✓ [skip-guide-check] presente: controllo guide saltato volontariamente.')
    return
  }

  const guideTouched = changed.includes(GUIDES_FILE)
  const touchedSources = changed.filter((f) => f in SOURCE_TO_GUIDES)

  if (touchedSources.length === 0) {
    console.log('✓ Nessuna pagina guida-rilevante modificata: controllo non necessario.')
    return
  }

  if (guideTouched) {
    console.log(`✓ Guide allineate: ${GUIDES_FILE} è stato aggiornato insieme al codice.`)
    return
  }

  const slugs = [...new Set(touchedSources.flatMap((f) => SOURCE_TO_GUIDES[f]))]
  console.error('\n✗ GUIDE NON ALLINEATE — la CI è bloccata.\n')
  console.error('Hai modificato queste pagine/componenti:')
  touchedSources.forEach((f) => console.error(`   - ${f}  → guida: ${SOURCE_TO_GUIDES[f].join(', ')}`))
  console.error(`\nMa NON hai aggiornato ${GUIDES_FILE}.`)
  console.error('\nRegola (CLAUDE.md): ogni modifica a una funzione deve aggiornare la guida della pagina.')
  console.error(`Aggiorna le voci [ ${slugs.join(', ')} ] in ${GUIDES_FILE} e ripeti il push.`)
  console.error('Se il cambiamento non tocca nulla lato utente, aggiungi "[skip-guide-check]" al messaggio di commit.\n')
  process.exit(1)
}

main()
