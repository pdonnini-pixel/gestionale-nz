import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '..', '.env')
if (existsSync(envPath)) loadDotenv({ path: envPath })

export interface ProvisioningEnv {
  accessToken: string
  orgId: string
  region: string
  plan: string
  cli: string
  seedUsersPassword: string
}

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Variabile d'ambiente mancante: ${name}.\n` +
      `Crea tools/provisioning/.env partendo da .env.example.`
    )
  }
  return value
}

function optional(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim().length > 0 ? v : fallback
}

export function readEnv(): ProvisioningEnv {
  return {
    accessToken: required('SUPABASE_ACCESS_TOKEN'),
    orgId: required('SUPABASE_ORG_ID'),
    region: optional('SUPABASE_REGION', 'eu-west-1'),
    plan: optional('SUPABASE_PLAN', 'pro'),
    cli: optional('SUPABASE_CLI', 'npx supabase'),
    seedUsersPassword: required('SEED_USERS_PASSWORD'),
  }
}

export function readEnvAuthOnly(): Pick<ProvisioningEnv, 'accessToken'> {
  return { accessToken: required('SUPABASE_ACCESS_TOKEN') }
}
