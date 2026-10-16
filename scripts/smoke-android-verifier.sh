#!/usr/bin/env bash
# Real SDK policy probe only: no application behavior, release key or artifact upload.
set -euo pipefail
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "$sdk" ]]
work=$(mktemp -d "${RUNNER_TEMP:?}/lifestyle-verifier-probe.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
chmod 700 "$work"
version=$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
platform=$(find "$sdk/platforms" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E '^android-[0-9]+$' | sort -V | tail -1)
cat > "$work/AndroidManifest.xml" <<'XML'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.lifestyle.app.validation"><uses-sdk android:minSdkVersion="24"/><application android:label="Verifier fixture — not LifeStyle" android:hasCode="false"/></manifest>
XML
"$sdk/build-tools/$version/aapt2" link -o "$work/unsigned.apk" --manifest "$work/AndroidManifest.xml" -I "$sdk/platforms/$platform/android.jar"
export FIXTURE_KEY_PASSWORD
FIXTURE_KEY_PASSWORD=$(openssl rand -hex 24)
printf '::add-mask::%s\n' "$FIXTURE_KEY_PASSWORD"
"${JAVA_HOME:?}/bin/keytool" -genkeypair -noprompt -keystore "$work/fixture.jks" -storetype JKS -alias fixture -storepass:env FIXTURE_KEY_PASSWORD -keypass:env FIXTURE_KEY_PASSWORD -keyalg RSA -dname 'CN=Android Debug,O=Android,C=US' -validity 1 >/dev/null 2>&1
"$JAVA_HOME/bin/java" -jar "$sdk/build-tools/$version/lib/apksigner.jar" sign --ks "$work/fixture.jks" --ks-key-alias fixture --ks-pass env:FIXTURE_KEY_PASSWORD --key-pass env:FIXTURE_KEY_PASSWORD --out "$work/probe.apk" "$work/unsigned.apk"
node scripts/verify-android-apk.mjs debug "$work/probe.apk"
echo 'PASS: real SDK fixture signature/package policy probe; NOT a LifeStyle app build or device test.'
