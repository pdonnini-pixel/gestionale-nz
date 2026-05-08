/**
 * create-user.ts
 *
 * Crea (o aggiorna se esiste) un utente in un tenant target con app_metadata
 * contenente role e company_id, e ne crea anche la riga corrispondente in
 * `public.user_profiles`. Usa il service_role_key salvato in tenants.json.
 *
 * Uso:
 *   npx tsx create-user.ts <alias> --email <email> [--password ...] --role <role> \
 *       [--companyId <uuid>] [--firstName ...] [--lastName ...]
 *
 * Argomenti opzionali:
 *   --password   se assente, usa SEED_USERS_PASSWORD dall'env
 *   --companyId  se assente, usa tenant.companyId da tenants.json (può essere null)
 *   --firstName  populated in user_profiles.first_name
 *   --lastName   populated in user_profiles.last_name
 *
 * Il parametro --role è ripetibile (es. --role super_advisor --role budget_approver).
 * In auth.app_metadata vanno tutti i ruoli (per le RPC che usano has_jwt_role).
 * In user_profiles.role va il primo (la colonna è scalare, enum user_role).
 *
 * Idempotente:
 *  - se l'utente auth.users esiste, aggiorna password + app_metadata
 *  - user_profiles è UPSERT-ato (ON CONFLICT (id) DO UPDATE)
 */

import { createClient } from '@supabase/supabase-js'
import { arg } from './lib/cli.js'
import { getTenant } from './lib/tenants-store.js'
import { readEnv } from './lib/env.js'
import { withClient } from './lib/db.js'

function getRoles(): string[] {
  const out: string[] = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--role' && i + 1 < process.argv.length) {
      out.push(process.argv[i + 1])
    }
  }
  return out
}

async function upsertUserProfile(
  databaseUrl: string,
  userId: string,
  email: string,
  primaryRole: string,
  companyId: string | null,
  firstName: string | null,
  lastName: string | null,
): Promise<void> {
  await withClient({ databaseUrl }, async (client) => {
    // Lasciamo Postgres validare il role contro l'enum public.user_role.
    // Se il role non esiste (es. budget_approver pre-migrazione 010), errore
    // esplicito che fa fallire create-user e non crea uno user fantasma.
    await client.query(
      `INSERT INTO public.user_profiles (id, role, company_id, first_name, last_name, email, is_active)
       VALUES ($1, $2::public.user_role, $3, $4, $5, $6, true)
       ON CONFLICT (id) DO UPDATE SET
         role       = EXCLUDED.role,
         company_id = COALESCE(EXCLUDED.company_id, public.user_profiles.company_id),
         first_name = COALESCE(EXCLUDED.first_name, public.user_profiles.first_name),
         last_name  = COALESCE(EXCLUDED.last_name, public.user_profiles.last_name),
         email      = EXCLUDED.email,
         updated_at = now()`,
      [userId, primaryRole, companyId, firstName, lastName, email],
    )
  })
}

async function main(): Promise<void> {
  const alias = process.argv[2]
  if (!alias || alias.startsWith('--')) {
    throw new Error('Uso: create-user.ts <alias> --email <email> [--password ...] --role <r> [--companyId ...] [--firstName ...] [--lastName ...]')
  }
  const email = arg('email')
  if (!email) throw new Error('Argomento mancante: --email')
  const roles = getRoles()
  if (roles.length === 0) throw new Error('Almeno un --role è richiesto')
  const primaryRole = roles[0] // user_profiles.role è scalare

  const tenant = getTenant(alias)
  if (!tenant) throw new Error(`Tenant "${alias}" non trovato.`)
  if (!tenant.databaseUrl) throw new Error(`databaseUrl mancante per tenant "${alias}". Completalo in tenants.json.`)

  const env = readEnv()
  const password = arg('password') ?? env.seedUsersPassword
  if (!password) throw new Error('Password mancante: passa --password o setta SEED_USERS_PASSWORD nel .env')
  const companyId = arg('companyId') ?? tenant.companyId

  const firstName = arg('firstName') ?? null
  const lastName = arg('lastName') ?? null

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

  let userId: string
  if (existing) {
    console.log(`   ↪ utente esiste (${existing.id}). Aggiorno role/company_id/password.`)
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      app_metadata: appMetadata,
    })
    if (updErr) throw new Error(`updateUserById fallito: ${updErr.message}`)
    userId = existing.id
  } else {
    console.log(`   ↪ creo utente ${email}…`)
    const { data, error: crErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMetadata,
    })
    if (crErr) throw new Error(`createUser fallito: ${crErr.message}`)
    if (!data.user?.id) throw new Error('createUser non ha restituito user.id')
    userId = data.user.id
  }

  console.log(`   ↪ upsert user_profiles per ${email}…`)
  await upsertUserProfile(
    tenant.databaseUrl,
    userId,
    email,
    primaryRole,
    companyId,
    firstName,
    lastName,
  )
  console.log(`✅ Utente ${email} pronto (auth + profilo) su "${alias}".`)
}

main().catch((err) => {
  console.error('❌ create-user fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
