/**
 * apply-migrations.ts
 *
 * Applica tutte le migrazioni di frontend/supabase/migrations al tenant
 * indicato. Idempotente: usa la tabella public._migrations_log per saltare
 * quelle già applicate.
 *
 * Uso:
 *   npx tsx apply-migrations.ts <alias>
 *
 * Esempio:
 *   npx tsx apply-migrations.ts made-retail
 */

import { requirePositional } from './lib/cli.js'
import { getTenant } from './lib/tenants-store.js'
import {
  ensureMigrationsLogTable,
  listAppliedMigrations,
  recordMigration,
  withClient,
} from './lib/db.js'
import { listMigrationFiles } from './lib/migrations.js'

async function main(): Promise<void> {
  const alias = requirePositional(0, 'alias (es. made-retail)')
  const tenant = getTenant(alias)
  if (!tenant) {
    throw new Error(`Tenant "${alias}" non trovato in tenants.json. Lancia prima create-tenant.ts.`)
  }
  if (!tenant.databaseUrl) {
    throw new Error(`databaseUrl mancante per "${alias}". Completalo manualmente in tenants.json.`)
  }

  const files = listMigrationFiles()
  console.log(`▶  Trovate ${files.length} migrazioni in supabase/migrations`)

  const applied: string[] = []
  const skipped: string[] = []

  await withClient({ databaseUrl: tenant.databaseUrl }, async (client) => {
    await ensureMigrationsLogTable(client)
    const already = await listAppliedMigrations(client)

    for (const m of files) {
      if (already.has(m.filename)) {
        skipped.push(m.filename)
        continue
      }
      // Some DDL statements (e.g. ALTER TYPE … ADD VALUE) cannot run inside
      // an explicit transaction. Migrations starting with `-- @no-transaction`
      // are applied in autocommit, then the log row is written separately.
      const noTx = /^\s*--\s*@no-transaction\b/.test(m.sql)

      console.log(`   ▶ applico ${m.filename}${noTx ? ' (no-tx)' : ''} …`)
      if (noTx) {
        try {
          await client.query(m.sql)
          await recordMigration(client, m.filename, m.checksum)
          applied.push(m.filename)
        } catch (err) {
          throw new Error(
            `Migrazione ${m.filename} fallita: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      } else {
        try {
          await client.query('BEGIN')
          await client.query(m.sql)
          await recordMigration(client, m.filename, m.checksum)
          await client.query('COMMIT')
          applied.push(m.filename)
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined)
          throw new Error(
            `Migrazione ${m.filename} fallita: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
    }
  })

  console.log(`✅ Tenant "${alias}":`)
  console.log(`   applicate: ${applied.length} (${applied.join(', ') || '—'})`)
  console.log(`   skippate:  ${skipped.length}`)
}

main().catch((err) => {
  console.error('❌ apply-migrations fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
