#!/usr/bin/env bash
set -eu
# Portable behavioral harness, not an Android runtime/device test.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$ROOT/tools/focus-shield-store-harness"
KOTLINC="${KOTLINC:-kotlinc}"
JAVA="${JAVA:-java}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
"$KOTLINC" "$BASE"/stubs/*.kt "$BASE/fake/servicefake.kt" "$BASE/runner.kt" \
  "$ROOT/mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/ShieldDecisionEngine.kt" \
  "$ROOT/mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/FocusShieldSessionStore.kt" \
  -nowarn -include-runtime -d "$OUT/test.jar"
"$JAVA" -jar "$OUT/test.jar"
