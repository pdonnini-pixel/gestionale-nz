/**
 * full-provision.ts
 *
 * Orchestratore: crea un tenant da zero (project Supabase, migrazioni,
 * Edge Functions, vault, utenti seed). Idempotente: ogni step skippa se già fatto.
 *
 * Uso:
 *   npx tsx full-provision.ts <alias> "<displayName>"
 *
 * Esempio:
 *   npx tsx full-provision.ts made-retail "Made Retail Srl"
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { requirePositional } from './lib/cli.js'
import { getTenant } from './lib/tenants-store.js'

const here = dirname(fileURLToPath(import.meta.url))

const SEED_USERS: { email: string; roles: string[] }[] = [
  { email: 'pdonnini@gmail.com', roles: ['super_advisor'] },
  { email: 'lilianmammoliti@gmail.com', roles: ['budget_approver'] },
  { email: 'sabrina@newzago.it', roles: ['contabile'] },
  { email: 'veronica@newzago.it', roles: ['contabile'] },
]

function runStep(label: string, script: string, args: string[]): void {
  console.log(`\n━━━ ${label} ━━━`)
  const r = spawnSync('npx', ['tsx', resolve(here, script), ...args], {
    stdio: 'inherit',
    env: process.env,
  })
  if (r.status !== 0) {
    throw new Error(`Step "${label}" fallito (exit ${r.status}). Riesegui full-provision per riprendere.`)
  }
}

async function main(): Promise<void> {
  const alias = requirePositional(0, 'alias (es. made-retail)')
  const displayName = requirePositional(1, 'displayName (es. "Made Retail Srl")')

  console.log(`╔════════════════════════════════════════════════════════════════╗`)
  console.log(`║  FULL PROVISION — alias=${alias}, name="${displayName}"`)
  console.log(`╚════════════════════════════════════════════════════════════════╝`)

  runStep('1/5 create-tenant', 'create-tenant.ts', [alias, displayName])
  runStep('2/5 apply-migrations', 'apply-migrations.ts', [alias])
  runStep('3/5 deploy-edge-functions', 'deploy-edge-functions.ts', [alias])
  runStep('4/5 setup-vault', 'setup-vault.ts', [alias])

  console.log(`\n━━━ 5/5 create seed users ━━━`)
  for (const u of SEED_USERS) {
    const roleArgs = u.roles.flatMap((r) => ['--role', r])
    runStep(`   utente ${u.email}`, 'create-user.ts', [
      alias,
      '--email',
      u.email,
      ...roleArgs,
    ])
  }

  const tenant = getTenant(alias)
  if (!tenant) throw new Error('tenants.json non aggiornato dopo create-tenant')

  console.log(`\n╔════════════════════════════════════════════════════════════════╗`)
  console.log(`║  ✅ Provisioning completato`)
  console.log(`║`)
  console.log(`║  alias:        ${tenant.alias}`)
  console.log(`║  displayName:  ${tenant.displayName}`)
  console.log(`║  project_ref:  ${tenant.projectRef}`)
  console.log(`║  region:       ${tenant.region}`)
  console.log(`║  anon_key:     ${tenant.anonKey.slice(0, 20)}…`)
  console.log(`║`)
  console.log(`║  Prossimi step manuali:`)
  console.log(`║   • Configurare env vars sul site Netlify del tenant:`)
  console.log(`║       VITE_SUPABASE_URL_${alias.replace(/-/g, '_').toUpperCase()}`)
  console.log(`║       VITE_SUPABASE_ANON_KEY_${alias.replace(/-/g, '_').toUpperCase()}`)
  console.log(`║   • Lilian completa il wizard onboarding sul tenant per popolare`)
  console.log(`║     companies/outlets/chart_of_accounts.`)
  console.log(`║   • Inserire valori reali nei secret YAPILY_*/SDI_* via dashboard`)
  console.log(`║     se/quando il tenant si accredita.`)
  console.log(`╚════════════════════════════════════════════════════════════════╝`)
}

main().catch((err) => {
  console.error('❌ full-provision fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
