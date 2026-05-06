import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR: string = resolve(
  here,
  '..',
  '..',
  '..',
  'supabase',
  'migrations'
)

export interface MigrationFile {
  filename: string
  fullPath: string
  sql: string
  checksum: string
}

export function listMigrationFiles(): MigrationFile[] {
  const filenames = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  return filenames.map((filename) => {
    const fullPath = resolve(MIGRATIONS_DIR, filename)
    const sql = readFileSync(fullPath, 'utf-8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    return { filename, fullPath, sql, checksum }
  })
}
