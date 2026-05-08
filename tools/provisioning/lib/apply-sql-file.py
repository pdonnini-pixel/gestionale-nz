#!/usr/bin/env python3
"""
Esegue un file SQL su un progetto Supabase via Management API.

Uso:
  TOKEN=... python3 apply-sql-file.py <project_ref> <path_to_sql>
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: TOKEN=... apply-sql-file.py <project_ref> <path>", file=sys.stderr)
        return 2
    token = os.environ.get("TOKEN")
    if not token:
        print("set TOKEN env var", file=sys.stderr)
        return 2
    ref = sys.argv[1]
    path = Path(sys.argv[2])
    if not path.exists():
        print(f"file not found: {path}", file=sys.stderr)
        return 2

    sql = path.read_text(encoding="utf-8")
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "gestionale-nz-provisioning/0.1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            print(f"OK: {path.name} applied to {ref}")
            return 0
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} on {ref}: {body_err[:1000]}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
