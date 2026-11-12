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
  AiService._([this._injectedTransport, DateTime Function()? clock])
      : _now = clock ?? DateTime.now;

  @visibleForTesting
  factory AiService.forTesting({
    AiTransport? transport,
    DateTime Function()? clock,
  }) =>
      AiService._(transport ?? const _UnavailableTransport(), clock);

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
  final DateTime Function() _now;
  AiTransport? _defaultTransport;
  int _consecutiveFailures = 0;
  DateTime? _lastFailureAt;

  static const int maxConsecutiveFailures = 3;

  /// AI1-F2: after [maxConsecutiveFailures] failures in a row, AI requests
  /// pause for this long. Then one request may try again: another failure
  /// pauses again, a success clears the count. Before, the pause lasted
  /// until the app was restarted.
  static const Duration pauseDuration = Duration(minutes: 10);

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

  bool get isPaused {
    final last = _lastFailureAt;
    if (_consecutiveFailures < maxConsecutiveFailures || last == null) {
      return false;
    }
    final elapsed = _now().difference(last);
    // A clock set backwards must not stretch the pause.
    return !elapsed.isNegative && elapsed < pauseDuration;
  }

  void resetFailureCount() {
    _consecutiveFailures = 0;
    _lastFailureAt = null;
  }

  void _recordFailure() {
    _consecutiveFailures++;
    _lastFailureAt = _now();
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
      if (error.code != 'unauthenticated') _recordFailure();
      return _failureText(isArabic, error.code);
    } on Object {
      _recordFailure();
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
      if (error.code != 'unauthenticated') _recordFailure();
      throw AiStreamingException(error.code);
    } on Object {
      _recordFailure();
      throw const AiStreamingException('stream_failed');
    }
    if (!sawText) {
      _recordFailure();
      throw const AiStreamingException('empty_response');
    }
    _consecutiveFailures = 0;
  }

  /// Codes that are answers rather than failures, so they never count toward
  /// the pause: an expired session and the assistant-turn denials (AI-2b).
  static const Set<String> _notFailures = {
    'unauthenticated',
    ...aiAssistantDenialCodes,
  };

  /// One assistant turn (Hybrid AI AI-2c) through
  /// `/ai/assistant/turn/stream`, with the app-data summary when
  /// [contextScopes] is not empty. Same pause and error rules as
  /// [streamMessage]. A denial is thrown as [AiStreamingException] with its
  /// reason (consent_required, scope_unavailable, unsupported) and does not
  /// count as a failure.
  Stream<String> streamAssistantTurn({
    required List<ChatMessage> conversationHistory,
    required String newMessage,
    required String clientLocale,
    String languageName = 'Arabic',
    List<String> contextScopes = const [],
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    if (isPaused) throw const AiStreamingException('paused');
    final source = switch (_transport) {
      final AiAssistantTurnTransport turns => turns.assistantTurnStream(
          history: conversationHistory,
          message: newMessage,
          clientLocale: clientLocale,
          languageName: languageName,
          contextScopes: contextScopes,
          timeout: timeout,
        ),
      final AiTransport other => other.chatStream(
          history: conversationHistory,
          message: newMessage,
          languageName: languageName,
          timeout: timeout,
        ),
    };
    var sawText = false;
    try {
      await for (final chunk in source) {
        sawText = true;
        yield chunk;
      }
    } on AiTransportException catch (error) {
      if (!_notFailures.contains(error.code)) _recordFailure();
      throw AiStreamingException(error.code);
    } on Object {
      _recordFailure();
      throw const AiStreamingException('stream_failed');
    }
    if (!sawText) {
      _recordFailure();
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
