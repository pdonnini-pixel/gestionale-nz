import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const TENANTS_FILE: string = resolve(here, '..', 'tenants.json')

export interface TenantRecord {
  alias: string
  displayName: string
  projectRef: string
  region: string
  createdAt: string
  databaseUrl: string
  anonKey: string
  serviceRoleKey: string
  companyId: string | null
  netlifySiteHost: string | null
  notes: string | null
}

export interface TenantsFile {
  version: number
  tenants: Record<string, TenantRecord>
}

const EMPTY: TenantsFile = { version: 1, tenants: {} }

export function loadTenants(): TenantsFile {
  if (!existsSync(TENANTS_FILE)) return { ...EMPTY, tenants: { ...EMPTY.tenants } }
  const raw = readFileSync(TENANTS_FILE, 'utf-8')
  try {
    const parsed = JSON.parse(raw) as TenantsFile
    if (typeof parsed.version !== 'number' || typeof parsed.tenants !== 'object') {
      throw new Error('Schema tenants.json non valido')
    }
    return parsed
  } catch (e) {
    throw new Error(`tenants.json non leggibile: ${(e as Error).message}`)
  }
}

export function saveTenants(file: TenantsFile): void {
  writeFileSync(TENANTS_FILE, JSON.stringify(file, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
}

export function upsertTenant(record: TenantRecord): void {
  const file = loadTenants()
  file.tenants[record.alias] = record
  saveTenants(file)
}

export function getTenant(alias: string): TenantRecord | null {
  const file = loadTenants()
  return file.tenants[alias] ?? null
}

export function listAliases(): string[] {
  return Object.keys(loadTenants().tenants).sort()
}
