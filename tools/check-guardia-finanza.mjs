#!/usr/bin/env node
/**
 * check-guardia-finanza.mjs
 *
 * Presidio anti-regressione per la guardia delle funzioni di banca, fatture e
 * riconciliazione (migration 380, lista bianca dalla 381).
 *
 * PERCHE' ESISTE: la 380 ha messo in testa a 52 funzioni SECURITY DEFINER la riga
 *     PERFORM public.ruoli_operativi_non_qui(); -- migration 380
 * che dalla 381 lascia passare dall'API solo i ruoli amministrativi. La riga
 * vive solo nel corpo della funzione: un CREATE OR REPLACE FUNCTION scritto in
 * una migration successiva, copiato da una versione vecchia, la toglie senza
 * nessun errore e la funzione torna eseguibile da viewer, cassa, dipendente.
 * Stessa cosa per richiedi_profilo_gestionale(), che dalla 379 chiama
 * responsabile_non_qui().
 *
 * COSA CONTROLLA: in ogni migration nuova, ogni CREATE [OR REPLACE] FUNCTION
 * di una delle 52 funzioni deve contenere nel corpo la chiamata a
 * public.ruoli_operativi_non_qui(); quella di richiedi_profilo_gestionale la
 * chiamata a public.responsabile_non_qui(). L'elenco delle 52 si legge dalla
 * migration 380 (array v_nomi): una sola fonte, niente liste da tenere in pari.
 *
 * COSA NON CONTROLLA: le riscritture dinamiche (EXECUTE su pg_get_functiondef),
 * come la 380 stessa e il suo rollback, che sono fatte apposta.
 *
 * Migration controllate: quelle toccate dalla PR se BASE_SHA è disponibile
 * (stesso approccio di check-view-security-invoker.mjs), altrimenti quelle con
 * data dal 20261109 in poi.
 *
 * Esce con codice 1 (PR bloccata) elencando file e funzioni da sistemare.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const MIGRATIONS_DIR = 'supabase/migrations'
const MIGRATION_380 = '20261109_380_cassa_e_dipendente_niente_funzioni_finanza.sql'
const ATTESE_380 = 52
const CUTOFF = '20261109'

/** Le 52 funzioni, lette dall'array v_nomi della migration 380. */
function funzioni380() {
  const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION_380), 'utf8')
  const blocco = sql.match(/v_nomi\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\];/i)
  if (!blocco) throw new Error(`array v_nomi non trovato in ${MIGRATION_380}`)
  const senzaCommenti = blocco[1]
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
  const nomi = [...senzaCommenti.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
  if (nomi.length !== ATTESE_380) {
    throw new Error(`attese ${ATTESE_380} funzioni in ${MIGRATION_380}, trovate ${nomi.length}`)
  }
  return nomi
}

/** Funzione -> chiamata che il suo corpo deve contenere. */
function regole() {
  const r = new Map()
  for (const nome of funzioni380()) {
    r.set(nome, { guardia: 'ruoli_operativi_non_qui', origine: 'migration 380/381' })
  }
  r.set('richiedi_profilo_gestionale', { guardia: 'responsabile_non_qui', origine: 'migration 379' })
  return r
}

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
      console.warn(`⚠️  git diff non riuscito (${err.message}), uso il cutoff ${CUTOFF}`)
    }
  }

  return all.filter((f) => {
    const date = f.match(/(\d{8})_\d{3}_/)
    return date ? date[1] >= CUTOFF : true
  })
}

// Righe di commento SQL intere: non contengono codice eseguibile.
const stripCommentLines = (sql) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

const CREATE_FUNCTION =
  /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?([a-z0-9_]+)"?\s*\(/gi

/**
 * Corpo della funzione che inizia a `from`: il testo fra il primo
 * AS $tag$ (o AS '...') e il $tag$ che lo chiude.
 */
function corpoDa(sql, from) {
  const resto = sql.slice(from)
  const dollaro = resto.match(/\bas\s+(\$[a-z0-9_]*\$)/i)
  if (!dollaro) return null
  const inizio = dollaro.index + dollaro[0].length
  const fine = resto.indexOf(dollaro[1], inizio)
  if (fine < 0) return null
  return resto.slice(inizio, fine)
}

const elenco = regole()
const checked = filesToCheck()
const problems = []

for (const file of checked) {
  const sql = stripCommentLines(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  for (const m of sql.matchAll(CREATE_FUNCTION)) {
    const nome = m[1].toLowerCase()
    const regola = elenco.get(nome)
    if (!regola) continue
    const corpo = corpoDa(sql, m.index)
    const chiamata = new RegExp(`\\bperform\\s+(?:public\\.)?${regola.guardia}\\s*\\(\\s*\\)`, 'i')
    if (corpo === null || !chiamata.test(corpo)) {
      problems.push({ file, nome, ...regola })
    }
  }
}

if (problems.length > 0) {
  console.error('\n❌ Funzioni di banca, fatture e riconciliazione riscritte senza guardia:\n')
  for (const { file, nome, guardia, origine } of problems) {
    console.error(`   ${file}  →  public.${nome}  (manca PERFORM public.${guardia}(), ${origine})`)
  }
  console.error(`
Queste funzioni sono SECURITY DEFINER e girano come proprietario: la RLS non le
ferma. Senza la guardia tornano eseguibili da viewer, operatore_cassa,
dipendente e responsabile. Tieni la riga subito dopo il BEGIN del corpo:

    BEGIN
      PERFORM public.ruoli_operativi_non_qui(); -- migration 380
      ...

(per richiedi_profilo_gestionale: PERFORM public.responsabile_non_qui();)
`)
  process.exit(1)
}

console.log(
  `✅ Guardia presente in tutte le funzioni protette riscritte nelle migration controllate (${checked.length} file, ${elenco.size} funzioni sorvegliate)`
)
