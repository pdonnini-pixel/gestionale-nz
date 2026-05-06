import pg from 'pg'

const { Client } = pg

export interface DbConnectInput {
  databaseUrl: string
}

export async function withClient<T>(
  input: DbConnectInput,
  fn: (client: pg.Client) => Promise<T>
): Promise<T> {
  const client = new Client({
    connectionString: input.databaseUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function ensureMigrationsLogTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._migrations_log (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum text NOT NULL
    );
  `)
}

export async function listAppliedMigrations(client: pg.Client): Promise<Set<string>> {
  await ensureMigrationsLogTable(client)
  const res = await client.query<{ filename: string }>(
    'SELECT filename FROM public._migrations_log ORDER BY filename'
  )
  return new Set(res.rows.map((r) => r.filename))
}

export async function recordMigration(
  client: pg.Client,
  filename: string,
  checksum: string
): Promise<void> {
  await client.query(
    'INSERT INTO public._migrations_log (filename, checksum) VALUES ($1, $2)',
    [filename, checksum]
  )
}
