/** Tiny argv helpers — keeps scripts dependency-free. */

export function arg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`)
  if (idx === -1 || idx === process.argv.length - 1) return undefined
  return process.argv[idx + 1]
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

export function positional(index: number): string | undefined {
  // skip "node" + script path
  return process.argv[2 + index]
}

export function requireArg(name: string): string {
  const v = arg(name)
  if (!v) throw new Error(`Argomento mancante: --${name}`)
  return v
}

export function requirePositional(index: number, label: string): string {
  const v = positional(index)
  if (!v) throw new Error(`Argomento posizionale mancante: ${label}`)
  return v
}

export function generateStrongPassword(): string {
  const buf = new Uint8Array(24)
  crypto.getRandomValues(buf)
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
