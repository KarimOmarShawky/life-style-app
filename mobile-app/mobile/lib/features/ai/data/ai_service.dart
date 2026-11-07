import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:lifestyle_mobile/config/app_config.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

export 'package:lifestyle_mobile/features/ai/data/ai_transport.dart'
    show ChatMessage;

/// A backend or transport failure, separate from model-generated text.
class AiStreamingException implements Exception {
  const AiStreamingException(this.code);

  final String code;

  @override
  String toString() => 'AiStreamingException($code)';
}

/// Facade for every AI-powered feature (chat, briefing, coaching, analyses).
///
/// All traffic goes to the LifeStyle backend AI proxy, which holds the
/// central Gemini key server-side; the app no longer stores or sends a
/// provider key (BYOK retired). The circuit breaker below pauses requests
/// after repeated failures so a struggling backend is not hammered; any
/// successful call (or an explicit reset) clears it.
class AiService {
  AiService._([this._injectedTransport]);

  @visibleForTesting
  factory AiService.forTesting({AiTransport? transport}) =>
      AiService._(transport ?? const _UnavailableTransport());

  static final AiService instance = AiService._();

  /// Binds the app-wide backend gateway once at startup (core providers).
  /// Until bound, a lazily built gateway over the app's own session storage
  /// is used so feature code never has to thread clients through.
  static void bindGateway(AiBackendGateway gateway) {
    _boundGateway = gateway;
    // Drop any transport built over a previous gateway (e.g. a recreated
    // ApiClient after provider disposal) so the new binding takes effect.
    instance._defaultTransport = null;
  }

  static AiBackendGateway? _boundGateway;

  final AiTransport? _injectedTransport;
  AiTransport? _defaultTransport;
  int _consecutiveFailures = 0;

  static const int maxConsecutiveFailures = 3;

  AiTransport get _transport {
    final injected = _injectedTransport;
    if (injected != null) return injected;
    final existing = _defaultTransport;
    if (existing != null) return existing;
    final gateway = _boundGateway ??
        ApiClientAiGateway(
          ApiClient(
            baseUri: AppConfig.apiBaseUri,
            tokenStore: SecureTokenStore(),
          ),
        );
    return _defaultTransport = BackendAiTransport(gateway);
  }

  bool get isPaused => _consecutiveFailures >= maxConsecutiveFailures;

  void resetFailureCount() {
    _consecutiveFailures = 0;
  }

