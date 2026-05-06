#!/usr/bin/env python3
"""
Dump dello schema public di NZ via Management API (read-only su pg_catalog).

Genera frontend/tools/provisioning/_nz_schema_dump.sql con:
  - estensioni
  - enum types
  - tabelle (CREATE TABLE IF NOT EXISTS …) ricavate da pg_catalog
  - indici
  - viste (CREATE OR REPLACE VIEW)
  - funzioni (CREATE OR REPLACE FUNCTION via pg_get_functiondef)
  - trigger (DROP IF EXISTS + CREATE)
  - policy RLS (DROP IF EXISTS + CREATE)

Output usato come input per build-baseline-migration.py (sostituisce i file
SQL della radice come sorgente di verità).
"""

from __future__ import annotations
import json
import os
import sys
import urllib.request
from pathlib import Path

ACCESS_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
NZ_REF = os.environ.get("NZ_REF", "xfvfxsvqpnpvibgeqpqp")
OUT = Path(__file__).resolve().parent / "_nz_schema_dump.sql"

if not ACCESS_TOKEN:
    print("SUPABASE_ACCESS_TOKEN non settato", file=sys.stderr)
    sys.exit(1)

API = f"https://api.supabase.com/v1/projects/{NZ_REF}/database/query"


def query(sql: str) -> list[dict]:
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=body,
        headers={
            "Authorization": f"Bearer {ACCESS_TOKEN}",
            "Content-Type": "application/json",
            # Cloudflare blocks the default Python-urllib UA with 1010.
            "User-Agent": "gestionale-nz-provisioning/0.1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body[:500]}\n  query: {sql[:200]}") from e


# Tables we never want to clone to a new tenant (NZ-specific or transient):
SKIP_TABLES = {
    "_deploy_temp",
    "_yapily_diagnostic",
    "_migrations_log",  # creata dal nostro tooling
    "budget_entries_backup_20260504",  # backup specifico
    "schema_migrations",  # interna supabase migrations
}


def fetch_extensions() -> list[str]:
    rows = query("""
        SELECT extname
        FROM pg_extension
        WHERE extname NOT IN ('plpgsql', 'pgsodium', 'supabase_vault')
          AND extname NOT LIKE 'pg_%cron%'
        ORDER BY extname;
    """)
    return [f'CREATE EXTENSION IF NOT EXISTS "{r["extname"]}";' for r in rows]


def fetch_enum_types() -> list[str]:
    rows = query("""
        SELECT
          t.typname AS type_name,
          string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        GROUP BY t.typname
        ORDER BY t.typname;
    """)
    out = []
    for r in rows:
        out.append(
            "DO $do$ BEGIN\n"
            f"  CREATE TYPE {r['type_name']} AS ENUM ({r['labels']});\n"
            "EXCEPTION WHEN duplicate_object THEN NULL;\n"
            "END $do$;"
        )
    return out


def fetch_tables() -> list[tuple[str, str]]:
    """Returns list of (table_name, CREATE TABLE statement)."""
    # Use pg_catalog to reconstruct CREATE TABLE.
    sql = """
        WITH cols AS (
          SELECT
            c.relname AS tbl,
            a.attnum,
            a.attname,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
            a.attnotnull AS not_null,
            pg_get_expr(d.adbin, d.adrelid) AS default_val
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
          LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND a.attnum > 0
            AND NOT a.attisdropped
        ),
        pks AS (
          SELECT
            tc.table_name,
            string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS pk_cols
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name
           AND kcu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = 'public'
          GROUP BY tc.table_name
        )
        SELECT
          c.tbl,
          json_agg(json_build_object(
            'name', c.attname,
            'type', c.data_type,
            'not_null', c.not_null,
            'default', c.default_val
          ) ORDER BY c.attnum) AS columns,
          (SELECT pk_cols FROM pks WHERE pks.table_name = c.tbl) AS pk_cols
        FROM cols c
        GROUP BY c.tbl
        ORDER BY c.tbl;
    """
    rows = query(sql)
    out: list[tuple[str, str]] = []
    for r in rows:
        tbl = r["tbl"]
        if tbl in SKIP_TABLES:
            continue
        cols = r["columns"]
        if isinstance(cols, str):
            cols = json.loads(cols)
        col_lines = []
        for c in cols:
            line = f'  "{c["name"]}" {c["type"]}'
            if c.get("default") is not None:
                line += f' DEFAULT {c["default"]}'
            if c.get("not_null"):
                line += " NOT NULL"
            col_lines.append(line)
        if r.get("pk_cols"):
            pk = ", ".join(f'"{c}"' for c in r["pk_cols"].split(","))
            col_lines.append(f"  PRIMARY KEY ({pk})")
        body = ",\n".join(col_lines)
        out.append((tbl, f"CREATE TABLE IF NOT EXISTS {tbl} (\n{body}\n);"))
    return out


