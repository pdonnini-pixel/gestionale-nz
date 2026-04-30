# MIGRATION_NOTES.md — Migrazione JS → TypeScript

## Info generali
- **Data inizio**: 2026-04-30
- **Data fine**: (in corso)
- **Branch**: `feature-typescript-migration`
- **File totali da convertire**: 74 (.jsx + .js)
- **File convertiti**: 0

## Dipendenze aggiunte
- `typescript` (devDependency)
- `@types/react` (devDependency)
- `@types/react-dom` (devDependency)
- `@types/node` (devDependency)

## Librerie con type shims (`src/types/shims.d.ts`)
- `xlsx` — nessun @types disponibile, shim manuale

## Fase 0 — Setup tooling
- ✅ `tsconfig.json` creato con `strict: true`, `allowJs: true`
- ✅ Tipi DB Supabase generati (`src/types/database.ts`, 2161 righe)
- ✅ `npm run build` passa
- ✅ Script `typecheck` aggiunto a package.json

## Bug pre-esistenti trovati
(nessuno finora)

## File con `@ts-expect-error` o `any` residui
(nessuno finora)

## Pagine con regressioni non risolte (lasciate in JS)
(nessuna finora)

## Stranezze trovate da investigare
(nessuna finora)
