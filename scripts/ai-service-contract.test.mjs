/**
 * scripts/ai-service-contract.test.mjs
 *
 * AUD-21 (enhancement): pins the AI service surface so the context-aware
 * and analysis methods cannot be silently removed or renamed.
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

test('AUD-21: AI service exposes the core chat and briefing methods', () => {
  assert.match(aiService, /Future<String> sendMessage\(/);
  assert.match(aiService, /Future<String> generateDailyBriefing\(/);
  assert.match(aiService, /Future<String\?> generateWeeklyCoaching\(/);
  assert.match(aiService, /Stream<String> streamMessage\(/);
});

test('AUD-21: AI service exposes context-aware and analysis methods', () => {
  assert.match(aiService, /Future<String> sendMessageWithContext\(/);
  assert.match(aiService, /required Map<String, dynamic> context/);
  assert.match(aiService, /Future<String\?> analyzeTasks\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> tasks/);
  assert.match(aiService, /Future<String\?> getHabitInsights\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> habits/);
  assert.match(aiService, /Future<String\?> planGoal\(/);
  assert.match(aiService, /required String goalTitle/);
  assert.match(aiService, /required String goalDescription/);
  assert.match(aiService, /Future<String\?> summarizeNote\(/);
  assert.match(aiService, /required String noteContent/);
  assert.match(aiService, /Future<String> answerWithData\(/);
  assert.match(aiService, /required String question/);
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

test('AUD-21: AI service exposes the advanced analysis and planning methods', () => {
  assert.doesNotMatch(aiService, /Future<String\?> getMoneyInsights\(/);
  assert.match(aiService, /Future<String\?> getHabitCoaching\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> habits/);
  assert.match(aiService, /required Map<String, dynamic> aggregates/);
  assert.match(aiService, /Future<String\?> suggestSchedule\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> tasks/);
  assert.match(aiService, /Future<String\?> generateWorkoutPlan\(/);
  assert.match(aiService, /required String fitnessLevel/);
  assert.match(aiService, /required List<String> equipment/);
  assert.match(aiService, /required String goal/);
  assert.match(aiService, /Future<String\?> generateMealPlan\(/);
  assert.match(aiService, /required String dietaryPreference/);
  assert.match(aiService, /required int dailyBudget/);
  assert.match(aiService, /required List<String> allergies/);
  assert.match(aiService, /Future<String\?> getProductivityAnalysis\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> recentActivity/);
  assert.match(aiService, /Future<String\?> generateWeeklyReview\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> highlights/);
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
  assert.match(aiService, /Future<String\?> analyzeProductivityTrends\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> dailyStats/);
  assert.match(aiService, /required Map<String, dynamic> preferences/);
  assert.match(aiService, /Future<String\?> generateWeeklyComparison\(/);
  assert.match(aiService, /required Map<String, dynamic> thisWeek/);
  assert.match(aiService, /required Map<String, dynamic> lastWeek/);
  assert.match(aiService, /Future<String\?> getLifeBalanceScore\(/);
  assert.match(aiService, /required Map<String, dynamic> categoryScores/);
  assert.match(aiService, /required Map<String, dynamic> weights/);
});

test('AUD-21: AI service language handling covers Arabic and English', () => {
  assert.match(aiService, /isArabic = languageName == 'Arabic'/);
  assert.match(aiService, /تم إيقاف طلبات الذكاء الاصطناعي مؤقتاً/);
  assert.match(aiService, /AI requests are temporarily paused/);
});
