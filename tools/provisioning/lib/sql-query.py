#!/usr/bin/env python3
"""
Mini-helper: esegue una query SQL via Management API contro un progetto
Supabase e ne stampa il JSON risultato.

Uso:
  TOKEN=... python3 sql-query.py <project_ref> "SELECT ..."
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request


def query(token: str, ref: str, sql: str) -> list[dict]:
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
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body[:500]}\n  query: {sql[:200]}") from e


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: TOKEN=... sql-query.py <project_ref> \"SELECT ...\"", file=sys.stderr)
        return 2
    token = os.environ.get("TOKEN")
    if not token:
        print("set TOKEN env var", file=sys.stderr)
        return 2
    ref = sys.argv[1]
    sql = sys.argv[2]
    result = query(token, ref, sql)
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