  /// The weekly coach accepts numbers only, with a fixed allowlist of names.
  /// Callers must obtain fresh consent before each request. No conversation
  /// history, note, task title, notification or package is accepted here.
  Future<String?> generateWeeklyCoaching({
    required Map<String, num> aggregates,
    String languageName = 'English',
  }) async {
    const allowed = {
      'tasksCompleted',
      'tasksPending',
      'habitConsistencyPercent',
      'activeStreaks',
      'focusMinutes',
      'focusSessions',
      'blockedAttempts',
      'averageClarity'
    };
    if (isPaused) return null;
    final numbers = <String, num>{
      for (final entry in aggregates.entries)
        if (allowed.contains(entry.key) && entry.value.isFinite)
          entry.key: entry.value
    };
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a practical seven-day productivity coaching plan from these aggregated numbers only. Missing metrics are unavailable. Do not infer personal details.\n${jsonEncode(numbers)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded ? result : null;
  }

  Future<String> sendMessage({
    required List<ChatMessage> conversationHistory,
    required String newMessage,
    String languageName = 'Arabic',
    Duration timeout = const Duration(seconds: 30),
    void Function(bool succeeded)? onOutcome,
  }) async {
    onOutcome?.call(false);
    final bool isArabic = languageName == 'Arabic';
    if (isPaused) {
      return isArabic
          ? 'تم إيقاف طلبات الذكاء الاصطناعي مؤقتاً بعد عدة محاولات فاشلة. يرجى المحاولة مرة أخرى بعد قليل.'
          : 'AI requests are temporarily paused after repeated failures. Please try again shortly.';
    }
    try {
      final reply = await _transport.chat(
        history: conversationHistory,
        message: newMessage,
        languageName: languageName,
        mode: AiReplyMode.chat,
        timeout: timeout,
      );
      _consecutiveFailures = 0;
      onOutcome?.call(true);
      return reply;
    } on AiTransportException catch (error) {
      if (error.code != 'unauthenticated') _consecutiveFailures++;
      return _failureText(isArabic, error.code);
    } on Object {
      _consecutiveFailures++;
      return _failureText(isArabic, 'unavailable');
    }
  }

  String _failureText(bool isArabic, String code) {
    switch (code) {
      case 'quota_exceeded':
        return isArabic
            ? 'وصلت إلى حد استخدام الذكاء الاصطناعي المسموح به حالياً. يرجى المحاولة مرة أخرى لاحقاً.'
            : 'You have reached the current AI usage limit. Please try again later.';
      case 'network':
        return isArabic
            ? 'تعذر الاتصال بالذكاء الاصطناعي. يرجى التحقق من اتصال الإنترنت.'
            : 'Could not connect to AI. Please check your internet connection.';
      default:
        return isArabic
            ? 'عذراً، لم أتمكن من معالجة الطلب حالياً. يرجى المحاولة بعد لحظات.'
            : 'Sorry, I could not process your request right now. Please try again shortly.';
    }
  }

  Future<String> generateDailyBriefing({
    required String userName,
    required int pendingTasksCount,
    required int completedHabitsCount,
    required int totalHabitsCount,
    String languageName = 'Arabic',
  }) async {
    final bool isArabic = languageName == 'Arabic';
    final hour = DateTime.now().hour;
    final isMorning = hour < 14;

    String localFallback() {
      if (isArabic) {
        return isMorning
            ? 'صباح الخير $userName! لديك اليوم $pendingTasksCount مهام بانتظار الإنجاز. يومك موفق!'
            : 'مساء الخير $userName! أتممت $completedHabitsCount من $totalHabitsCount عادات حتى الآن. استمر!';
      }
      return isMorning
          ? 'Good morning $userName! You have $pendingTasksCount tasks waiting today. Have a productive day!'
          : 'Good evening $userName! You completed $completedHabitsCount of $totalHabitsCount habits today. Keep it up!';
    }

    if (isPaused) return localFallback();

    try {
      final prompt = '''
Write a short, inspiring, 2-sentence ${isMorning ? "morning briefing" : "evening reflection"} for user named "$userName".
Details:
- Pending tasks for today: $pendingTasksCount
- Completed habits today: $completedHabitsCount out of $totalHabitsCount
Language: $languageName. Friendly, clear, and inspiring.
Constraint: Exactly 2 sentences. No emojis. Very motivating and energetic.
''';
      final reply = await _transport.chat(
        history: const [],
        message: prompt,
        languageName: languageName,
        mode: AiReplyMode.brief,
        timeout: const Duration(seconds: 8),
      );
      _consecutiveFailures = 0;
      return reply;
    } on Object {
      return localFallback();
    }
  }

  /// Context-aware chat that injects the user's current life state into the
  /// conversation. The model receives structured context (pending tasks,
  /// habits and goals) so replies are personalised, not generic.
  Future<String> sendMessageWithContext({
    required List<ChatMessage> conversationHistory,
    required String newMessage,
    required Map<String, dynamic> context,
    String languageName = 'Arabic',
    Duration timeout = const Duration(seconds: 30),
    void Function(bool succeeded)? onOutcome,
  }) async {
    final contextJson = jsonEncode(context);
    final augmentedMessage =
        "Here is the user's current life context (JSON):\n$contextJson\n\nUse this context to give personalised, specific advice. Do not invent data that is not in the context.\n\nUser request: $newMessage";
    return sendMessage(
      conversationHistory: conversationHistory,
      newMessage: augmentedMessage,
      languageName: languageName,
      timeout: timeout,
      onOutcome: onOutcome,
    );
  }

  /// Analyses a set of tasks and returns a prioritised, grouped plan with
  /// time estimates and suggested focus order.
  Future<String?> analyzeTasks({
    required List<Map<String, dynamic>> tasks,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Analyse these tasks and produce a prioritised plan. For each task, rate urgency (high/medium/low), suggest a time slot, and explain the reasoning. Group them into "Do first", "Do later", and "Delegate or drop".\n\nTasks (JSON): ${jsonEncode(tasks)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Analyses habit patterns and returns insights with concrete suggestions
  /// for improvement.
  Future<String?> getHabitInsights({
    required List<Map<String, dynamic>> habits,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Analyse these habits and produce a weekly insight report. Identify the strongest habit, the weakest, and give one concrete, actionable suggestion for each. Keep it concise.\n\nHabits (JSON): ${jsonEncode(habits)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Breaks a goal down into concrete, time-bound action steps.
  Future<String?> planGoal({
    required String goalTitle,
    required String goalDescription,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Break down this goal into a concrete 30-day action plan. List weekly milestones, daily actions, and the key metric to track progress.\n\nGoal: $goalTitle\nDescription: $goalDescription',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Summarises a note and extracts action items, deadlines, and key points.
  Future<String?> summarizeNote({
    required String noteContent,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Summarise this note in 3 bullet points. Then list any action items (with suggested deadlines) and any key decisions made.\n\nNote content:\n$noteContent',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Answers a question using the user's own data (tasks, notes, habits,
  /// goals). Falls back to generic advice when no data is provided.
  Future<String> answerWithData({
    required String question,
    Map<String, dynamic> data = const {},
    String languageName = 'Arabic',
  }) async {
    if (data.isEmpty) {
      return sendMessage(
        conversationHistory: const [],
        newMessage: question,
        languageName: languageName,
      );
    }
    return sendMessageWithContext(
      conversationHistory: const [],
      newMessage: question,
      context: data,
      languageName: languageName,
    );
  }

  /// Generates a personalised habit coaching plan based on the user's
  /// habit history and current streaks.
  Future<String?> getHabitCoaching({
    required List<Map<String, dynamic>> habits,
    required Map<String, dynamic> aggregates,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a personalised habit coaching plan. Identify the most promising habit to build next, suggest a realistic weekly target, and explain the reasoning.\n\nHabits (JSON): ${jsonEncode(habits)}\nAggregates (JSON): ${jsonEncode(aggregates)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Suggests a smart schedule for the day based on pending tasks,
  /// habits, and the user's focus preferences.
  Future<String?> suggestSchedule({
    required List<Map<String, dynamic>> tasks,
    required List<Map<String, dynamic>> habits,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a time-blocked schedule for today. Assign time slots to each task and habit, group similar tasks together, and include breaks.\n\nTasks (JSON): ${jsonEncode(tasks)}\nHabits (JSON): ${jsonEncode(habits)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Generates a weekly workout plan based on the user's goals,
  /// current fitness level, and available equipment.
  Future<String?> generateWorkoutPlan({
    required String fitnessLevel,
    required List<String> equipment,
    required String goal,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a 7-day workout plan. Include warm-ups, main exercises, sets/reps, and rest days.\n\nFitness level: $fitnessLevel\nEquipment: ${jsonEncode(equipment)}\nGoal: $goal',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Generates a meal plan based on dietary preferences, budget,
  /// and nutritional goals.
  Future<String?> generateMealPlan({
    required String dietaryPreference,
    required int dailyBudget,
    required List<String> allergies,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a 3-day meal plan. Include breakfast, lunch, dinner, and snacks. Keep within the daily budget and avoid allergens.\n\nDietary preference: $dietaryPreference\nDaily budget: $dailyBudget\nAllergies: ${jsonEncode(allergies)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Analyses productivity patterns and returns personalised
  /// improvement suggestions.
  Future<String?> getProductivityAnalysis({
    required Map<String, dynamic> aggregates,
    required List<Map<String, dynamic>> recentActivity,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Analyse my productivity patterns and give 3 personalised suggestions for improvement. Focus on time management, focus habits, and energy management.\n\nAggregates (JSON): ${jsonEncode(aggregates)}\nRecent activity (JSON): ${jsonEncode(recentActivity)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Generates a weekly review summary from the user's completed
  /// tasks, habits, and achievements.
  Future<String?> generateWeeklyReview({
    required Map<String, dynamic> aggregates,
    required List<Map<String, dynamic>> highlights,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a motivational weekly review. Highlight achievements, suggest one area to improve, and set one goal for next week.\n\nAggregates (JSON): ${jsonEncode(aggregates)}\nHighlights (JSON): ${jsonEncode(highlights)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Streams model text as backend SSE events arrive. Failures use the
  /// error channel; partial text is never presented as a completed reply
  /// by callers (the chat screen discards the buffer on error).
  Stream<String> streamMessage({
    required List<ChatMessage> conversationHistory,
    required String newMessage,
    String languageName = 'Arabic',
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    if (isPaused) throw const AiStreamingException('paused');
    var sawText = false;
    try {
      await for (final chunk in _transport.chatStream(
        history: conversationHistory,
        message: newMessage,
        languageName: languageName,
        timeout: timeout,
      )) {
        sawText = true;
        yield chunk;
      }
    } on AiTransportException catch (error) {
      if (error.code != 'unauthenticated') _consecutiveFailures++;
      throw AiStreamingException(error.code);
    } on Object {
      _consecutiveFailures++;
      throw const AiStreamingException('stream_failed');
    }
    if (!sawText) {
      _consecutiveFailures++;
      throw const AiStreamingException('empty_response');
    }
    _consecutiveFailures = 0;
  }

  /// Generates a cumulative lifestyle analysis across all features
  /// (tasks, habits, goals, money, productivity) for a given time range.
  Future<String?> getCumulativeAnalysis({
    required Map<String, dynamic> aggregates,
    required List<Map<String, dynamic>> weeklyTrends,
    required String timeRange,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Generate a comprehensive cumulative lifestyle analysis for the period: $timeRange. Cover task completion rates, habit consistency, goal progress and overall productivity. Identify the top 3 strengths and 3 areas needing improvement. Provide actionable recommendations. Metrics that are absent are unavailable; do not invent numbers.\n\nAggregates (JSON): ${jsonEncode(aggregates)}\nWeekly trends (JSON): ${jsonEncode(weeklyTrends)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    // sendMessage returns localized fallback text on backend failure;
    // that text must never be presented as an analysis.
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Creates a personalised performance dashboard summary that
  /// highlights key metrics and trends for the user.
  Future<String?> getPerformanceDashboard({
    required Map<String, dynamic> metrics,
    required Map<String, dynamic> streaks,
    required Map<String, dynamic> highlights,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a performance dashboard summary. Highlight the most important metrics, streaks to celebrate, and one key focus area for next week. Keep it concise and motivational. Metrics that are absent are unavailable; do not invent numbers.\n\nMetrics (JSON): ${jsonEncode(metrics)}\nStreaks (JSON): ${jsonEncode(streaks)}\nHighlights (JSON): ${jsonEncode(highlights)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Analyses productivity patterns over time and identifies
  /// peak performance windows.
  Future<String?> analyzeProductivityTrends({
    required List<Map<String, dynamic>> dailyStats,
    required Map<String, dynamic> preferences,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Analyse these daily productivity stats and identify patterns. Determine the user peak performance windows, flag declining trends, and suggest adjustments.\n\nDaily stats (JSON): ${jsonEncode(dailyStats)}\nPreferences (JSON): ${jsonEncode(preferences)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Generates a personalised weekly comparison report showing
  /// improvements or declines across all lifestyle categories.
  Future<String?> generateWeeklyComparison({
    required Map<String, dynamic> thisWeek,
    required Map<String, dynamic> lastWeek,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Compare this week performance with last week across tasks, habits and goals. Highlight improvements, declines, and one key takeaway.\n\nThis week (JSON): ${jsonEncode(thisWeek)}\nLast week (JSON): ${jsonEncode(lastWeek)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }

  /// Creates a personalised life balance score based on all
  /// lifestyle categories and suggests improvements.
  Future<String?> getLifeBalanceScore({
    required Map<String, dynamic> categoryScores,
    required Map<String, dynamic> weights,
    String languageName = 'Arabic',
  }) async {
    if (isPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Calculate a personalised life balance score from these category scores. Provide a 1-10 rating, explain the score, and suggest 2 concrete improvements for the weakest categories.\n\nCategory scores (JSON): ${jsonEncode(categoryScores)}\nWeights (JSON): ${jsonEncode(weights)}',
      languageName: languageName,
      onOutcome: (value) => succeeded = value,
    );
    return succeeded && result.isNotEmpty ? result : null;
  }
}

/// Default test transport: never performs egress and always reports the
/// assistant as unavailable, so widget/unit tests stay offline by default.
class _UnavailableTransport implements AiTransport {
  const _UnavailableTransport();

  @override
  Future<String> chat({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    throw const AiTransportException('unavailable');
  }

  @override
  Stream<String> chatStream({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    throw const AiTransportException('unavailable');
  }
}
