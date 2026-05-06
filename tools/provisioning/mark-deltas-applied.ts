/**
 * mark-deltas-applied.ts
 *
 * Per i tenant che hanno già il baseline applicato MA che il baseline
 * stesso NON ha ancora marcato le 7 migrazioni delta come applicate
 * (versione 1 del baseline). Esegue il blocco INSERT INTO _migrations_log
 * con ON CONFLICT DO NOTHING.
 *
 * Idempotente. Una volta runnato, apply-migrations skippa le 7 delta.
 *
 * Uso:
 *   npx tsx mark-deltas-applied.ts <alias>
 */

import { requirePositional } from './lib/cli.js'
import { getTenant } from './lib/tenants-store.js'
import { withClient } from './lib/db.js'

const DELTAS = [
  '20260417_001_add_company_id_rls_policies_16_tables.sql',
  '20260417_002_remove_legacy_auth_policies.sql',
  '20260417_003_add_company_id_3_tables.sql',
  '20260417_004_create_yapily_tables.sql',
  '20260417_005_create_get_yapily_credentials_rpc.sql',
  '20260417_006_add_yapily_source_and_link.sql',
  '20260421_007_budget_entries_fix_and_bilancio_gap.sql',
] as const

async function main(): Promise<void> {
  const alias = requirePositional(0, 'alias')
  const tenant = getTenant(alias)
  if (!tenant) throw new Error(`tenant "${alias}" non trovato`)
  if (!tenant.databaseUrl) throw new Error(`databaseUrl mancante per ${alias}`)

  await withClient({ databaseUrl: tenant.databaseUrl }, async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public._migrations_log (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now(),
        checksum text NOT NULL
      );
    `)
    for (const f of DELTAS) {
      await client.query(
        `INSERT INTO public._migrations_log (filename, checksum) VALUES ($1, 'incorporated-in-baseline') ON CONFLICT (filename) DO NOTHING`,
        [f],
      )
    }
    const r = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public._migrations_log WHERE checksum = 'incorporated-in-baseline'`,
    )
    console.log(`✅ ${r.rows[0].count} delta marcate come incorporated-in-baseline su "${alias}"`)
  })
}

main().catch((err) => {
  console.error('❌ mark-deltas-applied fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
