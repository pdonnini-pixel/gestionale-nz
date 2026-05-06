#!/usr/bin/env python3
"""Static sanity check on the generated baseline migration.

Looks for patterns that would prevent idempotency or syntactic correctness.
Does NOT execute SQL — that happens in apply-migrations.ts on a real tenant.
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TARGET = (
    ROOT / "frontend" / "supabase" / "migrations"
    / "20260417_000_baseline_schema.sql"
)


def main() -> int:
    sql = TARGET.read_text(encoding="utf-8")
    issues: list[str] = []

    # Patterns that should NOT appear in a baseline (would break re-runs):
    bad_patterns = [
        (r"^\s*CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)", "CREATE TABLE without IF NOT EXISTS"),
        (r"^\s*CREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS\b)", "CREATE INDEX without IF NOT EXISTS"),
        (r"^\s*CREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS\b)", "CREATE UNIQUE INDEX without IF NOT EXISTS"),
        (r"^\s*CREATE\s+FUNCTION\s+(?!OR\s+REPLACE\b)", "CREATE FUNCTION without OR REPLACE"),
        (r"^\s*CREATE\s+VIEW\s+(?!OR\s+REPLACE\b)", "CREATE VIEW without OR REPLACE"),
        # CREATE TYPE outside DO block
        (r"^\s*CREATE\s+TYPE\s+\w+\s+AS\s+ENUM", "CREATE TYPE not wrapped in DO block (will fail on re-run)"),
        (r"\bDROP\s+TABLE\s+", "DROP TABLE present (NOT allowed in baseline)"),
        (r"\bDROP\s+SCHEMA\s+", "DROP SCHEMA present (NOT allowed in baseline)"),
        (r"\bTRUNCATE\s+", "TRUNCATE present (NOT allowed in baseline)"),
        # ALTER TABLE … ADD COLUMN without IF NOT EXISTS
        (
            r"^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)",
            "ALTER TABLE … ADD COLUMN without IF NOT EXISTS",
        ),
        (r";;\s*$", "double semicolon"),
    ]

    lines = sql.splitlines()
    in_do_block = False
    for ln_idx, line in enumerate(lines, start=1):
        # Track DO block state to allow `CREATE TYPE … AS ENUM` inside.
        if re.search(r"\bDO\s+\$\w*\$\s+BEGIN\b", line, re.IGNORECASE):
            in_do_block = True
        if re.search(r"\bEND\s+\$\w*\$\s*;?$", line, re.IGNORECASE):
            in_do_block = False
            continue
        if in_do_block:
            # Skip rules inside DO blocks — CREATE TYPE will appear there legally.
            continue
        for pat, desc in bad_patterns:
            if re.search(pat, line, re.IGNORECASE | re.MULTILINE):
                issues.append(f"line {ln_idx}: {desc}\n    > {line.strip()}")
                break

    # Count statements crudely
    # (split on `;` outside dollar-quotes — simplified)
    statements = sum(1 for c in sql if c == ";")
    print(f"file:        {TARGET.relative_to(ROOT)}")
    print(f"size:        {len(sql)} bytes ({len(lines)} lines)")
    print(f"~statements: {statements}")

    if issues:
        print(f"\n❌ {len(issues)} issue(s):")
        for i in issues[:30]:
            print(f"  {i}")
        if len(issues) > 30:
            print(f"  … and {len(issues) - 30} more")
        return 1
    print("\n✅ No idempotency violations detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
