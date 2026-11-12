import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Hybrid AI AI-2c: the app side of the AI-2 consent and the AI-2b assistant
// turn. Values the app and the server must agree on are compared here, so a
// change on one side cannot ship without the other.

const read = (path) => readFileSync(path, 'utf8');
const mobile = 'mobile-app/mobile/lib/';
const settingsClient = read(mobile + 'features/ai/data/ai_settings_client.dart');
const contextPreference = read(mobile + 'features/ai/data/ai_context_preference.dart');
const transport = read(mobile + 'features/ai/data/ai_transport.dart');
const screen = read(mobile + 'features/ai/presentation/ai_assistant_screen.dart');
const profile = read(mobile + 'features/auth/presentation/profile_screen.dart');
const serverSettings = read('backend/src/features/ai-settings/ai-settings.types.ts');
const contextBuilder = read('backend/src/features/ai/application/ai-context-builder.ts');

const dartStrings = (source) => [...source.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

test('AI-2c: the app records the consent version the server requires', () => {
  const app = settingsClient.match(/const int aiEgressConsentVersion = (\d+);/);
  const server = serverSettings.match(/export const AI_EGRESS_CONSENT_VERSION = (\d+);/);
  assert.ok(app && server, 'both consent versions must be declared');
  assert.equal(app[1], server[1], 'bump the app and server consent versions (and the text) together');
});

test('AI-2c: the app asks only for scopes the server knows', () => {
  const app = contextPreference.match(/const List<String> aiContextScopes = \[([^\]]*)\]/);
  const server = contextBuilder.match(/export const AI_CONTEXT_SCOPES = \[([^\]]*)\] as const;/);
  assert.ok(app && server, 'both scope lists must be declared');
  assert.deepEqual(dartStrings(app[1]), dartStrings(server[1]));
  for (const forbidden of ['notes', 'money', 'wallet', 'location', 'description']) {
    assert.doesNotMatch(app[1], new RegExp(forbidden), `${forbidden} must never be a context scope`);
  }
});

test('AI-2c: the assistant uses the turn endpoint and the stored consent', () => {
  assert.match(transport, /'ai\/assistant\/turn\/stream'/);
  assert.match(transport, /'unsupported_or_denied'/);
  for (const reason of ['consent_required', 'scope_unavailable', 'unsupported']) {
    assert.match(transport, new RegExp(`'${reason}'`), `${reason} must be handled`);
  }
  assert.match(screen, /streamAssistantTurn\(/);
  assert.match(screen, /aiSettingsClientProvider/);
  assert.match(screen, /grantConsent\(\)/);
  assert.match(screen, /aiConsentRevisionProvider/);
  // App data is off until the user turns it on, after an explanation.
  assert.match(screen, /bool _useAppData = false;/);
  assert.match(screen, /l10n\.aiContextDialogBody/);
  assert.match(contextPreference, /\?\? false;/);
});

test('AI-2c: a failed reply is never kept, not even in part', () => {
  assert.doesNotMatch(screen, /buffer\.isEmpty && placeholderIndex/);
  assert.match(screen, /_messages\.removeAt\(placeholderIndex\)/);
});

test('AI-2c: Profile can withdraw the stored consent', () => {
  assert.match(settingsClient, /'egressConsentVersion': null/);
  assert.match(profile, /withdrawConsent\(\)/);
  assert.match(profile, /aiConsentRevisionProvider\.notifier/);
  assert.match(profile, /l10n\.aiConsentWithdrawBody/);
});
