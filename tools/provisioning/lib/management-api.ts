/**
 * Thin wrapper around Supabase Management API v1.
 * Docs: https://supabase.com/docs/reference/api/v1
 */

const BASE_URL = 'https://api.supabase.com/v1'

export interface CreateProjectInput {
  name: string
  organization_id: string
  plan: string
  region: string
  db_pass: string
}

export interface ProjectInfo {
  id: string
  ref?: string
  name: string
  organization_id?: string
  region?: string
  status?: string
}

export interface ApiKey {
  name: string
  api_key: string
}

export class ManagementApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message)
    this.name = 'ManagementApiError'
  }
}

async function request<T>(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new ManagementApiError(
      `${method} ${path} → ${res.status}`,
      res.status,
      text
    )
  }
  if (text.length === 0) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export function createProject(
  accessToken: string,
  input: CreateProjectInput
): Promise<ProjectInfo> {
  return request<ProjectInfo>(accessToken, 'POST', '/projects', input)
}

export function listProjects(accessToken: string): Promise<ProjectInfo[]> {
  return request<ProjectInfo[]>(accessToken, 'GET', '/projects')
}

export function getProject(
  accessToken: string,
  ref: string
): Promise<ProjectInfo> {
  return request<ProjectInfo>(accessToken, 'GET', `/projects/${ref}`)
}

export function getApiKeys(
  accessToken: string,
  ref: string
): Promise<ApiKey[]> {
  return request<ApiKey[]>(accessToken, 'GET', `/projects/${ref}/api-keys`)
}

export interface SecretEntry {
  name: string
  value: string
}

/**
 * Sets project-level secrets (used by Edge Functions). Idempotent: existing
 * keys are overwritten when sent again.
 */
export function setSecrets(
  accessToken: string,
  ref: string,
  secrets: SecretEntry[]
): Promise<void> {
  return request<void>(accessToken, 'POST', `/projects/${ref}/secrets`, secrets)
}

export function listSecrets(
  accessToken: string,
  ref: string
): Promise<{ name: string }[]> {
  return request<{ name: string }[]>(accessToken, 'GET', `/projects/${ref}/secrets`)
}

/** Polls until the project status reaches ACTIVE_HEALTHY or timeout (default 8 min). */
export async function waitForProjectReady(
  accessToken: string,
  ref: string,
  timeoutMs = 8 * 60 * 1000,
  intervalMs = 10_000
): Promise<ProjectInfo> {
  const start = Date.now()
  let last: ProjectInfo | null = null
  // eslint-disable-next-line no-constant-condition
  while (true) {
    last = await getProject(accessToken, ref)
    if ((last.status ?? '').toUpperCase().includes('HEALTHY')) return last
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timeout in attesa che il progetto ${ref} diventi healthy (ultimo status: ${last.status ?? 'sconosciuto'})`
      )
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