def fetch_foreign_keys() -> list[str]:
    rows = query("""
        SELECT
          con.conname AS fk_name,
          cl.relname AS tbl,
          pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname = 'public'
          AND con.contype = 'f'
        ORDER BY cl.relname, con.conname;
    """)
    out = []
    for r in rows:
        if r["tbl"] in SKIP_TABLES:
            continue
        # Wrap in DO block to tolerate already-existing constraint
        # (constraint names can collide on re-run).
        out.append(
            f"-- FK {r['fk_name']} on {r['tbl']}\n"
            f"DO $do$ BEGIN\n"
            f"  ALTER TABLE {r['tbl']} ADD CONSTRAINT {r['fk_name']} {r['def']};\n"
            f"EXCEPTION WHEN duplicate_object THEN NULL;\n"
            f"END $do$;"
        )
    return out


def fetch_check_constraints() -> list[str]:
    rows = query("""
        SELECT
          con.conname AS cname,
          cl.relname AS tbl,
          pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname = 'public'
          AND con.contype = 'c'
        ORDER BY cl.relname, con.conname;
    """)
    out = []
    for r in rows:
        if r["tbl"] in SKIP_TABLES:
            continue
        out.append(
            f"DO $do$ BEGIN\n"
            f"  ALTER TABLE {r['tbl']} ADD CONSTRAINT {r['cname']} {r['def']};\n"
            f"EXCEPTION WHEN duplicate_object THEN NULL;\n"
            f"END $do$;"
        )
    return out


def fetch_unique_constraints() -> list[str]:
    rows = query("""
        SELECT
          con.conname AS cname,
          cl.relname AS tbl,
          pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname = 'public'
          AND con.contype = 'u'
        ORDER BY cl.relname, con.conname;
    """)
    out = []
    for r in rows:
        if r["tbl"] in SKIP_TABLES:
            continue
        out.append(
            f"DO $do$ BEGIN\n"
            f"  ALTER TABLE {r['tbl']} ADD CONSTRAINT {r['cname']} {r['def']};\n"
            f"EXCEPTION WHEN duplicate_object THEN NULL;\n"
            f"END $do$;"
        )
    return out


def fetch_indexes() -> list[str]:
    rows = query("""
        SELECT
          schemaname,
          tablename,
          indexname,
          indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname;
    """)
    out = []
    for r in rows:
        if r["tablename"] in SKIP_TABLES:
            continue
        # Skip PK indexes (created with the PK)
        if r["indexname"].endswith("_pkey"):
            continue
        # Add IF NOT EXISTS — pg_indexes returns def without it
        d = r["indexdef"]
        if " IF NOT EXISTS " not in d.upper():
            d = d.replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ", 1)
            d = d.replace("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ", 1)
        out.append(d + ";")
    return out


def fetch_functions() -> list[str]:
    rows = query("""
        SELECT
          p.proname AS fname,
          pg_get_functiondef(p.oid) AS def
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend d
            WHERE d.objid = p.oid AND d.deptype = 'e'
          )
        ORDER BY p.proname;
    """)
    return [r["def"].rstrip(";") + ";" for r in rows]


