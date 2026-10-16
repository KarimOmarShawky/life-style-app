import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectForbiddenFile, inspectLocalPickerSource } from './check-forbidden.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const manifest = 'mobile-app/mobile/pubspec.yaml';
const lock = 'mobile-app/mobile/pubspec.lock';
const screen = 'mobile-app/mobile/lib/features/timer/presentation/focus_timer_screen.dart';
const audioImport = "import 'package:file_picker/file_picker.dart';";
const audioCall = 'await FilePicker.pickFile(type: FileType.audio);';

test('only the current direct manifest and hosted lock entries are permitted', () => {
  assert.deepEqual(inspectForbiddenFile(manifest, read(manifest)), []);
  assert.deepEqual(inspectForbiddenFile(lock, read(lock)), []);
});

for (const dependency of ['multer', 'busboy', 'formidable', '@aws-sdk/client-s3', 'file_picker']) {
  test(`backend production dependency ${dependency} still fails, even if globally allowlisted`, () => {
    const content = JSON.stringify({ dependencies: { [dependency]: '1.0.0' } });
    assert.ok(inspectForbiddenFile('backend/package.json', content, [dependency]).length > 0);
  });
}

test('file_picker is not permitted in backend dev or root manifests', () => {
  for (const file of ['backend/package.json', 'package.json', 'backend/package-lock.json']) {
    assert.ok(inspectForbiddenFile(file, JSON.stringify({ devDependencies: { file_picker: '1.0.0' } }), ['file_picker']).length);
  }
});

test('existing formidable test-tool exception does not authorize a production dependency', () => {
  const content = JSON.stringify({ devDependencies: { formidable: '1.0.0' } });
  assert.deepEqual(inspectForbiddenFile('backend/package.json', content, ['formidable']), []);
  assert.ok(inspectForbiddenFile('backend/package.json', content).length);
});

test('other forbidden mobile packages are not excused by local audio approval', () => {
  for (const dependency of ['image_picker', 'multer', 'openai', 'sqflite']) {
    assert.ok(inspectForbiddenFile(manifest, `dependencies:\n  ${dependency}: ^1.0.0\n`).length);
  }
});

test('picker mention outside the approved manifest dependency line fails', () => {
  for (const content of ['dev_dependencies:\n  file_picker: ^13.1.0\n', 'description: file_picker\n', 'dependencies:\n  file_picker: ^14.0.0\n']) {
    assert.ok(inspectForbiddenFile(manifest, content, ['file_picker']).length);
  }
});

test('lock allowance is tied to its own reviewed hosted direct package block', () => {
  const source = read(lock);
  for (const content of [source.replace('  file_picker:\n', '  unrelated_package:\n'),
    source.replace('    version: "13.1.0"', '    version: "14.0.0"'),
    'packages:\n  unrelated:\n      name: file_picker\n']) {
    assert.ok(inspectForbiddenFile(lock, content, ['file_picker']).length);
  }
});

test('current audio-only consumer is permitted, without new picker consumers', () => {
  assert.deepEqual(inspectLocalPickerSource(screen, read(screen)), []);
  assert.ok(inspectLocalPickerSource('mobile-app/mobile/lib/data/uploader.dart', `${audioImport}\n${audioCall}`).length);
});

test('federated picker imports and aliased imports are not blanket-approved', () => {
  for (const statement of ["import 'package:android_file_picker/android_file_picker.dart';",
    "import 'package:file_picker_platform_interface/file_picker_platform_interface.dart';",
    "export 'package:file_picker/file_picker.dart';", "import 'package:file_picker/file_picker.dart' as picker;"]) {
    assert.ok(inspectLocalPickerSource(screen, statement).length);
  }
});

test('broad file selection and additional picker invocations fail', () => {
  for (const content of [`${audioImport}\nawait FilePicker.pickFile(type: FileType.any);`,
    `${audioImport}\n${audioCall}\n${audioCall}`, `${audioImport}\nawait FilePicker.pickFiles();`]) {
    assert.ok(inspectLocalPickerSource(screen, content).length);
  }
});

test('violations expose metadata only, not source/configuration values', () => {
  const sentinel = 'synthetic-private-value-do-not-print';
  const result = inspectForbiddenFile('backend/.env.example', `MONGODB_URI=${sentinel}`);
  assert.ok(result.length); assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.deepEqual(Object.keys(result[0]).sort(), ['category', 'file', 'line']);
});

test('current picker and playback path remain local (source contract, not device/network evidence)', () => {
  const source = read(screen);
  const picker = source.split('Future<void> _pickSong() async {')[1].split('Future<void> _clearSong()')[0];
  assert.ok(picker.includes(audioCall) && picker.includes('_songPath = path'));
  assert.ok(!/http\.|ApiClient|Multipart|upload|base64|readAsBytes/.test(picker));
  const prefs = source.split('Future<void> _savePrefs() async {')[1].split('Future<void> _selectAmbient')[0];
  assert.ok(prefs.includes('prefs.setString(_prefSongPath, path)'));
  assert.ok(!/ApiClient|http\.|upload|repository/.test(prefs));
  const player = read('mobile-app/mobile/lib/features/timer/data/session_audio_player.dart');
  assert.ok(player.includes('_player.setSourceDeviceFile(path)'));
  assert.ok(!/UrlSource|setSourceUrl|package:http|Multipart/.test(player));
});

test('real app keeps JSON-only middleware ahead of API routers (source order only)', () => {
  const source = read('backend/src/app.ts');
  const enforcement = source.indexOf('app.use(enforceJsonContentType)');
  const routes = source.indexOf('const v1Router = Router()');
  assert.ok(enforcement >= 0 && routes > enforcement);
  assert.ok(source.includes("app.use(express.json({ limit: '100kb' }))"));
  assert.ok(!/express\.raw\(|express\.urlencoded\(|multer\(/.test(source));
  assert.ok(!JSON.parse(read('scripts/forbidden-allowlist.json')).allowlist.some((entry) => entry.dependency === 'file_picker'));
});

// Execute the actual CLI in an owned minimal source fixture, never mutate the
// checkout or invoke application services. Only these temporary fixtures are removed.
function cliFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'lifestyle-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
  write('scripts/check-forbidden.mjs', read('scripts/check-forbidden.mjs'));
  write('scripts/forbidden-allowlist.json', read('scripts/forbidden-allowlist.json'));
  write(manifest, read(manifest)); write(lock, read(lock)); write(screen, `${audioImport}\n${audioCall}`);
  const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-forbidden.mjs')], { cwd: root, encoding: 'utf8' });
  return { write, run };
}

test('actual CLI accepts the reviewed local-only fixture', (t) => {
  const { run } = cliFixture(t); const result = run();
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Check PASSED/);
});

test('actual CLI rejects server upload dependency without echoing config values', (t) => {
  const { write, run } = cliFixture(t);
  write('backend/package.json', JSON.stringify({ dependencies: { multer: '1.0.0' }, privateValue: 'synthetic-do-not-echo' }));
  const result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /VIOLATION/);
  assert.ok(!result.stderr.includes('synthetic-do-not-echo'));
});

test('actual CLI discovers and rejects a new nested picker consumer', (t) => {
  const { write, run } = cliFixture(t);
  write('mobile-app/mobile/lib/features/other/uploader.dart', `${audioImport}\n${audioCall}`);
  const result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /Unapproved local picker consumer/);
});

test('actual CLI fails closed on malformed policy configuration', (t) => {
  const { write, run } = cliFixture(t); write('scripts/forbidden-allowlist.json', '{broken synthetic config');
  const result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /inspection could not complete/);
});
