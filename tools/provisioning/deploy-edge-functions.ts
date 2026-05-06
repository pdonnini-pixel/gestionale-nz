/**
 * deploy-edge-functions.ts
 *
 * Deploya tutte le Edge Functions di supabase/functions al tenant indicato.
 * Usa la Supabase CLI (`supabase functions deploy`) sotto, autenticata via
 * SUPABASE_ACCESS_TOKEN env (la CLI lo legge automaticamente).
 *
 * Uso:
 *   npx tsx deploy-edge-functions.ts <alias>
 */

import { requirePositional } from './lib/cli.js'
import { getTenant } from './lib/tenants-store.js'
import { readEnv } from './lib/env.js'
import { deployFunction, listEdgeFunctions } from './lib/edge-functions.js'

async function main(): Promise<void> {
  const alias = requirePositional(0, 'alias (es. made-retail)')
  const tenant = getTenant(alias)
  if (!tenant) {
    throw new Error(`Tenant "${alias}" non trovato in tenants.json. Lancia prima create-tenant.ts.`)
  }
  const env = readEnv()
  // La CLI Supabase legge SUPABASE_ACCESS_TOKEN dall'ambiente. Forziamolo.
  process.env.SUPABASE_ACCESS_TOKEN = env.accessToken

  const fns = listEdgeFunctions()
  console.log(`▶  Trovate ${fns.length} Edge Functions: ${fns.join(', ')}`)
  console.log(`▶  Target tenant "${alias}" (project_ref ${tenant.projectRef})`)

  const failed: string[] = []
  for (const fn of fns) {
    process.stdout.write(`   ▶ deploy ${fn} … `)
    const r = deployFunction(env.cli, tenant.projectRef, fn)
    if (r.ok) {
      console.log('OK')
    } else {
      console.log('FALLITO')
      console.log(r.stderr || r.stdout)
      failed.push(fn)
    }
  }

  if (failed.length > 0) {
    throw new Error(`Deploy fallito per: ${failed.join(', ')}`)
  }
  console.log(`✅ Tutte le Edge Functions deployate su "${alias}".`)
}

main().catch((err) => {
  console.error('❌ deploy-edge-functions fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
