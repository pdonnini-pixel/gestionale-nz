/**
 * setup-vault.ts
 *
 * Inizializza i secret di un tenant a partire da secrets-template.json.
 * I valori sono SEMPRE placeholder (template). I secret reali vanno
 * inseriti da Patrizio/Lilian via Supabase dashboard una volta accreditati
 * Yapily/SDI per il tenant specifico.
 *
 * Idempotente: se un secret esiste già con valore non vuoto, NON viene
 * sovrascritto (evita di azzerare credenziali reali per errore).
 *
 * Uso:
 *   npx tsx setup-vault.ts <alias>
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { requirePositional } from './lib/cli.js'
import { getTenant } from './lib/tenants-store.js'
import { readEnv } from './lib/env.js'
import { listSecrets, setSecrets, type SecretEntry } from './lib/management-api.js'

interface SecretsTemplate {
  secrets: Record<string, string>
}

const here = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_PATH = resolve(here, 'secrets-template.json')

async function main(): Promise<void> {
  const alias = requirePositional(0, 'alias (es. made-retail)')
  const tenant = getTenant(alias)
  if (!tenant) {
    throw new Error(`Tenant "${alias}" non trovato in tenants.json.`)
  }
  const env = readEnv()

  const template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf-8')) as SecretsTemplate
  const templateSecrets = template.secrets ?? {}
  const templateNames = Object.keys(templateSecrets)
  if (templateNames.length === 0) {
    console.log('ℹ️  Template vuoto, nessun secret da configurare.')
    return
  }

  console.log(`▶  Recupero secret correnti del tenant "${alias}"…`)
  const existing = await listSecrets(env.accessToken, tenant.projectRef)
  const existingSet = new Set(existing.map((e) => e.name))

  const toCreate: SecretEntry[] = []
  for (const [name, value] of Object.entries(templateSecrets)) {
    if (existingSet.has(name)) {
      console.log(`   = ${name}: già presente, skip (per non sovrascrivere)`)
      continue
    }
    toCreate.push({ name, value })
  }

  if (toCreate.length === 0) {
    console.log(`✅ Nessun secret da creare per "${alias}".`)
    return
  }
  console.log(`▶  Creo ${toCreate.length} placeholder secret: ${toCreate.map((s) => s.name).join(', ')}`)
  await setSecrets(env.accessToken, tenant.projectRef, toCreate)
  console.log(`✅ Vault placeholder pronto per "${alias}". Valori reali da inserire via dashboard.`)
}

main().catch((err) => {
  console.error('❌ setup-vault fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