def fetch_views() -> list[str]:
    rows = query("""
        SELECT
          v.viewname,
          pg_get_viewdef(c.oid, true) AS def
        FROM pg_views v
        JOIN pg_class c ON c.relname = v.viewname
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = v.schemaname
        WHERE v.schemaname = 'public'
        ORDER BY v.viewname;
    """)
    defs: dict[str, str] = {r["viewname"]: r["def"].rstrip().rstrip(";") for r in rows}

    # Compute view→view dependencies via pg_depend.
    deps_rows = query("""
        SELECT DISTINCT
          dep_view.relname AS dependent,
          src_view.relname AS depends_on
        FROM pg_class dep_view
        JOIN pg_namespace n ON n.oid = dep_view.relnamespace AND n.nspname = 'public'
        JOIN pg_rewrite rw ON rw.ev_class = dep_view.oid
        JOIN pg_depend d ON d.objid = rw.oid AND d.classid = 'pg_rewrite'::regclass
        JOIN pg_class src_view ON src_view.oid = d.refobjid
        WHERE dep_view.relkind = 'v'
          AND src_view.relkind = 'v'
          AND src_view.relname <> dep_view.relname;
    """)
    edges: dict[str, set[str]] = {v: set() for v in defs}
    for r in deps_rows:
        if r["dependent"] in edges and r["depends_on"] in defs:
            edges[r["dependent"]].add(r["depends_on"])

    # Kahn topological sort
    sorted_views: list[str] = []
    pending = dict(edges)
    while pending:
        ready = sorted(v for v, deps in pending.items() if not deps)
        if not ready:
            # Cycle (shouldn't happen with views) — fall back to alphabetical.
            ready = sorted(pending.keys())
        for v in ready:
            sorted_views.append(v)
            pending.pop(v, None)
        for v in pending:
            pending[v] -= set(ready)

    out = []
    for vname in sorted_views:
        out.append(f"CREATE OR REPLACE VIEW {vname} AS\n{defs[vname]};")
    return out


def fetch_triggers() -> list[str]:
    rows = query("""
        SELECT
          t.tgname AS trig,
          c.relname AS tbl,
          pg_get_triggerdef(t.oid, true) AS def
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND NOT t.tgisinternal
        ORDER BY c.relname, t.tgname;
    """)
    out = []
    for r in rows:
        if r["tbl"] in SKIP_TABLES:
            continue
        out.append(
            f"DROP TRIGGER IF EXISTS {r['trig']} ON {r['tbl']};\n"
            f"{r['def']};"
        )
    return out


def fetch_rls_settings() -> list[str]:
    """Force RLS enable on every table that has it on in NZ."""
    rows = query("""
        SELECT c.relname AS tbl
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity = true
        ORDER BY c.relname;
    """)
    out = []
    for r in rows:
        if r["tbl"] in SKIP_TABLES:
            continue
        out.append(f"ALTER TABLE {r['tbl']} ENABLE ROW LEVEL SECURITY;")
    return out


def fetch_policies() -> list[str]:
    rows = query("""
        SELECT
          schemaname,
          tablename,
          policyname,
          permissive,
          roles,
          cmd,
          qual,
          with_check
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename, policyname;
    """)
    out = []
    for r in rows:
        if r["tablename"] in SKIP_TABLES:
            continue
        # Build CREATE POLICY statement
        roles = r.get("roles") or []
        if isinstance(roles, str):
            try:
                roles = json.loads(roles)
            except Exception:
                roles = [roles]
        # postgres returns roles as text array string {"public"} — normalize
        if roles and isinstance(roles, list) and roles == ["{public}"]:
            roles_clause = ""
        elif roles and isinstance(roles, list):
            cleaned = [x.strip("{}") for x in roles if x not in (None, "")]
            roles_clause = " TO " + ", ".join(cleaned) if cleaned else ""
        else:
            roles_clause = ""
        cmd_part = "" if r["cmd"] == "ALL" else f" FOR {r['cmd']}"
        using_part = f"\n  USING ({r['qual']})" if r.get("qual") else ""
        check_part = f"\n  WITH CHECK ({r['with_check']})" if r.get("with_check") else ""
        permissive = "PERMISSIVE" if r["permissive"] == "PERMISSIVE" else "RESTRICTIVE"
        body = (
            f'DROP POLICY IF EXISTS "{r["policyname"]}" ON {r["tablename"]};\n'
            f'CREATE POLICY "{r["policyname"]}" ON {r["tablename"]} '
            f'AS {permissive}{cmd_part}{roles_clause}{using_part}{check_part};'
        )
        out.append(body)
    return out


