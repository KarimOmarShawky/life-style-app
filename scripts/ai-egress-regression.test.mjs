import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync('mobile-app/mobile/lib/features/ai/data/ai_service.dart', 'utf8');
const transport = readFileSync('mobile-app/mobile/lib/features/ai/data/ai_transport.dart', 'utf8');
const apiClient = readFileSync('mobile-app/mobile/lib/data/api_client.dart', 'utf8');
const screen = readFileSync('mobile-app/mobile/lib/features/ai/presentation/ai_assistant_screen.dart', 'utf8');
const localizations = readFileSync('mobile-app/mobile/lib/l10n/app_localizations.dart', 'utf8');

test('streaming goes through the backend SSE proxy, never to the provider', () => {
  assert.match(transport, /'ai\/chat\/stream'/);
  assert.match(transport, /postEventStream/);
  assert.match(apiClient, /Stream<String> postEventStream\(/);
  assert.doesNotMatch(transport, /streamGenerateContent/);
  assert.doesNotMatch(service, /streamGenerateContent/);
});

test('unsupported speech output is removed rather than offered as a broken feature', () => {
  assert.doesNotMatch(service, /synthesizeSpeech|Future<List<int>> speakText/);
  assert.doesNotMatch(screen, /_speakLastResponse|AudioPlayer|aiSpeakTooltip/);
});

test('AI egress consent is available in all six catalogues', () => {
  for (const locale of ['en', 'ar', 'fr', 'es', 'de', 'tr']) {
    const catalogue = readFileSync(`mobile-app/mobile/lib/l10n/catalog_${locale}.dart`, 'utf8');
    for (const key of ['aiEgressTitle', 'aiEgressDescription', 'aiEgressAgree']) {
      assert.match(catalogue, new RegExp(`['"]${key}['"]\\s*:`), `${locale} missing ${key}`);
      assert.match(localizations, new RegExp(`get ${key}\\b`));
      assert.match(screen, new RegExp(`l10n\\.${key}\\b`));
    }
  }
});

test('stream updates do not rely on an object replaced by the first chunk', () => {
  assert.doesNotMatch(screen, /lastIndexOf\(placeholder\)/);
});

test('the chat screen offers no provider-key entry point', () => {
  assert.doesNotMatch(screen, /gemini_key_dialog|showGeminiApiKeyDialog|key_outlined/);
});
