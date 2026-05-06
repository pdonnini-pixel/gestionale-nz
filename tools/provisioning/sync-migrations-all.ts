/**
 * sync-migrations-all.ts
 *
 * Tooling di rollout sincrono per future migrazioni: applica nuove migrazioni
 * (e nuove/modificate Edge Functions) a TUTTI i tenant registrati in
 * tenants.json. Usato dopo ogni release backend per evitare drift.
 *
 * Uso:
 *   npx tsx sync-migrations-all.ts             # tutti i tenant
 *   npx tsx sync-migrations-all.ts --only made-retail,zago
 *   npx tsx sync-migrations-all.ts --skip newzago
 *   npx tsx sync-migrations-all.ts --no-functions   # solo SQL, no edge deploy
 *
 * Idempotente: i sub-script fanno skip su step già completati.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { arg, flag } from './lib/cli.js'
import { listAliases, loadTenants } from './lib/tenants-store.js'

const here = dirname(fileURLToPath(import.meta.url))

function runStep(script: string, args: string[]): boolean {
  const r = spawnSync('npx', ['tsx', resolve(here, script), ...args], {
    stdio: 'inherit',
    env: process.env,
  })
  return r.status === 0
}

function selectTargets(): string[] {
  const all = listAliases()
  const onlyArg = arg('only')
  const skipArg = arg('skip')
  let targets = all
  if (onlyArg) {
    const only = onlyArg.split(',').map((s) => s.trim()).filter(Boolean)
    targets = all.filter((a) => only.includes(a))
  }
  if (skipArg) {
    const skip = new Set(skipArg.split(',').map((s) => s.trim()))
    targets = targets.filter((a) => !skip.has(a))
  }
  return targets
}

async function main(): Promise<void> {
  const tenants = loadTenants()
  if (Object.keys(tenants.tenants).length === 0) {
    console.log('ℹ️  Nessun tenant registrato in tenants.json. Lancia prima create-tenant.ts / full-provision.ts.')
    return
  }
  const targets = selectTargets()
  if (targets.length === 0) {
    console.log('ℹ️  Filtro --only/--skip non lascia tenant da processare.')
    return
  }
  const skipFunctions = flag('no-functions')

  console.log(`▶  Rollout sincrono su tenant: ${targets.join(', ')}`)
  if (skipFunctions) console.log('   (skip edge functions: --no-functions)')

  const summary: { alias: string; migrationsOk: boolean; functionsOk: boolean | null }[] = []
  for (const alias of targets) {
    console.log(`\n━━━ tenant ${alias} ━━━`)
    const m = runStep('apply-migrations.ts', [alias])
    let f: boolean | null = null
    if (!skipFunctions) {
      f = runStep('deploy-edge-functions.ts', [alias])
    }
    summary.push({ alias, migrationsOk: m, functionsOk: f })
    if (!m) {
      console.error(`   ⚠️  apply-migrations fallito su ${alias} — continuo comunque sugli altri tenant.`)
    }
  }

  console.log(`\n━━━ Report sync ━━━`)
  for (const s of summary) {
    const mig = s.migrationsOk ? 'OK' : 'FAIL'
    const fn = s.functionsOk === null ? 'skip' : s.functionsOk ? 'OK' : 'FAIL'
    console.log(`   ${s.alias.padEnd(20)} migrazioni=${mig.padEnd(4)} edge=${fn}`)
  }
  const anyFail = summary.some((s) => !s.migrationsOk || s.functionsOk === false)
  if (anyFail) {
    console.error('\n❌ Almeno un tenant è fallito. Correggi e rilancia.')
    process.exit(1)
  }
  console.log('\n✅ Rollout completato senza errori.')
}

main().catch((err) => {
  console.error('❌ sync-migrations-all fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
