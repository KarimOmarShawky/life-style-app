import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { verifyBundleCertificate, verifyBundleSignature } from './verify-android-aab.mjs';

// Parsing fixtures only (public root CA certificates from Node): no jarsigner run, bundle or key is mocked as a PASS.
const pem = rootCertificates[0];
const digest = new X509Certificate(pem).fingerprint256;
const keytoolOutput = (...certs) => certs.map((c, i) => `Signer #${i + 1}:\n\nSignature:\n\n${c}\n`).join('\n');

test('bundle signature policy requires a fully verified JAR signature', () => {
  assert.doesNotThrow(() => verifyBundleSignature('\njar verified.\n\nWarning: \nThis jar contains signatures that do not include a timestamp.\n'));
  for (const output of ['jar is unsigned.\n', 'jar verified.\n\nThis jar contains unsigned entries which have not been integrity-checked.\n', '', 'jarsigner: java.lang.SecurityException: invalid SHA-256 signature file digest\n']) {
    assert.throws(() => verifyBundleSignature(output), /fully signed/);
  }
});

test('bundle certificate must be the single explicitly expected upload certificate', () => {
  assert.doesNotThrow(() => verifyBundleCertificate(keytoolOutput(pem), digest));
  assert.doesNotThrow(() => verifyBundleCertificate(keytoolOutput(pem), digest.replaceAll(':', '').toLowerCase()));
  assert.throws(() => verifyBundleCertificate(keytoolOutput(pem), '0'.repeat(64)), /unexpected/);
  assert.throws(() => verifyBundleCertificate(keytoolOutput(pem), ''), /not explicitly configured/);
  assert.throws(() => verifyBundleCertificate(keytoolOutput(pem, rootCertificates[1]), digest), /Exactly one/);
  assert.throws(() => verifyBundleCertificate('Signer #1:\n', digest), /Exactly one/);
});

test('CLI refuses a missing bundle without printing tool output', () => {
  const child = spawnSync(process.execPath, ['scripts/verify-android-aab.mjs', '/nonexistent/app-release.aab'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ANDROID_RELEASE_CERT_SHA256: digest }
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /"stage":"inputs"/);
  assert.match(child.stderr, /no bundle accepted/);
  assert.doesNotMatch(child.stdout, /PASS/);
});

test('signed release job builds, verifies and uploads the App Bundle next to the APK (YAML source, not hosted run)', () => {
  const require = createRequire(new URL('../backend/package.json', import.meta.url));
  const yaml = require('js-yaml');
  const job = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs['android-signed-release'];
  const runs = job.steps.map((step) => step.run || '').join('\n');
  assert.match(runs, /flutter build apk --release --obfuscate/);
  assert.match(runs, /flutter build appbundle --release --obfuscate --split-debug-info="\$RUNNER_TEMP\/lifestyle-bundle-symbols"/);
  assert.match(runs, /verify-android-aab\.mjs mobile-app\/mobile\/build\/app\/outputs\/bundle\/release\/app-release\.aab/);
  const uploads = job.steps.filter((step) => String(step.uses || '').startsWith('actions/upload-artifact@'));
  const bundle = uploads.find((step) => step.with.name === 'lifestyle-android-signed-bundle');
  assert.ok(bundle, 'bundle artifact');
  assert.equal(bundle.with.path, 'mobile-app/mobile/build/app/outputs/bundle/release/app-release.aab');
  assert.equal(bundle.with['if-no-files-found'], 'error');
  const symbols = uploads.find((step) => step.with.name === 'lifestyle-android-bundle-symbols');
  assert.ok(symbols, 'bundle symbols artifact');
  assert.equal(symbols.with['if-no-files-found'], 'error');
  // The bundle is verified before it is uploaded.
  const names = job.steps.map((step) => step.name || '');
  const verifyIndex = job.steps.findIndex((step) => String(step.run || '').includes('verify-android-aab.mjs'));
  assert.ok(verifyIndex > -1 && verifyIndex < job.steps.indexOf(bundle), names.join(' | '));
});
