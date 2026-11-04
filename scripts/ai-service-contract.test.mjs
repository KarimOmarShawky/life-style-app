/**
 * scripts/ai-service-contract.test.mjs
 *
 * AUD-21 (enhancement): pins the AI service surface so the new context-aware
 * and analysis methods cannot be silently removed or renamed. The service
 * communicates directly with the Gemini API (BYOK), so the contract is
 * source-level: every public method must exist with its expected signature.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const aiService = readFileSync(
  'mobile-app/mobile/lib/features/ai/data/ai_service.dart',
  'utf8'
);

test('AUD-21: AI service exposes the core chat and briefing methods', () => {
  assert.match(aiService, /Future<String> sendMessage\(/);
  assert.match(aiService, /Future<String> generateDailyBriefing\(/);
  assert.match(aiService, /Future<String\?> generateWeeklyCoaching\(/);
  assert.match(aiService, /Future<String> getUserApiKey\(/);
  assert.match(aiService, /Future<bool> hasUserApiKey\(/);
  assert.match(aiService, /Future<void> setUserApiKey\(/);
  assert.match(aiService, /Future<String> getEffectiveApiKey\(/);
});

test('AUD-21: AI service exposes context-aware and analysis methods', () => {
  // Context-aware chat that injects user life state.
  assert.match(aiService, /Future<String> sendMessageWithContext\(/);
  assert.match(aiService, /required Map<String, dynamic> context/);

  // Task analysis with prioritised plan.
  assert.match(aiService, /Future<String\?> analyzeTasks\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> tasks/);

  // Habit pattern insights.
  assert.match(aiService, /Future<String\?> getHabitInsights\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> habits/);

  // Goal breakdown into action steps.
  assert.match(aiService, /Future<String\?> planGoal\(/);
  assert.match(aiService, /required String goalTitle/);
  assert.match(aiService, /required String goalDescription/);

  // Note summarisation with action items.
  assert.match(aiService, /Future<String\?> summarizeNote\(/);
  assert.match(aiService, /required String noteContent/);

  // Data-grounded Q&A.
  assert.match(aiService, /Future<String> answerWithData\(/);
  assert.match(aiService, /required String question/);
});

test('AUD-21: AI service key management and failure handling are intact', () => {
  assert.match(aiService, /static const int maxConsecutiveFailures = 3/);
  assert.match(aiService, /bool get isKeyPaused/);
  assert.match(aiService, /void resetFailureCount\(\)/);
  assert.match(aiService, /_consecutiveFailures\+\+/);
  assert.match(aiService, /_consecutiveFailures = 0/);
});

test('AUD-21: AI service uses BYOK key resolution with release gating', () => {
  assert.match(aiService, /getUserApiKey/);
  assert.match(aiService, /getEffectiveApiKey/);
  assert.match(aiService, /AppConfig\.geminiApiKey/);
  assert.match(aiService, /_byokStorageKey/);
  assert.match(aiService, /FlutterSecureStorage/);
});

test('AUD-21: AI service exposes the advanced analysis and planning methods', () => {
  // Money insights from transaction history.
  assert.match(aiService, /Future<String\?> getMoneyInsights\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> transactions/);
  assert.match(aiService, /required String currency/);

  // Personalised habit coaching.
  assert.match(aiService, /Future<String\?> getHabitCoaching\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> habits/);
  assert.match(aiService, /required Map<String, dynamic> aggregates/);

  // Smart daily schedule.
  assert.match(aiService, /Future<String\?> suggestSchedule\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> tasks/);
  assert.match(aiService, /required List<Map<String, dynamic>> habits/);

  // Workout plan.
  assert.match(aiService, /Future<String\?> generateWorkoutPlan\(/);
  assert.match(aiService, /required String fitnessLevel/);
  assert.match(aiService, /required List<String> equipment/);
  assert.match(aiService, /required String goal/);

  // Meal plan.
  assert.match(aiService, /Future<String\?> generateMealPlan\(/);
  assert.match(aiService, /required String dietaryPreference/);
  assert.match(aiService, /required int dailyBudget/);
  assert.match(aiService, /required List<String> allergies/);

  // Productivity analysis.
  assert.match(aiService, /Future<String\?> getProductivityAnalysis\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> recentActivity/);

  // Weekly review.
  assert.match(aiService, /Future<String\?> generateWeeklyReview\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> highlights/);
});

test('AI chat streams from the SSE endpoint and does not expose fake speech', () => {
  const stream = aiService.slice(aiService.indexOf('Stream<String> streamMessage('), aiService.indexOf('/// Generates a cumulative lifestyle analysis'));
  assert.match(aiService, /:streamGenerateContent\?alt=sse/);
  assert.match(stream, /client\.send\(request\)/);
  assert.doesNotMatch(stream, /\.post\(/);
  assert.match(stream, /response\.stream/);
  assert.match(stream, /\[DONE\]/);
  assert.doesNotMatch(aiService, /synthesizeSpeech|Future<List<int>> speakText/);
});

test('AUD-21: AI service exposes cumulative analysis and performance dashboard methods', () => {
  // Cumulative lifestyle analysis across all features.
  assert.match(aiService, /Future<String\?> getCumulativeAnalysis\(/);
  assert.match(aiService, /required Map<String, dynamic> aggregates/);
  assert.match(aiService, /required List<Map<String, dynamic>> weeklyTrends/);
  assert.match(aiService, /required String timeRange/);

  // Personalised performance dashboard summary.
  assert.match(aiService, /Future<String\?> getPerformanceDashboard\(/);
  assert.match(aiService, /required Map<String, dynamic> metrics/);
  assert.match(aiService, /required Map<String, dynamic> streaks/);
  assert.match(aiService, /required Map<String, dynamic> highlights/);

  // Productivity trend analysis over time.
  assert.match(aiService, /Future<String\?> analyzeProductivityTrends\(/);
  assert.match(aiService, /required List<Map<String, dynamic>> dailyStats/);
  assert.match(aiService, /required Map<String, dynamic> preferences/);

  // Weekly comparison report.
  assert.match(aiService, /Future<String\?> generateWeeklyComparison\(/);
  assert.match(aiService, /required Map<String, dynamic> thisWeek/);
  assert.match(aiService, /required Map<String, dynamic> lastWeek/);

  // Personalised life balance score.
  assert.match(aiService, /Future<String\?> getLifeBalanceScore\(/);
  assert.match(aiService, /required Map<String, dynamic> categoryScores/);
  assert.match(aiService, /required Map<String, dynamic> weights/);
});

test('AUD-21: AI service language handling covers Arabic and English', () => {
  assert.match(aiService, /isArabic = languageName == 'Arabic'/);
  assert.match(aiService, /يرجى إضافة مفتاح Gemini/);
  assert.match(aiService, /Please add your personal Gemini API key/);
});
