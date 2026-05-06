/**
 * create-tenant.ts
 *
 * Crea un nuovo progetto Supabase via Management API e ne salva i metadati
 * in tenants.json. Idempotente: se un tenant con lo stesso alias è già
 * registrato in tenants.json e il progetto esiste lato Supabase, lo skippa.
 *
 * Uso:
 *   npx tsx create-tenant.ts <alias> "<displayName>"
 *
 * Esempio:
 *   npx tsx create-tenant.ts made-retail "Made Retail Srl"
 */

import { readEnv } from './lib/env.js'
import {
  createProject,
  getApiKeys,
  getProject,
  listProjects,
  waitForProjectReady,
} from './lib/management-api.js'
import { generateStrongPassword, requirePositional } from './lib/cli.js'
import {
  getTenant,
  upsertTenant,
  type TenantRecord,
} from './lib/tenants-store.js'

/**
 * Costruisce l'URL di connessione DB usando il session pooler Supavisor
 * (porta 5432). I progetti Supabase creati di recente hanno il direct
 * connection `db.<ref>.supabase.co` disabilitato di default — usare il
 * pooler è quindi la scelta giusta sia per dev che per provisioning.
 *
 * Nota: il transaction pooler (6543) NON va per le migrazioni DDL —
 * servirebbe session mode (5432) per DDL multi-statement, transazioni e
 * advisory locks. Usiamo quindi sempre la 5432.
 */
function buildDatabaseUrl(ref: string, region: string, password: string): string {
  const user = `postgres.${ref}`
  const host = `aws-0-${region}.pooler.supabase.com`
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:5432/postgres`
}

async function main(): Promise<void> {
  const alias = requirePositional(0, 'alias (es. made-retail)')
  const displayName = requirePositional(1, 'displayName (es. "Made Retail Srl")')
  const env = readEnv()

  const existing = getTenant(alias)
  if (existing) {
    try {
      const proj = await getProject(env.accessToken, existing.projectRef)
      console.log(
        `ℹ️  Tenant "${alias}" già registrato (project ${existing.projectRef}, status ${proj.status ?? 'unknown'}). Skip create.`
      )
      return
    } catch {
      console.warn(
        `⚠️  Tenant "${alias}" è in tenants.json ma il progetto non risponde. Procedo con un nuovo create.`
      )
    }
  }

  console.log(`▶  Creo progetto "${displayName}" su org ${env.orgId} (region ${env.region}, plan ${env.plan})…`)

  // Verifica che non esista già un progetto con lo stesso nome (collisione cross-tenants.json)
  const all = await listProjects(env.accessToken)
  const projectName = `gestionale-${alias}`
  const collision = all.find(
    (p) => p.name === projectName && p.organization_id === env.orgId
  )
  let ref: string
  let dbPass: string
  if (collision) {
    console.log(
      `ℹ️  Esiste già un progetto "${projectName}" (ref ${collision.id}). Lo riuso.`
    )
    ref = collision.id
    dbPass = ''
  } else {
    dbPass = generateStrongPassword()
    const created = await createProject(env.accessToken, {
      name: projectName,
      organization_id: env.orgId,
      plan: env.plan,
      region: env.region,
      db_pass: dbPass,
    })
    ref = created.id
    console.log(`   project_ref = ${ref}`)
  }

  console.log(`▶  Attendo che il progetto diventi ACTIVE_HEALTHY…`)
  await waitForProjectReady(env.accessToken, ref)

  console.log(`▶  Recupero anon_key e service_role_key…`)
  const keys = await getApiKeys(env.accessToken, ref)
  const anonKey = keys.find((k) => k.name === 'anon')?.api_key
  const serviceRoleKey = keys.find((k) => k.name === 'service_role')?.api_key
  if (!anonKey || !serviceRoleKey) {
    throw new Error('Anon o service_role key non trovate nella risposta API.')
  }

  if (!dbPass) {
    console.warn(
      '⚠️  Progetto preesistente: db_pass non disponibile. La connection string in tenants.json sarà incompleta — modifica manualmente prima di lanciare apply-migrations.'
    )
  }

  const record: TenantRecord = {
    alias,
    displayName,
    projectRef: ref,
    region: env.region,
    createdAt: new Date().toISOString(),
    databaseUrl: dbPass ? buildDatabaseUrl(ref, env.region, dbPass) : '',
    anonKey,
    serviceRoleKey,
    companyId: null,
    netlifySiteHost: null,
    notes: dbPass ? null : 'db_pass mancante — riusato progetto preesistente',
  }
  upsertTenant(record)

  console.log(`✅ Tenant "${alias}" registrato in tenants.json.`)
  console.log(`   project_ref:      ${record.projectRef}`)
  console.log(`   anon_key:         (salvato)`)
  console.log(`   service_role_key: (salvato)`)
  if (record.databaseUrl) console.log(`   database_url:     (salvato, contiene segreti)`)
}

main().catch((err) => {
  console.error('❌ create-tenant fallito:', err instanceof Error ? err.message : err)
  if (err instanceof Error && 'body' in err) {
    console.error('   body:', (err as { body: unknown }).body)
  }
  process.exit(1)
})
