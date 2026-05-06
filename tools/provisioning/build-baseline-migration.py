#!/usr/bin/env python3
"""
Build a baseline migration that initializes a fresh Supabase tenant with
the same schema as the existing New Zago project.

The original schema lives in `supabase/00*.sql` at the repo root (top-of-tree
NZ initialization). On a brand-new tenant project, those files would run
once at provisioning time. We rewrite them into a single idempotent migration
so:

  - on a NEW tenant (Made/Zago): the baseline creates schema from scratch
  - on the EXISTING NZ tenant: the baseline is a no-op (everything in IF
    NOT EXISTS / CREATE OR REPLACE)

This script does NOT mutate the source files; it only emits a new file
at frontend/supabase/migrations/20260417_000_baseline_schema.sql.

Idempotency rules applied:
  CREATE TABLE x        → CREATE TABLE IF NOT EXISTS x
  CREATE [UNIQUE] INDEX → … IF NOT EXISTS …
  CREATE FUNCTION       → CREATE OR REPLACE FUNCTION
  CREATE VIEW           → CREATE OR REPLACE VIEW
  CREATE TYPE           → wrapped in DO $$ EXCEPTION WHEN duplicate_object …
  CREATE TRIGGER ON x   → preceded by DROP TRIGGER IF EXISTS … ON x
  CREATE POLICY "x" ON  → preceded by DROP POLICY IF EXISTS "x" ON …
  ALTER TABLE … ADD COL → … ADD COLUMN IF NOT EXISTS …

Excluded from baseline (NZ-specific data, NOT schema):
  004_seed_data.sql                         entire file
  005_seed_scadenzario.sql                  entire file
  006_cleanup_test_data.sql                 entire file (one-off cleanup)
  011_seed_employees.sql                    entire file
  016_insert_rettifica_variazione_rimanenze entire file (NZ bilancio)
  007 — INSERT INTO outlets (…) Torino      single block excluded inline
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_DIR = REPO_ROOT / "supabase"
TARGET = (
    REPO_ROOT / "frontend" / "supabase" / "migrations"
    / "20260417_000_baseline_schema.sql"
)

# Order matters: types/tables first, then views, then RLS, then later additive fixes.
INCLUDE = [
    "001_complete_schema.sql",
    "002_views.sql",
    "003_rls_policies.sql",
    "007_add_outlet_fields_torino.sql",
    "008_outlet_attachments.sql",
    "009_catch_all_missing.sql",
    "010_fix_missing_columns.sql",
    "012_fix_delete_policies.sql",
    "013_add_yapily_columns_to_bank_transactions.sql",
    "014_create_supplier_allocation_tables.sql",
    "015_add_sdi_id_unique_index.sql",
    "017_create_sdi_sync_log.sql",
]

EXCLUDED_DATA_FILES = {
    "004_seed_data.sql",
    "005_seed_scadenzario.sql",
    "006_cleanup_test_data.sql",
    "011_seed_employees.sql",
    "016_insert_rettifica_variazione_rimanenze.sql",
}

# Regex helpers (case-insensitive). They run on per-statement strings so
# they don't accidentally match inside string literals — but the source
# SQL we accept is conventional CREATE syntax so this is safe enough.

RE_CREATE_TABLE = re.compile(
    r"\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)",
    re.IGNORECASE,
)
RE_CREATE_INDEX = re.compile(
    r"\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)",
    re.IGNORECASE,
)
RE_CREATE_FUNCTION = re.compile(
    r"\bCREATE\s+FUNCTION\b(?!\s+OR\s+REPLACE)",
    re.IGNORECASE,
)
RE_CREATE_VIEW = re.compile(
    r"\bCREATE\s+VIEW\b(?!\s+OR\s+REPLACE)",
    re.IGNORECASE,
)
RE_ALTER_ADD_COLUMN = re.compile(
    r"\bALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)",
    re.IGNORECASE,
)
RE_CREATE_TYPE = re.compile(
    r"\bCREATE\s+TYPE\s+(\w+)\s+AS\b",
    re.IGNORECASE,
)
RE_CREATE_TRIGGER = re.compile(
    r"\bCREATE\s+TRIGGER\s+(\w+)\b(?:[^;]*?\bON\s+(\S+))",
    re.IGNORECASE,
)
RE_CREATE_POLICY = re.compile(
    r'\bCREATE\s+POLICY\s+(?:"([^"]+)"|(\w+))\s+ON\s+([^\s]+)',
    re.IGNORECASE,
)


def split_statements(sql: str) -> list[str]:
    """Split a SQL blob into top-level statements ending in `;`.

    PL/pgSQL blocks `$$ … $$` may contain semicolons that we must not split on.
    We use a tiny state machine that toggles "inside dollar-quoted block".
    """
    out: list[str] = []
    buf: list[str] = []
    in_dollar = False
    in_line_comment = False
    i = 0
    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""
        if in_line_comment:
            buf.append(ch)
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue
        if not in_dollar and ch == "-" and nxt == "-":
            in_line_comment = True
            buf.append(ch)
            i += 1
            continue
        if ch == "$" and nxt == "$":
            in_dollar = not in_dollar
            buf.append("$$")
            i += 2
            continue
        if ch == ";" and not in_dollar:
            stmt = "".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def make_idempotent(stmt: str) -> str:
    """Apply the rewrites described in the module docstring."""
    s = stmt

    # 1. CREATE TABLE → CREATE TABLE IF NOT EXISTS
    s = RE_CREATE_TABLE.sub("CREATE TABLE IF NOT EXISTS ", s)

    # 2. CREATE INDEX → CREATE INDEX IF NOT EXISTS
    def _idx(m: re.Match[str]) -> str:
        unique = m.group(1) or ""
        return f"CREATE {unique}INDEX IF NOT EXISTS "
    s = RE_CREATE_INDEX.sub(_idx, s)

    # 3. CREATE FUNCTION → CREATE OR REPLACE FUNCTION
    s = RE_CREATE_FUNCTION.sub("CREATE OR REPLACE FUNCTION", s)

    # 4. CREATE VIEW → CREATE OR REPLACE VIEW
    s = RE_CREATE_VIEW.sub("CREATE OR REPLACE VIEW", s)

    # 5. ALTER TABLE … ADD COLUMN → ADD COLUMN IF NOT EXISTS
    def _alt(m: re.Match[str]) -> str:
        table = m.group(1)
        return f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "
    s = RE_ALTER_ADD_COLUMN.sub(_alt, s)

    # 6. CREATE TRIGGER → preceded by DROP TRIGGER IF EXISTS
    m = RE_CREATE_TRIGGER.search(s)
    if m:
        trig = m.group(1)
        tbl = m.group(2)
        s = f"DROP TRIGGER IF EXISTS {trig} ON {tbl};\n{s}"

    # 7. CREATE POLICY → preceded by DROP POLICY IF EXISTS
    m = RE_CREATE_POLICY.search(s)
    if m:
        # group 1 = quoted name, group 2 = unquoted name, group 3 = table
        pol_quoted = m.group(1)
        pol_unquoted = m.group(2)
        tbl = m.group(3)
        if pol_quoted is not None:
            s = f'DROP POLICY IF EXISTS "{pol_quoted}" ON {tbl};\n{s}'
        else:
            s = f"DROP POLICY IF EXISTS {pol_unquoted} ON {tbl};\n{s}"

    # 8. CREATE TYPE name AS … → wrap in DO block (tolerate duplicate_object)
    m = RE_CREATE_TYPE.search(s)
    if m:
        body = s.strip()
        if not body.endswith(";"):
            body += ";"
        # Escape single quotes inside body for embedding in DO $do$ … $do$
        # We use a custom dollar tag $do$ so existing $$ blocks don't conflict.
        s = (
            "DO $do$ BEGIN\n"
            f"  {body}\n"
            "EXCEPTION WHEN duplicate_object THEN NULL;\n"
            "END $do$"
        )

    return s


def process_file(name: str) -> str:
    src = (SOURCE_DIR / name).read_text(encoding="utf-8")

    # Special case: skip the Torino INSERT in 007.
    if name == "007_add_outlet_fields_torino.sql":
        # Drop everything from "INSERT INTO outlets" forward (the rest of the
        # file is just that one statement + comments).
        cut = src.lower().find("insert into outlets")
        if cut > 0:
            src = src[:cut].rstrip() + "\n"

    parts = [f"-- ─── source: {name} " + "─" * (60 - len(name)) + "\n"]
    for stmt in split_statements(src):
        parts.append(make_idempotent(stmt) + ";\n")
    return "\n".join(parts)


def main() -> int:
    chunks: list[str] = [
        "-- ============================================================================\n"
        "-- 20260417_000_baseline_schema.sql\n"
        "--\n"
        "-- Schema baseline per i tenant del Gestionale NZ.\n"
        "-- Generato automaticamente da tools/provisioning/build-baseline-migration.py\n"
        "-- a partire dei file supabase/00*.sql nella radice del progetto.\n"
        "--\n"
        "-- Idempotente per design: tutti CREATE … IF NOT EXISTS / OR REPLACE.\n"
        "-- - su NZ esistente: no-op\n"
        "-- - su Made/Zago vergini: schema completo da zero\n"
        "--\n"
        "-- NON modificare a mano. Per ricompilare: cd frontend/tools/provisioning\n"
        "--   && python3 build-baseline-migration.py\n"
        "-- ============================================================================\n",
    ]
    for fname in INCLUDE:
        if not (SOURCE_DIR / fname).exists():
            print(f"⚠️  source missing: {fname}", file=sys.stderr)
            continue
        chunks.append("\n")
        chunks.append(process_file(fname))
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text("".join(chunks), encoding="utf-8")
    print(f"✅ wrote {TARGET.relative_to(REPO_ROOT)} ({TARGET.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
