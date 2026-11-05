#!/usr/bin/env bash
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$ROOT/tools/focus-shield-store-harness"
KOTLINC="${KOTLINC:-kotlinc}"
JAVA="${JAVA:-java}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
"$KOTLINC" "$BASE"/stubs/*.kt "$BASE"/service-stubs/*.kt "$BASE/service-runner.kt" \
  "$ROOT/mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/ShieldDecisionEngine.kt" \
  "$ROOT/mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/FocusShieldSessionStore.kt" \
  "$ROOT/mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/FocusShieldAccessibilityService.kt" \
  -nowarn -include-runtime -d "$OUT/test.jar"
"$JAVA" -jar "$OUT/test.jar"
