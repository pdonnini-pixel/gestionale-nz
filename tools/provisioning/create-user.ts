/**
 * create-user.ts
 *
 * Crea (o aggiorna se esiste) un utente in un tenant target con app_metadata
 * contenente role e company_id. Usa il service_role_key salvato in tenants.json.
 *
 * Uso:
 *   npx tsx create-user.ts <alias> --email <email> --password <password> --role <role> [--companyId <uuid>]
 *
 * I parametri --password e --companyId sono opzionali:
 *   - se --password manca, usa SEED_USERS_PASSWORD dall'env
 *   - se --companyId manca, prende tenant.companyId da tenants.json
 *
 * Il parametro --role è ripetibile (es. --role super_advisor --role budget_approver).
 * Idempotente: se l'utente esiste già, aggiorna i suoi app_metadata e password.
 */

import { createClient } from '@supabase/supabase-js'
import { arg } from './lib/cli.js'
import { getTenant } from './lib/tenants-store.js'
import { readEnv } from './lib/env.js'

function getRoles(): string[] {
  const out: string[] = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--role' && i + 1 < process.argv.length) {
      out.push(process.argv[i + 1])
    }
  }
  return out
}

async function main(): Promise<void> {
  const alias = process.argv[2]
  if (!alias || alias.startsWith('--')) {
    throw new Error('Uso: create-user.ts <alias> --email <email> [--password ...] --role <r> [--companyId ...]')
  }
  const email = arg('email')
  if (!email) throw new Error('Argomento mancante: --email')
  const roles = getRoles()
  if (roles.length === 0) throw new Error('Almeno un --role è richiesto')

  const tenant = getTenant(alias)
  if (!tenant) throw new Error(`Tenant "${alias}" non trovato.`)

  const env = readEnv()
  const password = arg('password') ?? env.seedUsersPassword
  if (!password) throw new Error('Password mancante: passa --password o setta SEED_USERS_PASSWORD nel .env')
  const companyId = arg('companyId') ?? tenant.companyId
  // companyId può essere null se il wizard non ha ancora popolato companies.

  const projectUrl = `https://${tenant.projectRef}.supabase.co`
  const admin = createClient(projectUrl, tenant.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`▶  Cerco se utente ${email} esiste già su tenant "${alias}"…`)
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (listErr) throw new Error(`listUsers fallito: ${listErr.message}`)
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())

  const appMetadata: Record<string, unknown> = {
    role: roles.length === 1 ? roles[0] : roles,
  }
  if (companyId) appMetadata.company_id = companyId

  if (existing) {
    console.log(`   ↪ utente esiste (${existing.id}). Aggiorno role/company_id/password.`)
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      app_metadata: appMetadata,
    })
    if (updErr) throw new Error(`updateUserById fallito: ${updErr.message}`)
    console.log(`✅ Utente ${email} aggiornato.`)
  } else {
    console.log(`   ↪ creo utente ${email}…`)
    const { data, error: crErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMetadata,
    })
    if (crErr) throw new Error(`createUser fallito: ${crErr.message}`)
    console.log(`✅ Utente ${email} creato (id ${data.user?.id ?? '—'}).`)
  }
}

main().catch((err) => {
  console.error('❌ create-user fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
