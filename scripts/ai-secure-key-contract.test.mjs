import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = 'mobile-app/mobile/';
const service = readFileSync(root + 'lib/features/ai/data/ai_service.dart', 'utf8');
const dialog = readFileSync(root + 'lib/features/ai/presentation/gemini_key_dialog.dart', 'utf8');

test('BYOK mutations do not acknowledge a secure-storage failure', () => {
  const method = service.split('  Future<void> setUserApiKey(')[1].split('  /// Resolves the active Gemini')[0];
  assert.ok(method.includes('throw const AiSecureStorageException()'));
  assert.ok(method.indexOf('await _secureStorage.write') < method.lastIndexOf('_cachedUserKey ='));
  assert.ok(!method.includes('Ignore platform write errors'));
  assert.ok(dialog.includes('on AiSecureStorageException'));
});
