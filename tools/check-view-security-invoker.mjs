#!/usr/bin/env node
/**
 * check-view-security-invoker.mjs
 *
 * Presidio anti-regressione per l'advisor Supabase 0010_security_definer_view.
 *
 * PERCHE' ESISTE: in PostgreSQL  CREATE OR REPLACE VIEW  rigenera i reloptions
 * ai valori di default, quindi cancella un  security_invoker = on  impostato in
 * precedenza. Sul progetto e' successo tre volte (069 -> rotta dalla 106 ->
 * ripristinata dalla 113 -> rotta dalle 143/144 -> ripristinata dalla 153):
 * ogni volta le viste public.v_* sono tornate a girare come SECURITY DEFINER,
 * ignorando la RLS delle tabelle sottostanti ed esponendo dati di aziende
 * diverse (v_payables_operative contiene IBAN, P.IVA e importi).
 *
 * COSA CONTROLLA: ogni  CREATE [OR REPLACE] VIEW public.v_xxx  dentro
 * supabase/migrations/ deve dichiarare  WITH (security_invoker = on)  nella
 * stessa istruzione, oppure essere seguito nello stesso file da un
 * ALTER VIEW ... SET (security_invoker = on)  sulla stessa vista.
 *
 * COSA NON CONTROLLA: le migration gia' applicate ai tenant. Sono immutabili
 * per definizione (riscriverle non cambia lo stato del DB) e il loro effetto e'
 * gia' stato sanato a runtime dallo sweep della migration 153. Il check guarda
 * quindi solo le migration NUOVE: quelle toccate dalla PR se BASE_SHA e'
 * disponibile (stesso approccio di check-guide-alignment.mjs), altrimenti
 * quelle con prefisso data successivo alla 153.
 *
 * Esce con codice 1 (PR bloccata) elencando i file e le viste da sistemare.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const MIGRATIONS_DIR = 'supabase/migrations'

// Tutte le migration fino a questa data sono legacy: applicate ai tenant e
// gia' sanate dallo sweep della 153 (2026-09-02).
const LEGACY_CUTOFF = '20260902'

// Righe di commento SQL: non contengono DDL eseguibile.
const stripComments = (sql) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

const CREATE_VIEW = /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?("?v_[a-z0-9_]+"?)([\s\S]*?)(?:\bas\b)/gi
const ALTER_INVOKER = /alter\s+view\s+(?:public\.)?("?v_[a-z0-9_]+"?)\s+set\s*\(\s*security_invoker\s*=\s*on\s*\)/gi
const SWEEP = /alter\s+view\s+public\.%i\s+set\s*\(\s*security_invoker\s*=\s*on\s*\)/i

const unquote = (name) => name.replace(/"/g, '').toLowerCase()

/** Migration da controllare: quelle toccate dalla PR, o le post-153 in locale. */
function filesToCheck() {
  const all = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const baseSha = process.env.BASE_SHA

  if (baseSha) {
    try {
      const diff = execSync(`git diff --name-only --diff-filter=ACMR ${baseSha}...HEAD`, {
        encoding: 'utf8',
      })
      const changed = new Set(
        diff
          .split('\n')
          .filter((f) => f.startsWith(`${MIGRATIONS_DIR}/`) && f.endsWith('.sql'))
          .map((f) => f.slice(MIGRATIONS_DIR.length + 1))
      )
      return all.filter((f) => changed.has(f))
    } catch (err) {
      console.warn(`⚠️  git diff non riuscito (${err.message}), uso il cutoff ${LEGACY_CUTOFF}`)
    }
  }

  return all.filter((f) => {
    const date = f.match(/(\d{8})_\d{3}_/)
    return date ? date[1] >= LEGACY_CUTOFF : true
  })
}

const checked = filesToCheck()
const problems = []

for (const file of checked) {
  const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))

  // Uno sweep dinamico (format('ALTER VIEW public.%I SET ...')) copre tutte le
  // viste del file: niente da segnalare.
  if (SWEEP.test(sql)) continue

  const fixed = new Set([...sql.matchAll(ALTER_INVOKER)].map((m) => unquote(m[1])))

  for (const match of sql.matchAll(CREATE_VIEW)) {
    const view = unquote(match[1])
    const between = match[2] || ''
    const declaresInvoker = /with\s*\(\s*security_invoker\s*=\s*on\s*\)/i.test(between)
    if (!declaresInvoker && !fixed.has(view)) {
      problems.push({ file, view })
    }
  }
}

if (problems.length > 0) {
  console.error('\n❌ Viste public.v_* create senza security_invoker:\n')
  for (const { file, view } of problems) {
    console.error(`   ${file}  →  public.${view}`)
  }
  console.error(`
Senza  security_invoker = on  la vista gira con i permessi del creatore e
IGNORA la RLS delle tabelle sottostanti: un utente vedrebbe i dati di tutte
le aziende. Aggiungi l'opzione nella stessa istruzione:

    CREATE OR REPLACE VIEW public.v_esempio
    WITH (security_invoker = on) AS
    SELECT ...;

oppure, nello stesso file di migration, subito dopo:

    ALTER VIEW public.v_esempio SET (security_invoker = on);
`)
  process.exit(1)
}

console.log(
  `✅ security_invoker dichiarato su tutte le viste public.v_* create nelle migration controllate (${checked.length})`
)
