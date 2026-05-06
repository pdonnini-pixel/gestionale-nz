import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const FUNCTIONS_DIR: string = resolve(
  here,
  '..',
  '..',
  '..',
  'supabase',
  'functions'
)

export function listEdgeFunctions(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((entry) => {
      const full = resolve(FUNCTIONS_DIR, entry)
      try {
        return statSync(full).isDirectory() && !entry.startsWith('_')
      } catch {
        return false
      }
    })
    .sort()
}

export interface DeployFunctionResult {
  fn: string
  ok: boolean
  stdout: string
  stderr: string
}

/**
 * Deploys a single Edge Function to a target project using the supabase CLI.
 * The CLI must already be authenticated against the same access token (set via
 * SUPABASE_ACCESS_TOKEN env var, which it picks up automatically).
 */
export function deployFunction(
  cli: string,
  projectRef: string,
  fn: string
): DeployFunctionResult {
  const parts = cli.trim().split(/\s+/)
  const cmd = parts[0]
  const baseArgs = parts.slice(1)
  const args = [
    ...baseArgs,
    'functions',
    'deploy',
    fn,
    '--project-ref',
    projectRef,
    '--no-verify-jwt',
  ]
  const r = spawnSync(cmd, args, {
    cwd: resolve(FUNCTIONS_DIR, '..', '..'),
    encoding: 'utf-8',
    env: process.env,
  })
  return {
    fn,
    ok: r.status === 0,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}