def main() -> int:
    chunks: list[str] = []
    chunks.append("-- Auto-generated dump of NZ public schema (idempotent).")
    chunks.append("-- Source: pg_catalog of project xfvfxsvqpnpvibgeqpqp.")
    chunks.append("-- Generato da tools/provisioning/dump-nz-schema.py.\n")

    # Migrations log table — created early so the post-baseline INSERTs work.
    chunks.append(
        "CREATE TABLE IF NOT EXISTS public._migrations_log (\n"
        "  filename text PRIMARY KEY,\n"
        "  applied_at timestamptz NOT NULL DEFAULT now(),\n"
        "  checksum text NOT NULL\n"
        ");"
    )

    print("📦 extensions…", file=sys.stderr)
    chunks += fetch_extensions()

    print("📦 enum types…", file=sys.stderr)
    chunks += fetch_enum_types()

    print("📦 tables…", file=sys.stderr)
    table_stmts = fetch_tables()
    chunks += [stmt for _, stmt in table_stmts]

    print("📦 unique constraints…", file=sys.stderr)
    chunks += fetch_unique_constraints()

    print("📦 check constraints…", file=sys.stderr)
    chunks += fetch_check_constraints()

    print("📦 foreign keys…", file=sys.stderr)
    chunks += fetch_foreign_keys()

    print("📦 indexes…", file=sys.stderr)
    chunks += fetch_indexes()

    print("📦 functions…", file=sys.stderr)
    chunks += fetch_functions()

    print("📦 views…", file=sys.stderr)
    chunks += fetch_views()

    print("📦 triggers…", file=sys.stderr)
    chunks += fetch_triggers()

    print("📦 RLS enable…", file=sys.stderr)
    chunks += fetch_rls_settings()

    print("📦 policies…", file=sys.stderr)
    chunks += fetch_policies()

    # Mark the 7 delta migrations as already incorporated in this baseline.
    # Without this, a fresh tenant would re-apply them and fail with
    # "policy/column already exists" — they're embedded in the dump above.
    chunks.append("""\
-- Le 7 migrazioni delta (001-007) sono già incorporate in questo baseline.
-- Le marchiamo come applicate per evitare re-run su tenant nuovi.
INSERT INTO public._migrations_log (filename, checksum) VALUES
  ('20260417_001_add_company_id_rls_policies_16_tables.sql', 'incorporated-in-baseline'),
  ('20260417_002_remove_legacy_auth_policies.sql', 'incorporated-in-baseline'),
  ('20260417_003_add_company_id_3_tables.sql', 'incorporated-in-baseline'),
  ('20260417_004_create_yapily_tables.sql', 'incorporated-in-baseline'),
  ('20260417_005_create_get_yapily_credentials_rpc.sql', 'incorporated-in-baseline'),
  ('20260417_006_add_yapily_source_and_link.sql', 'incorporated-in-baseline'),
  ('20260421_007_budget_entries_fix_and_bilancio_gap.sql', 'incorporated-in-baseline')
ON CONFLICT (filename) DO NOTHING;""")

    OUT.write_text("\n\n".join(chunks) + "\n", encoding="utf-8")
    print(f"\n✅ wrote {OUT.name} ({OUT.stat().st_size} bytes, {len(table_stmts)} tables)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
