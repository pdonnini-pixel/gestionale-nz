/**
 * Risoluzione del tenant attivo a runtime.
 *
 * Architettura multi-tenant fisica (ADR-001 in CLAUDE.md): ogni cliente ha
 * un proprio progetto Supabase. Il browser sceglie il progetto in base al
 * hostname; ogni site Netlify ha solo le env vars del proprio tenant.
 *
 * Per cambiare tenant, l'utente apre una tab diversa con un altro subdomain.
 * Niente switcher in-app: l'isolamento è fisico, non logico.
 */

export type TenantAlias = 'newzago' | 'made-retail' | 'zago'

export interface TenantConfig {
  alias: TenantAlias
  displayName: string
  supabaseUrl: string
  supabaseAnonKey: string
  /**
   * Hex color usato dal TenantBadge in Layout.tsx come banda di
   * identificazione. Diverso per ogni tenant per evitare confusione su
   * Sabrina/Veronica che alternano i 3 tenant nello stesso flusso.
   */
  accentColor: string
  /** Sfondo del badge — colore pieno per leggibilità. */
  accentBg: string
}

interface RawEnv {
  url: string | undefined
  anon: string | undefined
}

function readEnv(suffix: string): RawEnv {
  const env = import.meta.env as Record<string, string | undefined>
  return {
    url: env[`VITE_SUPABASE_URL_${suffix}`] ?? env.VITE_SUPABASE_URL,
    anon: env[`VITE_SUPABASE_ANON_KEY_${suffix}`] ?? env.VITE_SUPABASE_ANON_KEY,
  }
}

/**
 * Fallback NZ SOLO per il dev locale (`import.meta.env.DEV`).
 *
 * In produzione ogni site Netlify ha le proprie env vars
 * (VITE_SUPABASE_URL[_MADE/_ZAGO] + VITE_SUPABASE_ANON_KEY[_MADE/_ZAGO]),
 * quindi questo fallback NON serve. Essendo racchiuso in un ramo
 * `import.meta.env.DEV`, viene eliminato dal tree-shaking nei bundle di
 * produzione: l'anon key NZ non finisce più in NESSUN bundle (né NZ né
 * Made/Zago). `npm run dev` continua a funzionare senza file .env.
 */
function devNzFallback(): RawEnv | undefined {
  if (!import.meta.env.DEV) return undefined
  return {
    url: 'https://xfvfxsvqpnpvibgeqpqp.supabase.co',
    anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdmZ4c3ZxcG5wdmliZ2VxcHFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNDkwNDcsImV4cCI6MjA5MDcyNTA0N30.ohYziAXiOWS0TKU9HHuhUAbf5Geh10xbLGEoftOMJZA',
  }
}

function buildConfig(
  alias: TenantAlias,
  displayName: string,
  envSuffix: string,
  accentColor: string,
  accentBg: string,
  legacy?: RawEnv
): TenantConfig {
  const fromEnv = readEnv(envSuffix)
  const url = fromEnv.url ?? legacy?.url
  const anon = fromEnv.anon ?? legacy?.anon
  if (!url || !anon) {
    throw new Error(
      `Tenant "${alias}" non configurato: manca VITE_SUPABASE_URL_${envSuffix} ` +
        `o VITE_SUPABASE_ANON_KEY_${envSuffix}. ` +
        `Configurali sulle Netlify env vars del site di questo tenant.`
    )
  }
  return { alias, displayName, supabaseUrl: url, supabaseAnonKey: anon, accentColor, accentBg }
}

/** Mapping hostname → tenant. Usa endsWith per supportare deploy preview Netlify. */
function resolveTenantForHost(host: string): TenantConfig {
  const h = host.toLowerCase()

  if (
    h === 'made-gestionale-nz.netlify.app' ||
    h.endsWith('--made-gestionale-nz.netlify.app')
  ) {
    // accentBg scuro (700): con testo bianco i toni 500 non superavano il
    // contrasto minimo WCAG sul badge tenant.
    return buildConfig('made-retail', 'Made Retail Srl', 'MADE', '#1d4ed8', '#1d4ed8')
  }
  if (
    h === 'zago-gestionale-nz.netlify.app' ||
    h.endsWith('--zago-gestionale-nz.netlify.app')
  ) {
    return buildConfig('zago', 'Zago Srl', 'ZAGO', '#c2410c', '#c2410c')
  }
  // NZ default: dominio principale, deploy preview, e tutto il dev locale.
  // In prod usa le env vars; il fallback esiste solo in dev (vedi devNzFallback).
  return buildConfig(
    'newzago',
    'New Zago Srl',
    'NEWZAGO',
    '#047857',
    '#047857',
    devNzFallback()
  )
}

let cached: TenantConfig | null = null

export function getCurrentTenant(): TenantConfig {
  if (cached) return cached
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  cached = resolveTenantForHost(host)
  return cached
}

/** Solo per test: permette di forzare un tenant senza rifare la pagina. */
export function _resetTenantCache(): void {
  cached = null
}
