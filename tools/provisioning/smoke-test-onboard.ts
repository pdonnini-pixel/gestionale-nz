/**
 * smoke-test-onboard.ts
 *
 * Smoke test E2E della RPC `onboard_tenant`. Per il tenant indicato:
 *  1. Verifica che il tenant sia vergine (zero companies)
 *  2. Login via supabase.auth.signInWithPassword (utente seed)
 *  3. Chiama supabase.rpc('onboard_tenant', ...) con JWT autenticato
 *  4. Verifica che TUTTE le tabelle siano popolate correttamente
 *  5. Verifica che user_profiles.company_id sia stato aggiornato
 *  6. Tentativo di re-onboarding (deve fallire — idempotency check)
 *
 * Uso:
 *   npx tsx smoke-test-onboard.ts <alias>
 *
 * NOTA: questo lascia il tenant in stato ONBOARDED. Per tornare a vergine:
 *   eseguire reset SQL (vedi mark-deltas-applied o uno script ad-hoc).
 */

import { createClient } from '@supabase/supabase-js'
import { requirePositional } from './lib/cli.js'
import { getTenant } from './lib/tenants-store.js'
import { readEnv } from './lib/env.js'

const SEED_EMAIL = 'pdonnini@gmail.com' // super_advisor seed

async function main(): Promise<void> {
  const alias = requirePositional(0, 'alias')
  const tenant = getTenant(alias)
  if (!tenant) throw new Error(`tenant "${alias}" non trovato`)

  const env = readEnv()
  const password = env.seedUsersPassword
  const url = `https://${tenant.projectRef}.supabase.co`

  // Client come "browser": anon key (rispetta RLS), persistSession ok
  const sb = createClient(url, tenant.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Login
  console.log(`▶  Login ${SEED_EMAIL} su ${alias} …`)
  const { data: loginData, error: loginErr } = await sb.auth.signInWithPassword({
    email: SEED_EMAIL,
    password,
  })
  if (loginErr) throw new Error(`Login fallito: ${loginErr.message}`)
  const userId = loginData.user?.id
  if (!userId) throw new Error('Login senza user.id')
  console.log(`   user.id = ${userId}`)
  console.log(`   role JWT = ${JSON.stringify(loginData.user?.app_metadata?.role)}`)

  // 2. Verifica tenant vergine
  const { data: companiesPre } = await sb.from('companies').select('id').limit(1)
  if (companiesPre && companiesPre.length > 0) {
    throw new Error(`Tenant non vergine, esistono ${companiesPre.length} companies. Reset prima.`)
  }
  console.log(`   ✓ tenant vergine`)

  // 3. Verifica user_profiles del caller (deve essere SELECT-abile via profiles_self_select)
  const { data: profilePre, error: profileErr } = await sb
    .from('user_profiles')
    .select('id, role, company_id')
    .eq('id', userId)
    .single()
  if (profileErr) throw new Error(`SELECT user_profiles fallito: ${profileErr.message}`)
  console.log(`   profile pre: role=${profilePre?.role} company_id=${profilePre?.company_id}`)
  if (profilePre?.company_id) {
    throw new Error(`User ${SEED_EMAIL} ha già company_id ${profilePre.company_id}. Reset prima.`)
  }

  // 4. Chiamata RPC onboard_tenant
  const tenantName = `Test ${alias.toUpperCase()} Srl`
  const tenantVat = '00000000001'
  console.log(`▶  Chiamo onboard_tenant per "${tenantName}" …`)
  const { data: companyId, error: rpcErr } = await sb.rpc('onboard_tenant', {
    p_company: {
      name: tenantName,
      vat_number: tenantVat,
      fiscal_code: null,
      legal_address: 'Via Test 1, 20100 Milano MI',
      pec: 'test@pec.it',
      sdi_code: 'XXXXXXX',
    },
    p_outlets: [
      { name: 'Outlet Test 1', code: 'TST1', address: 'Via Outlet 1', city: 'Milano', province: 'MI', cap: '20100' },
      { name: 'Outlet Test 2', code: 'TST2', city: 'Roma', province: 'RM', cap: '00100' },
    ],
    p_chart_template: 'nz',
    p_suppliers: [
      { name: 'Fornitore A', vat_number: '11111111111' },
      { name: 'Fornitore B' },
    ],
  })
  if (rpcErr) throw new Error(`RPC fallita: ${rpcErr.message}`)
  if (!companyId) throw new Error('RPC ha ritornato null')
  console.log(`   ✓ company creata: ${companyId}`)

  // 5. Verifica popolamento tabelle (con service role per bypassare RLS che ora
  //    filtra per company_id che il caller dovrebbe vedere)
  const admin = createClient(url, tenant.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const checks: Array<[string, number]> = [
    ['companies', 1],
    ['outlets', 2],
    ['cost_centers', 3], // sede + 2 outlet
    ['cost_categories', 26], // template NZ
    ['chart_of_accounts', 20], // template NZ
    ['suppliers', 2],
    ['company_settings', 1],
  ]
  for (const [tbl, expected] of checks) {
    const { count, error } = await (admin as unknown as {
      from: (t: string) => { select: (q: string, opts: { count: 'exact'; head?: boolean }) => Promise<{ count: number | null; error: { message: string } | null }> }
    })
      .from(tbl)
      .select('id', { count: 'exact', head: true })
    if (error) throw new Error(`SELECT count(${tbl}) fallita: ${error.message}`)
    const ok = count === expected
    console.log(`   ${ok ? '✓' : '✗'} ${tbl}: ${count} (atteso ${expected})`)
    if (!ok) throw new Error(`Mismatch ${tbl}: ${count} vs ${expected}`)
  }

  // 6. Verifica user_profiles aggiornato
  const { data: profilePost } = await admin
    .from('user_profiles')
    .select('id, company_id')
    .eq('id', userId)
    .single()
  if (profilePost?.company_id !== companyId) {
    throw new Error(`user_profiles.company_id non aggiornato: ${profilePost?.company_id}`)
  }
  console.log(`   ✓ user_profiles.company_id = ${profilePost.company_id}`)

  // 7. Idempotency: re-chiamata della RPC deve fallire
  console.log(`▶  Verifico che re-onboarding fallisca …`)
  const { error: rpcErr2 } = await sb.rpc('onboard_tenant', {
    p_company: { name: 'second' },
    p_outlets: [{ name: 'x', code: 'X1' }],
    p_chart_template: 'minimal',
    p_suppliers: [],
  })
  if (!rpcErr2) {
    throw new Error('Re-onboarding NON ha fallito (atteso: errore "tenant non vergine")')
  }
  console.log(`   ✓ re-onboarding bloccato: ${rpcErr2.message}`)

  console.log(`\n✅ Smoke test E2E onboard_tenant superato su "${alias}"`)
}

main().catch((err) => {
  console.error('❌ smoke test fallito:', err instanceof Error ? err.message : err)
  process.exit(1)
})
