import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const mobile = 'mobile-app/mobile/';
const native = mobile + 'android/app/src/main/kotlin/com/example/lifestyle_mobile/';
const wire = read(mobile + 'test/fixtures/account_archive_v1.ndjson');
const lines = wire.trimEnd().split('\n');
const frames = lines.map((line) => JSON.parse(line));
const footer = frames.at(-1), manifest = frames[0];

test('synthetic server-protocol fixture has exact UTF-8 count/hash and completion counts (not Dart execution)', () => {
  const prefix = lines.slice(0, -1).map((line) => line + '\n').join('');
  assert.equal(footer.sha256, createHash('sha256').update(prefix).digest('hex'));
  assert.equal(footer.bytesBeforeComplete, Buffer.byteLength(prefix));
  assert.equal(footer.records, 3);
  for (const section of manifest.sections) assert.equal(footer.counts[section], frames.filter((frame) => frame.section === section).length);
  assert.ok(wire.endsWith('\n') && !wire.endsWith('\n\n'));
});

test('version-1 ordered sections agree across backend projections, Dart verifier and fixture (source contract)', () => {
  const backend = [...read('backend/src/features/users/account-archive.sources.ts').matchAll(/section: '([^']+)'/g)].map((m) => m[1]);
  const dart = read(mobile + 'lib/core/archive/archive_verifier.dart').split('const archiveSectionsV1 = <String>[')[1].split('];')[0];
  const client = [...dart.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.equal(backend.length, 21); assert.deepEqual(client, backend); assert.deepEqual(manifest.sections, backend);
});

test('fixture exercises non-ASCII bytes, escaped newlines and exact decimal strings without credential fields', () => {
  assert.ok(Buffer.byteLength(wire) > wire.length);
  assert.match(frames.find((frame) => frame.section === 'notes').data.body, /\n/);
  assert.equal(frames.find((frame) => frame.section === 'transactions').data.amount, '900719925474099.1234');
  for (const frame of frames.filter((frame) => frame.type === 'record')) assert.ok(!/password_hash|token_hash|push_token/.test(JSON.stringify(frame.data)));
});

test('archive transport has a dedicated connection and bounded error/chunk path, not whole-response decoding (source only)', () => {
  const source = read(mobile + 'lib/data/api_client.dart').split('Stream<List<int>> streamAccountArchive(')[1].split('/// Rotates')[0];
  for (const token of ['_archiveClientFactory()', 'followRedirects = false', 'maxRedirects = 0', "code == 'TOKEN_EXPIRED'", 'attempt == 0', '64 * 1024', '32 * 1024']) assert.ok(source.includes(token));
  assert.ok(!/http\.Response\.fromStream\(|response\.stream\.toBytes\(/.test(source));
});

test('opaque staging channel methods and Activity hooks agree (source only)', () => {
  const dart = read(mobile + 'lib/core/archive/archive_export.dart');
  const bridge = read(native + 'AccountArchiveBridge.kt');
  for (const method of ['begin', 'append', 'seal', 'save', 'discard']) {
    assert.ok(new RegExp(`invokeMethod<[^>]+>\\('${method}'`).test(dart));
    assert.ok(bridge.includes(`"${method}" ->`));
  }
  assert.ok(dart.includes("MethodChannel('lifestyle/account_archive')"));
  assert.ok(bridge.includes('MethodChannel(messenger, "lifestyle/account_archive")'));
  const activity = read(native + 'MainActivity.kt');
  assert.ok(activity.includes('accountArchiveBridge?.onActivityResult(') && activity.includes('accountArchiveBridge?.close()'));
});

test('staging is bounded/chunk-authenticated and publishes through explicit SAF consent, not storage permissions (source only)', () => {
  const stage = read(native + 'AccountArchiveStage.kt'), bridge = read(native + 'AccountArchiveBridge.kt');
  for (const marker of ['CHUNK_BYTES = 32 * 1024', 'MAX_BYTES = 128L * 1024 * 1024', 'AES/GCM/NoPadding', 'updateAAD(', 'verifySaved(']) assert.ok(stage.includes(marker));
  assert.ok(!stage.includes('CipherInputStream('));
  for (const marker of ['activity.noBackupFilesDir', 'Intent.ACTION_CREATE_DOCUMENT', 'stage.verifySaved(it)']) assert.ok(bridge.includes(marker));
  assert.ok(!bridge.includes('takePersistableUriPermission') && !bridge.includes('requestPermissions('));
  assert.ok(!/WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE/.test(read(mobile + 'android/app/src/main/AndroidManifest.xml')));
});

test('verification and destination consent remain separate; password clearing and session/dispose cancellation are wired (source only)', () => {
  const ui = read(mobile + 'lib/features/auth/presentation/account_archive_dialog.dart');
  assert.ok(ui.includes('_password.clear()') && ui.includes('widget.cancel.cancel()'));
  assert.ok(ui.includes('await prepared.save()') && ui.includes('prepareAccountArchive('));
  assert.ok(!ui.includes('Clipboard.') && !ui.includes('jsonEncode('));
  const profile = read(mobile + 'lib/features/auth/presentation/profile_screen.dart');
  assert.ok(profile.includes('next.valueOrNull?.id != _archiveUserId') && profile.includes('_archiveCancel?.cancel()'));
});

test('crypto is explicitly pinned; local-audio dependency is preserved without a blanket picker exemption', () => {
  assert.ok(read(mobile + 'pubspec.yaml').includes('crypto: 3.0.7'));
  const entry = read(mobile + 'pubspec.lock').split('  crypto:\n')[1].split('  dbus:')[0];
  assert.ok(entry.includes('dependency: "direct main"') && entry.includes('version: "3.0.7"'));
  assert.ok(read(mobile + 'pubspec.yaml').includes('file_picker: ^13.1.0'));
  assert.ok(!JSON.parse(read('scripts/forbidden-allowlist.json')).allowlist.some((entry) => entry.dependency === 'file_picker'));
});
