#!/usr/bin/env bash
# Safe by default. Full verification requires explicitly owned disposable targets.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---unit}"
case "$MODE" in
  --help|-h)
    printf '%s\n' 'Usage: bash scripts/verify-ci.sh [--unit | --isolated]' \
      'Default: quality, unit, build and audit checks; no migrations or destructive suites.' \
      '--isolated: requires ALLOW_DESTRUCTIVE_TESTS=isolated-resources-only and explicit matching test DB/Redis targets.' \
      'Never use live/staging/development data. No down migrations or implicit URL defaults.'
    exit 0 ;;
  --unit|--isolated) ;;
  *) printf '%s\n' 'BLOCKED: unknown verification mode.' >&2; exit 2 ;;
esac
if (( $# > 1 )); then
  printf '%s\n' 'BLOCKED: unexpected verification arguments.' >&2
  exit 2
fi
cd "$ROOT"
if [[ "$MODE" == --isolated ]]; then
  # Must precede every migration/test command, even before package quality checks.
  node scripts/check-environment.mjs isolated
fi
node scripts/check-forbidden.mjs
cd "$ROOT/backend"
npm run format:check
npm run lint
npm run typecheck
npm run typecheck:tests
npm run build
npm run test:unit
npm audit --omit=dev --audit-level=high
if [[ "$MODE" == --isolated ]]; then
  npm run migrate:up
  npm run migrate:up
  npm run test:coverage
fi
printf '%s\n' "PASS: requested $MODE verification commands completed. Unrequested infrastructure/mobile/device gates are NOT RUN."
