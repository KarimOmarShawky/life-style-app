/**
 * scripts/ai-service-contract.test.mjs
 *
 * AUD-21 (enhancement): pins the AI service surface so the methods the app
 * uses cannot be silently removed or renamed.
 *
 * Hybrid AI D6 (AI-1, owner decision 2026-11-12): the 16 prompt methods no
 * screen called were deleted (dead egress surface, including the
 * health-adjacent workout and meal plans). They must stay deleted.
 *
 * Architecture update (AI server proxy): the service no longer talks to
 * Gemini directly and no longer stores a user key (BYOK retired). All
 * traffic goes to the authenticated backend proxy, which holds the central
 * key server-side. The contract therefore pins BOTH the preserved public
 * surface AND the absence of any provider egress or key handling in the
 * mobile app.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

const mobile = 'mobile-app/mobile/lib/';
const aiService = readFileSync(mobile + 'features/ai/data/ai_service.dart', 'utf8');
const aiTransport = readFileSync(mobile + 'features/ai/data/ai_transport.dart', 'utf8');

test('AUD-21: AI service keeps the chat, coaching and streaming methods the app uses', () => {
  assert.match(aiService, /Future<String> sendMessage\(/);
  assert.match(aiService, /Future<String\?> generateWeeklyCoaching\(/);
  assert.match(aiService, /Stream<String> streamMessage\(/);
});

test('D6: the unreachable prompt methods stay deleted', () => {
  for (const removed of [
    'generateDailyBriefing',
    'sendMessageWithContext',
    'analyzeTasks',
    'getHabitInsights',
    'planGoal',
    'summarizeNote',
    'answerWithData',
    'getHabitCoaching',
    'suggestSchedule',
    'generateWorkoutPlan',
    'generateMealPlan',
    'getProductivityAnalysis',
    'generateWeeklyReview',
    'analyzeProductivityTrends',
    'generateWeeklyComparison',
    'getLifeBalanceScore',
    'getMoneyInsights'
  ]) {
    assert.doesNotMatch(aiService, new RegExp(`\\b${removed}\\(`), `${removed} must stay deleted`);
  }
  assert.doesNotMatch(aiService, /fitnessLevel|dietaryPreference|allergies/);
});

test('AUD-21: circuit breaker pauses after repeated failures', () => {
  assert.match(aiService, /static const int maxConsecutiveFailures = 3/);
  assert.match(aiService, /bool get isPaused/);
  assert.match(aiService, /void resetFailureCount\(\)/);
  assert.match(aiService, /_consecutiveFailures\+\+/);
  assert.match(aiService, /_consecutiveFailures = 0/);
});

test('AUD-21: BYOK key handling is retired from the mobile app', () => {
  for (const retired of [
    'getUserApiKey',
    'hasUserApiKey',
    'setUserApiKey',
    'getEffectiveApiKey',
    'FlutterSecureStorage',
    '_byokStorageKey'
  ]) {
    assert.doesNotMatch(aiService, new RegExp(retired), `ai_service must not contain ${retired}`);
  }
  assert.equal(
    existsSync(mobile + 'features/ai/presentation/gemini_key_dialog.dart'),
    false,
    'the BYOK key dialog must stay deleted'
  );
});

test('AUD-21: no provider egress or provider key anywhere in the AI feature', () => {
  for (const [name, source] of [
    ['ai_service.dart', aiService],
    ['ai_transport.dart', aiTransport]
  ]) {
    assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/, `${name} must not call Gemini directly`);
    assert.doesNotMatch(source, /X-goog-api-key/, `${name} must not send a provider key`);
    assert.doesNotMatch(source, /GEMINI_API_KEY|geminiApiKey/, `${name} must not reference a provider key`);
  }
});

test('AUD-21: the service delegates to the backend proxy transport', () => {
  assert.match(aiTransport, /class BackendAiTransport/);
  assert.match(aiTransport, /'ai\/chat'/);
  assert.match(aiTransport, /'ai\/chat\/stream'/);
  assert.match(aiService, /AiTransport/);
  assert.match(aiService, /bindGateway/);
});

test('AI chat streams through the authenticated backend SSE endpoint', () => {
  const stream = aiService.slice(
    aiService.indexOf('Stream<String> streamMessage('),
    aiService.indexOf('/// Generates a cumulative lifestyle analysis')
  );
  assert.match(stream, /chatStream\(/);
  assert.doesNotMatch(aiService, /synthesizeSpeech|Future<List<int>> speakText/);
});

test('AUD-21: AI service exposes cumulative analysis and performance dashboard methods', () => {
  assert.match(aiService, /Future<String\?> getCumulativeAnalysis\(/);
  assert.match(aiService, /required Map<String, dynamic> aggregates/);
  assert.match(aiService, /required List<Map<String, dynamic>> weeklyTrends/);
  assert.match(aiService, /required String timeRange/);
  assert.match(aiService, /Future<String\?> getPerformanceDashboard\(/);
  assert.match(aiService, /required Map<String, dynamic> metrics/);
  assert.match(aiService, /required Map<String, dynamic> streaks/);
  assert.match(aiService, /required Map<String, dynamic> highlights/);
});

test('AUD-21: AI service language handling covers Arabic and English', () => {
  assert.match(aiService, /isArabic = languageName == 'Arabic'/);
  assert.match(aiService, /تم إيقاف طلبات الذكاء الاصطناعي مؤقتاً/);
  assert.match(aiService, /AI requests are temporarily paused/);
});
