/**
 * scripts/ai-proxy-contract.test.mjs
 *
 * Pins the server-proxy AI architecture that replaced BYOK:
 *  - the backend owns the only Gemini egress (central key, auth, quotas,
 *    kill switch) and never logs prompts or replies;
 *  - the mobile app ships no provider key, no key UI and no direct
 *    provider calls;
 *  - the transport contract between the two sides stays aligned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

const backendRoutes = read('backend/src/features/ai/ai.routes.ts');
const backendService = read('backend/src/features/ai/ai.service.ts');
const backendClient = read('backend/src/features/ai/gemini-client.ts');
const env = read('backend/src/config/env.ts');
const app = read('backend/src/app.ts');

const mobileService = read('mobile-app/mobile/lib/features/ai/data/ai_service.dart');
const mobileTransport = read('mobile-app/mobile/lib/features/ai/data/ai_transport.dart');
const smartParser = read('mobile-app/mobile/lib/data/smart_task_parser.dart');
const appConfig = read('mobile-app/mobile/lib/config/app_config.dart');

test('backend exposes authenticated chat and streaming proxy routes', () => {
  assert.match(app, /'\/ai'/);
  assert.match(backendRoutes, /router\.post\('\/chat', controller\.chat\)/);
  assert.match(backendRoutes, /router\.post\('\/chat\/stream', controller\.chatStream\)/);
  assert.match(backendRoutes, /options\.authenticate/);
});

test('backend fails closed when AI is disabled, before consuming quota', () => {
  assert.match(backendRoutes, /aiEnabledGuard/);
  assert.match(backendRoutes, /AI_DISABLED/);
  assert.match(backendService, /isEnabled\(\)/);
  // Guard runs before both quota middlewares.
  const order = backendRoutes.indexOf('aiEnabledGuard, minuteQuota, dailyQuota');
  assert.notEqual(order, -1);
});

test('backend enforces per-user minute and daily quotas', () => {
  assert.match(backendRoutes, /ai-minute:\$\{req\.user\?\.id/);
  assert.match(backendRoutes, /ai-day:\$\{req\.user\?\.id/);
  assert.match(backendRoutes, /windowSeconds: 24 \* 60 \* 60/);
  assert.match(backendRoutes, /degradedPolicy: 'bounded-fallback'/);
});

test('backend validates and size-limits requests before provider work', () => {
  assert.match(backendService, /validateAiChatBody/);
  assert.match(backendService, /maxMessages/);
  assert.match(backendService, /maxMessageChars/);
  assert.match(backendService, /maxTotalChars/);
});

test('the central key is server-only and never logged with content', () => {
  assert.match(env, /GEMINI_API_KEY/);
  assert.match(env, /AI_ENABLED/);
  assert.match(backendClient, /'X-goog-api-key': this\.options\.apiKey/);
  assert.doesNotMatch(backendService, /logger\.(info|warn|error|debug)\([^)]*text/);
  assert.doesNotMatch(backendClient, /logger/);
});

test('backend transport cannot leak reply text through error logs', () => {
  assert.doesNotMatch(backendClient, /errorMessage/);
  assert.match(backendClient, /'provider_rate_limited'/);
  assert.match(backendService, /'AI_PROVIDER_ERROR'/);
});

test('mobile holds no provider key and no key UI', () => {
  for (const [name, source] of [
    ['ai_service.dart', mobileService],
    ['ai_transport.dart', mobileTransport],
    ['smart_task_parser.dart', smartParser],
    ['app_config.dart', appConfig]
  ]) {
    assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/, name);
    assert.doesNotMatch(source, /X-goog-api-key/, name);
    assert.doesNotMatch(source, /geminiApiKey/, name);
  }
  assert.equal(
    existsSync('mobile-app/mobile/lib/features/ai/presentation/gemini_key_dialog.dart'),
    false
  );
});

test('both sides agree on the proxy wire contract', () => {
  assert.match(mobileTransport, /'ai\/chat'/);
  assert.match(mobileTransport, /'ai\/chat\/stream'/);
  assert.match(mobileTransport, /'messages'/);
  assert.match(mobileTransport, /'language'/);
  assert.match(mobileTransport, /'mode'/);
  assert.match(backendService, /SYSTEM_PROMPT/);
  assert.match(backendService, /LifeStyle AI Assistant/);
});

test('smart task parsing goes through the proxy with a local fallback', () => {
  assert.match(smartParser, /AiService\.instance\.sendMessage/);
  assert.match(smartParser, /replyProviderForTesting/);
  assert.match(smartParser, /return parse\(trimmed, current\)/);
});
