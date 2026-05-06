/**
 * check-version-drift.ts
 *
 * Verifica che tutti i tenant siano alla stessa versione della pipeline
 * migrazioni. Confronta le righe di public._migrations_log su ogni tenant
 * con la lista master di file in supabase/migrations.
 *
 * Output: tabella alias × migrazione, con marker [✓]/[ ]/[!] (extra in DB).
 *
 * Uso:
 *   npx tsx check-version-drift.ts
 *   npx tsx check-version-drift.ts --only made-retail,zago
 */

import { arg } from './lib/cli.js'
import { listAppliedMigrations, withClient } from './lib/db.js'
import { listMigrationFiles } from './lib/migrations.js'
import { listAliases, loadTenants } from './lib/tenants-store.js'

async function main(): Promise<void> {
  const tenants = loadTenants()
  if (Object.keys(tenants.tenants).length === 0) {
    console.log('ℹ️  Nessun tenant registrato in tenants.json.')
    return
  }
  const onlyArg = arg('only')
  const aliases = onlyArg
    ? listAliases().filter((a) =>
        onlyArg.split(',').map((x) => x.trim()).includes(a)
      )
    : listAliases()

  const masterFiles = listMigrationFiles().map((m) => m.filename)
  const masterSet = new Set(masterFiles)

  console.log(`▶  Master: ${masterFiles.length} migrazioni in supabase/migrations/`)
  console.log(`▶  Tenant verificati: ${aliases.join(', ')}\n`)

  const results: Record<string, Set<string>> = {}
  for (const alias of aliases) {
    const t = tenants.tenants[alias]
    if (!t || !t.databaseUrl) {
      console.warn(`⚠️  ${alias}: databaseUrl mancante, salto.`)
      continue
    }
    try {
      const applied = await withClient(
        { databaseUrl: t.databaseUrl },
        (client) => listAppliedMigrations(client)
      )
      results[alias] = applied
    } catch (e) {
      console.error(`❌ ${alias}: connessione fallita — ${(e as Error).message}`)
    }
  }

  // Tabella di riepilogo
  const header = ['migration'.padEnd(60), ...Object.keys(results).map((a) => a.padEnd(14))]
  console.log(header.join(''))
  console.log('-'.repeat(header.join('').length))
  let drift = false
  for (const m of masterFiles) {
    const cells = [m.padEnd(60)]
    for (const alias of Object.keys(results)) {
      const set = results[alias]
      const present = set.has(m) ? '✓' : ' '
      if (!set.has(m)) drift = true
      cells.push(present.padEnd(14))
    }
    console.log(cells.join(''))
  }

  // Extra in DB non presenti in master
  for (const [alias, set] of Object.entries(results)) {
    for (const f of set) {
      if (!masterSet.has(f)) {
        console.log(`! ${alias}: migrazione "${f}" presente nel DB ma non nel repo`)
        drift = true
      }
    }
  }

  if (drift) {
    console.log('\n❌ Drift rilevato. Lancia sync-migrations-all per allineare.')
    process.exit(1)
  } else {
    console.log('\n✅ Nessun drift: tutti i tenant alla stessa versione.')
  }
}

main().catch((err) => {
  console.error('❌ check-version-drift fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
