#!/usr/bin/env bash
# Compatibility entry point: non-mutating configuration preflight ONLY.
# Does not install packages, start services, create databases, or run migrations.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

case "${1:-}" in
  --help|-h)
    printf '%s\n' 'Usage: bash scripts/ensure-env.sh [--check]' \
      'Export DATABASE_URL, DATABASE_MIGRATION_URL and REDIS_URL using your trusted environment manager.' \
      'This command checks configuration syntax only; it never loads .env or changes services/data.'
    exit 0 ;;
  ''|--check) ;;
  *) printf '%s\n' 'BLOCKED: unknown preflight option.' >&2; exit 2 ;;
esac
if (( $# > 1 )); then
  printf '%s\n' 'BLOCKED: unexpected preflight arguments.' >&2
  exit 2
fi
command -v node >/dev/null || { printf '%s\n' 'BLOCKED: Node.js is required.' >&2; exit 2; }
node "$ROOT/scripts/check-environment.mjs" preflight
printf '%s\n' 'No dependencies, services, databases or migrations were changed. Follow docs/database/migrations.md for explicit deployment.'
