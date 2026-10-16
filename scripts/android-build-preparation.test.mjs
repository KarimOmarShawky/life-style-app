import test from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { prepareSigning, propertyValue } from './prepare-android-signing.mjs';
import { verifyCertificate } from './verify-android-apk.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'android-signing-test-'));
  const androidDir = join(root, 'android'); mkdirSync(androidDir);
  return { root, androidDir, tempRoot: join(root, 'private'), env: {
    ANDROID_KEYSTORE_BASE64: Buffer.from('synthetic bytes; NOT a keystore or signing test').toString('base64'),
    ANDROID_KEYSTORE_PASSWORD: 'synthetic-only', ANDROID_KEY_ALIAS: 'fixture', ANDROID_KEY_PASSWORD: 'synthetic-only'
  } };
}

// Synthetic parsing fixtures only: no apksigner, Android compilation or real key is mocked as a PASS.
const cert = (debug = false, digest = '1'.repeat(64)) => `Verifies\nNumber of signers: 1\nSigner #1 certificate DN: CN=${debug ? 'Android Debug, O=Android, C=US' : 'Synthetic fixture'}\nSigner #1 certificate SHA-256 digest: ${digest}\n`;

test('private signing preparation uses exclusive private files; no default/generated signing identity', () => {
  const f = fixture();
  try {
    const result = prepareSigning(f);
    const props = readFileSync(result.properties, 'utf8');
    assert.match(props, /storeFile=/); assert.match(props, /keyAlias=fixture/);
    assert.equal(statSync(result.directory).mode & 0o777, 0o700);
    assert.equal(statSync(result.properties).mode & 0o777, 0o600);
    assert.equal(statSync(join(result.directory, 'release.jks')).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(result.directory, 'release.jks'), 'utf8'), 'synthetic bytes; NOT a keystore or signing test');
    assert.throws(() => prepareSigning(f), /overwrite/);
    assert.equal(readFileSync(result.properties, 'utf8'), props);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

for (const name of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
  test(`missing ${name} fails without creating private state`, () => {
    const f = fixture();
    try { delete f.env[name]; assert.throws(() => prepareSigning(f), /incomplete/); assert.equal(existsSync(f.tempRoot), false); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}

test('invalid/oversized base64 is refused; existing user configuration is never overwritten', () => {
  const f = fixture();
  try {
    const valid = f.env.ANDROID_KEYSTORE_BASE64;
    for (const value of ['not-base64!', 'Zg=', 'Zh==', 'a'.repeat(14_000_001)]) {
      f.env.ANDROID_KEYSTORE_BASE64 = value;
      assert.throws(() => prepareSigning(f)); assert.equal(existsSync(f.tempRoot), false);
    }
    f.env.ANDROID_KEYSTORE_BASE64 = valid;
    writeFileSync(join(f.androidDir, 'key.properties'), 'existing-user-data');
    assert.throws(() => prepareSigning(f), /overwrite/);
    assert.equal(readFileSync(join(f.androidDir, 'key.properties'), 'utf8'), 'existing-user-data');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('Java Properties escaping preserves Unicode, backslashes and multiline values as one property', () => {
  assert.equal(propertyValue(' a\\b=1:\r\n\t\u0000éع😀'), '\\ a\\\\b\\=1\\:\\u000d\\u000a\\u0009\\u0000\\u00e9\\u0639\\ud83d\\ude00');
  assert.ok(!propertyValue('value\nkey=injected').includes('\n'));
});

test('signer parser accepts configured release certificate, with optional colon separators', () => {
  verifyCertificate(cert(), 'release', '1'.repeat(64));
  verifyCertificate(cert(), 'release', Array(32).fill('11').join(':'));
  verifyCertificate(cert(true), 'debug');
});

test('signer parser refuses missing/unexpected certificate, debug release and multiple signers', () => {
  for (const [output, mode, expected] of [
    [cert(), 'release', ''], [cert(), 'release', '2'.repeat(64)],
    [cert(true), 'release', '1'.repeat(64)], [cert(), 'debug', ''],
    [cert().replace('signers: 1', 'signers: 2'), 'release', '1'.repeat(64)],
    ['unverified', 'release', '1'.repeat(64)], [cert(), 'unknown', '']
  ]) assert.throws(() => verifyCertificate(output, mode, expected));
});

test('actual verification CLI refuses missing SDK/APK; not an APK verification success', () => {
  const child = spawnSync(process.execPath, ['scripts/verify-android-apk.mjs', 'release', '/nonexistent/app.apk'], {
    encoding: 'utf8', env: { ...process.env, ANDROID_HOME: '', ANDROID_SDK_ROOT: '' }
  });
  assert.equal(child.status, 1); assert.match(child.stderr, /FAIL/); assert.doesNotMatch(child.stdout, /PASS/);
});

test('Gradle source ordering/Kotlin opt-out/release precondition and CI artifact boundary are explicit', () => {
  const gradle = readFileSync('mobile-app/mobile/android/app/build.gradle.kts', 'utf8');
  const props = readFileSync('mobile-app/mobile/android/gradle.properties', 'utf8');
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.ok(gradle.indexOf('plugins {') < gradle.indexOf('val keystoreProperties'));
  assert.match(props, /android.builtInKotlin=false/);
  assert.match(gradle, /id\("org.jetbrains.kotlin.android"\)/);
  assert.match(gradle, /if \(name == "preReleaseBuild"\) dependsOn\(validateReleaseSigning\)/);
  assert.match(gradle, /throw GradleException/);
  assert.doesNotMatch(gradle, /signingConfig = null|getByName\("debug"\)/);
  assert.match(ci, /--debug --dart-define="API_BASE_URL=\$VALIDATION_API_BASE_URL"/);
  assert.match(ci, /inputs.validation_api_base_url \|\| 'https:\/\/validation.invalid\/api\/v1'/);
  assert.match(ci, /lifestyle-android-debug-validation-NOT-RELEASE/);
  assert.match(ci, /environment: android-release/);
  assert.match(ci, /needs: \[backend-gate, mobile-gate\]/);
  assert.match(ci, /cache-disabled: true/);
  assert.match(ci, /if-no-files-found: error/);
  assert.match(ci, /verify-android-apk.mjs release/);
});


test('actual YAML parse and bash syntax for workflow commands (not hosted execution)', () => {
  const require = createRequire(new URL('../backend/package.json', import.meta.url));
  const yaml = require('js-yaml'); // Existing lockfile-installed lint dependency, no new runtime package.
  const ci = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'));
  assert.equal(ci.on.workflow_dispatch.inputs.build_signed_release.default, false);
  assert.equal(ci.on.workflow_dispatch.inputs.validation_api_base_url.default, 'https://validation.invalid/api/v1');
  assert.ok(ci.jobs['android-signed-release'].if.includes("github.ref == 'refs/heads/main'"));
  for (const job of Object.values(ci.jobs)) {
    for (const step of job.steps) {
      if (!step.run) continue;
      const child = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
      assert.equal(child.status, 0, `Invalid shell syntax in ${step.name || 'unnamed step'}`);
    }
  }
});


test('all six reset-request catalog entries use conditional best-effort copy, not delivery assertions (source only)', () => {
  for (const [locale, wording] of Object.entries({
    en: /eligible.*try/, ar: /لحساب مؤهل.*سنحاول/, fr: /éligible.*essaierons/,
    es: /requisitos.*intentaremos/, de: /berechtigt.*versuchen/, tr: /uygunsa.*deneyeceğiz/
  })) {
    const source = readFileSync(`mobile-app/mobile/lib/l10n/catalog_${locale}.dart`, 'utf8');
    const value = source.match(/'resetCodeSent':\s*'([^']*)'/)?.[1];
    assert.ok(value, locale); assert.match(value, wording, locale);
  }
});
