import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:lifestyle_mobile/config/app_config.dart';

class ChatMessage {
  const ChatMessage({
    required this.role,
    required this.text,
    this.timestamp,
  });

  final String role; // 'user' or 'model'
  final String text;
  final DateTime? timestamp;
}

/// A provider or transport failure, separate from model-generated text.
class AiStreamingException implements Exception {
  const AiStreamingException(this.code);

  final String code;

  @override
  String toString() => 'AiStreamingException($code)';
}

List<String> _textFromSseEvent(String data) {
  final decoded = jsonDecode(data);
  if (decoded is! Map<String, dynamic> || decoded.containsKey('error')) {
    throw const AiStreamingException('invalid_event');
  }
  final candidates = decoded['candidates'];
  if (candidates is! List || candidates.isEmpty) return const [];
  final candidate = candidates.first;
  if (candidate is! Map<String, dynamic>) {
    throw const AiStreamingException('invalid_event');
  }
  final content = candidate['content'];
  if (content is! Map<String, dynamic>) return const [];
  final parts = content['parts'];
  if (parts is! List) return const [];
  final result = <String>[];
  for (final part in parts) {
    if (part is Map<String, dynamic> && part['text'] is String) {
      final text = part['text'] as String;
      if (text.isNotEmpty) result.add(text);
    }
  }
  return result;
}

/// Secure key operations failed; no secret or platform details are exposed.
class AiSecureStorageException implements Exception {
  const AiSecureStorageException();
}

class AiService {
  AiService._();
  @visibleForTesting
  AiService.forTesting();
  static final AiService instance = AiService._();

  static const String _model = 'gemini-3.5-flash-lite';
  static const String _baseUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/$_model:generateContent';
  static const String _streamUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/$_model:streamGenerateContent?alt=sse';
  static const String _byokStorageKey = 'lifestyle.byok.gemini_api_key.v1';
  static const int maxConsecutiveFailures = 3;

  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  String? _cachedUserKey;
  bool _loadedUserKey = false;
  int _consecutiveFailures = 0;
  int _keyGeneration = 0;
  Future<void> _keyWriteTail = Future<void>.value();

  bool get isKeyPaused => _consecutiveFailures >= maxConsecutiveFailures;

  void resetFailureCount() {
    _consecutiveFailures = 0;
  }

  /// Returns the user's personal BYOK Gemini API key stored in secure storage.
  Future<String> getUserApiKey() async {
    if (_loadedUserKey) return _cachedUserKey ?? '';
    final generation = _keyGeneration;
    final String? stored;
    try {
      stored = await _secureStorage.read(key: _byokStorageKey);
    } on Object {
      throw const AiSecureStorageException();
    }
    // Do not resurrect a key if sign-out or a new write started during read.
    if (generation != _keyGeneration) return _cachedUserKey ?? '';
    _cachedUserKey = stored?.trim();
    _loadedUserKey = true;
    return _cachedUserKey ?? '';
  }

  /// Returns true when the user has saved a personal BYOK Gemini API key.
  Future<bool> hasUserApiKey() async => (await getUserApiKey()).isNotEmpty;

  /// Saves or clears the user's personal BYOK Gemini API key in secure storage.
  /// Failures are reported, and stale in-flight writes never restore the cache.
  Future<void> setUserApiKey(String? apiKey) {
    final trimmed = apiKey?.trim() ?? '';
    final generation = ++_keyGeneration;
    _cachedUserKey = null;
    _loadedUserKey = true;
    _consecutiveFailures = 0;
    final result = _keyWriteTail.then((_) async {
      try {
        if (trimmed.isEmpty) {
          await _secureStorage.delete(key: _byokStorageKey);
        } else {
          await _secureStorage.write(key: _byokStorageKey, value: trimmed);
        }
      } on Object {
        throw const AiSecureStorageException();
      }
      if (generation == _keyGeneration) {
        _cachedUserKey = trimmed.isEmpty ? null : trimmed;
      }
    });
    _keyWriteTail = result.catchError((Object _) {});
    return result;
  }

  /// Resolves the active Gemini API key: user BYOK key first, then dev/test
  /// compile-time override (always empty in kReleaseMode).
  Future<String> getEffectiveApiKey() async {
    final userKey = await getUserApiKey();
    if (userKey.isNotEmpty) {
      return userKey;
    }
    return AppConfig.geminiApiKey.trim();
  }

  static const String _systemPrompt = '''
You are "LifeStyle AI Assistant", an intelligent, empathetic, and highly practical personal productivity coach and life organizer.
You help the user:
- Plan their day and structure their daily schedule with concrete time slots.
- Suggest healthy, sustainable habits and give motivational tips.
- Help them organize their thoughts, notes, and tasks efficiently.
- Answer questions with actionable, clear, bullet-pointed advice.
Language: Always reply in the same language as the user's latest request (Arabic, English, French, or any other language), even when the app interface uses a different language. Keep code, brand names, and numbers as the user wrote them.
Tone: Friendly, motivating, professional, concise, and focused on execution. Avoid fluff.
''';

  /// The weekly coach accepts numbers only, with a fixed allowlist of names.
  /// Callers must obtain fresh consent before each request. No conversation
  /// history, note, task title, notification or package is accepted here.
  Future<String?> generateWeeklyCoaching(
      {required Map<String, num> aggregates,
      String languageName = 'English',
      http.Client? httpClient}) async {
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
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
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
        httpClient: httpClient,
        onOutcome: (value) => succeeded = value);
    return succeeded ? result : null;
  }

  Future<String> sendMessage({
    required List<ChatMessage> conversationHistory,
    required String newMessage,
    String languageName = 'Arabic',
    Duration timeout = const Duration(seconds: 12),
    http.Client? httpClient,
    void Function(bool succeeded)? onOutcome,
  }) async {
    onOutcome?.call(false);
    final bool isArabic = languageName == 'Arabic';
    final key = await getEffectiveApiKey();
    if (key.isEmpty) {
      return isArabic
          ? 'يرجى إضافة مفتاح Gemini API الشخصي من أيقونة المفتاح أعلى الشاشة أو من الملف الشخصي لتفعيل المساعد الذكي.'
          : 'Please add your personal Gemini API key via the key icon above or in Profile settings to enable the AI Assistant.';
    }

    if (isKeyPaused) {
      return isArabic
          ? 'تم إيقاف طلبات الذكاء الاصطناعي مؤقتاً بعد عدة محاولات فاشلة. يرجى التحقق من صلاحية مفتاح Gemini API أو تحديثه.'
          : 'AI requests are temporarily paused after repeated provider errors. Please verify or update your Gemini API key.';
    }

    final client = httpClient ?? http.Client();
    try {
      final contents = <Map<String, dynamic>>[];

      for (final msg in conversationHistory) {
        contents.add({
          'role': msg.role == 'user' ? 'user' : 'model',
          'parts': [
            {'text': msg.text}
          ]
        });
      }

      contents.add({
        'role': 'user',
        'parts': [
          {
            'text':
                'System context: $_systemPrompt\nReply language: write the reply in the same language as the user request below. Use $languageName only if the request has no detectable language.\n\nUser request: $newMessage'
          }
        ]
      });

      final response = await client
          .post(
            Uri.parse(_baseUrl),
            headers: {
              'Content-Type': 'application/json',
              'X-goog-api-key': key,
            },
            body: jsonEncode({
              'generationConfig': {
                'temperature': 0.7,
                'maxOutputTokens': 800,
              },
              'contents': contents,
            }),
          )
          .timeout(timeout);

      if (response.statusCode == 200) {
        _consecutiveFailures = 0;
        final decoded = jsonDecode(response.body) as Map<String, dynamic>;
        final candidates = decoded['candidates'] as List<dynamic>?;
        if (candidates != null && candidates.isNotEmpty) {
          final first = candidates[0] as Map<String, dynamic>?;
          final content = first?['content'] as Map<String, dynamic>?;
          final parts = content?['parts'] as List<dynamic>?;
          if (parts != null && parts.isNotEmpty) {
            final firstPart = parts[0] as Map<String, dynamic>?;
            final text = firstPart?['text'] as String?;
            if (text != null && text.trim().isNotEmpty) {
              onOutcome?.call(true);
              return text.trim();
            }
          }
        }
      } else if (response.statusCode == 401 ||
          response.statusCode == 403 ||
          response.statusCode == 429 ||
          response.statusCode >= 500) {
        _consecutiveFailures++;
      }
      return isArabic
          ? 'عذراً، لم أتمكن من معالجة الطلب حالياً. يرجى المحاولة بعد لحظات.'
          : 'Sorry, I could not process your request right now. Please try again shortly.';
    } catch (_) {
      return isArabic
          ? 'تعذر الاتصال بالذكاء الاصطناعي. يرجى التحقق من اتصال الإنترنت.'
          : 'Could not connect to AI. Please check your internet connection.';
    } finally {
      if (httpClient == null) {
        client.close();
      }
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
    final key = await getEffectiveApiKey();
    final hour = DateTime.now().hour;
    final isMorning = hour < 14;

    if (key.isEmpty || isKeyPaused) {
      if (isArabic) {
        if (isMorning) {
          return 'صباح الخير $userName! لديك اليوم $pendingTasksCount مهام بانتظار الإنجاز. يومك موفق!';
        } else {
          return 'مساء الخير $userName! أتممت $completedHabitsCount من $totalHabitsCount عادات حتى الآن. استمر!';
        }
      } else {
        if (isMorning) {
          return 'Good morning $userName! You have $pendingTasksCount tasks waiting today. Have a productive day!';
        } else {
          return 'Good evening $userName! You completed $completedHabitsCount of $totalHabitsCount habits today. Keep it up!';
        }
      }
    }

    try {
      final prompt = '''
Write a short, inspiring, 2-sentence ${isMorning ? "morning briefing" : "evening reflection"} for user named "$userName".
Details:
- Pending tasks for today: $pendingTasksCount
- Completed habits today: $completedHabitsCount out of $totalHabitsCount
Language: $languageName. Friendly, clear, and inspiring.
Constraint: Exactly 2 sentences. No emojis. Very motivating and energetic.
''';

      final response = await http
          .post(
            Uri.parse(_baseUrl),
            headers: {
              'Content-Type': 'application/json',
              'X-goog-api-key': key,
            },
            body: jsonEncode({
              'generationConfig': {
                'temperature': 0.6,
                'maxOutputTokens': 150,
              },
              'contents': [
                {
                  'parts': [
                    {'text': prompt}
                  ]
                }
              ],
            }),
          )
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        _consecutiveFailures = 0;
        final decoded = jsonDecode(response.body) as Map<String, dynamic>;
        final candidates = decoded['candidates'] as List<dynamic>?;
        if (candidates != null && candidates.isNotEmpty) {
          final first = candidates[0] as Map<String, dynamic>?;
          final content = first?['content'] as Map<String, dynamic>?;
          final parts = content?['parts'] as List<dynamic>?;
          if (parts != null && parts.isNotEmpty) {
            final firstPart = parts[0] as Map<String, dynamic>?;
            final text = firstPart?['text'] as String?;
            if (text != null && text.trim().isNotEmpty) {
              return text.trim();
            }
          }
        }
      }
    } catch (_) {}

    if (isArabic) {
      return isMorning
          ? 'صباح الخير $userName! أمامك اليوم $pendingTasksCount مهام. ركّز على الأهم وابدأ بقوة.'
          : 'مساء الخير $userName! أتممت $completedHabitsCount من $totalHabitsCount عادات. بداية رائعة للأسبوع!';
    } else {
      return isMorning
          ? 'Good morning $userName! You have $pendingTasksCount tasks today. Focus on what matters most.'
          : 'Good evening $userName! You completed $completedHabitsCount of $totalHabitsCount habits. Great job!';
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
    Duration timeout = const Duration(seconds: 15),
    http.Client? httpClient,
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
      httpClient: httpClient,
      onOutcome: onOutcome,
    );
  }

  /// Analyses a set of tasks and returns a prioritised, grouped plan with
  /// time estimates and suggested focus order.
  Future<String?> analyzeTasks({
    required List<Map<String, dynamic>> tasks,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Analyse these tasks and produce a prioritised plan. For each task, rate urgency (high/medium/low), suggest a time slot, and explain the reasoning. Group them into "Do first", "Do later", and "Delegate or drop".\n\nTasks (JSON): ${jsonEncode(tasks)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Analyses habit patterns and returns insights with concrete suggestions
  /// for improvement.
  Future<String?> getHabitInsights({
    required List<Map<String, dynamic>> habits,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Analyse these habits and produce a weekly insight report. Identify the strongest habit, the weakest, and give one concrete, actionable suggestion for each. Keep it concise.\n\nHabits (JSON): ${jsonEncode(habits)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Breaks a goal down into concrete, time-bound action steps.
  Future<String?> planGoal({
    required String goalTitle,
    required String goalDescription,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Break down this goal into a concrete 30-day action plan. List weekly milestones, daily actions, and the key metric to track progress.\n\nGoal: $goalTitle\nDescription: $goalDescription',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Summarises a note and extracts action items, deadlines, and key points.
  Future<String?> summarizeNote({
    required String noteContent,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Summarise this note in 3 bullet points. Then list any action items (with suggested deadlines) and any key decisions made.\n\nNote content:\n$noteContent',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Answers a question using the user's own data (tasks, notes, habits,
  /// goals). Falls back to generic advice when no data is provided.
  Future<String> answerWithData({
    required String question,
    Map<String, dynamic> data = const {},
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if (data.isEmpty) {
      return sendMessage(
        conversationHistory: const [],
        newMessage: question,
        languageName: languageName,
        httpClient: httpClient,
      );
    }
    return sendMessageWithContext(
      conversationHistory: const [],
      newMessage: question,
      context: data,
      languageName: languageName,
      httpClient: httpClient,
    );
  }

  /// Generates a personalised habit coaching plan based on the user's
  /// habit history and current streaks.
  Future<String?> getHabitCoaching({
    required List<Map<String, dynamic>> habits,
    required Map<String, dynamic> aggregates,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a personalised habit coaching plan. Identify the most promising habit to build next, suggest a realistic weekly target, and explain the reasoning.\n\nHabits (JSON): ${jsonEncode(habits)}\nAggregates (JSON): ${jsonEncode(aggregates)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Suggests a smart schedule for the day based on pending tasks,
  /// habits, and the user's focus preferences.
  Future<String?> suggestSchedule({
    required List<Map<String, dynamic>> tasks,
    required List<Map<String, dynamic>> habits,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a time-blocked schedule for today. Assign time slots to each task and habit, group similar tasks together, and include breaks.\n\nTasks (JSON): ${jsonEncode(tasks)}\nHabits (JSON): ${jsonEncode(habits)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Generates a weekly workout plan based on the user's goals,
  /// current fitness level, and available equipment.
  Future<String?> generateWorkoutPlan({
    required String fitnessLevel,
    required List<String> equipment,
    required String goal,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a 7-day workout plan. Include warm-ups, main exercises, sets/reps, and rest days.\n\nFitness level: $fitnessLevel\nEquipment: ${jsonEncode(equipment)}\nGoal: $goal',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Generates a meal plan based on dietary preferences, budget,
  /// and nutritional goals.
  Future<String?> generateMealPlan({
    required String dietaryPreference,
    required int dailyBudget,
    required List<String> allergies,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a 3-day meal plan. Include breakfast, lunch, dinner, and snacks. Keep within the daily budget and avoid allergens.\n\nDietary preference: $dietaryPreference\nDaily budget: $dailyBudget\nAllergies: ${jsonEncode(allergies)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Analyses productivity patterns and returns personalised
  /// improvement suggestions.
  Future<String?> getProductivityAnalysis({
    required Map<String, dynamic> aggregates,
    required List<Map<String, dynamic>> recentActivity,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Analyse my productivity patterns and give 3 personalised suggestions for improvement. Focus on time management, focus habits, and energy management.\n\nAggregates (JSON): ${jsonEncode(aggregates)}\nRecent activity (JSON): ${jsonEncode(recentActivity)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Generates a weekly review summary from the user's completed
  /// tasks, habits, and achievements.
  Future<String?> generateWeeklyReview({
    required Map<String, dynamic> aggregates,
    required List<Map<String, dynamic>> highlights,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a motivational weekly review. Highlight achievements, suggest one area to improve, and set one goal for next week.\n\nAggregates (JSON): ${jsonEncode(aggregates)}\nHighlights (JSON): ${jsonEncode(highlights)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Streams model text as SSE events arrive. Failures use the error channel.
  Stream<String> streamMessage({
    required List<ChatMessage> conversationHistory,
    required String newMessage,
    String languageName = 'Arabic',
    Duration timeout = const Duration(seconds: 30),
    http.Client? httpClient,
  }) async* {
    final key = await getEffectiveApiKey();
    if (key.isEmpty) throw const AiStreamingException('missing_key');
    if (isKeyPaused) throw const AiStreamingException('paused');

    final client = httpClient ?? http.Client();
    try {
      final contents = <Map<String, dynamic>>[];
      for (final msg in conversationHistory) {
        contents.add({
          'role': msg.role == 'user' ? 'user' : 'model',
          'parts': [
            {'text': msg.text}
          ],
        });
      }
      contents.add({
        'role': 'user',
        'parts': [
          {
            'text':
                'System context: $_systemPrompt\nReply language: write the reply in the same language as the user request below. Use $languageName only if the request has no detectable language.\n\nUser request: $newMessage'
          }
        ],
      });

      final request = http.Request('POST', Uri.parse(_streamUrl));
      request.headers.addAll({
        'Content-Type': 'application/json',
        'X-goog-api-key': key,
        'Accept': 'text/event-stream',
      });
      request.body = jsonEncode({
        'generationConfig': {'temperature': 0.7, 'maxOutputTokens': 800},
        'contents': contents,
      });
      final response = await client.send(request).timeout(timeout);
      if (response.statusCode != 200) {
        throw const AiStreamingException('provider_error');
      }
      final contentType = response.headers['content-type']?.toLowerCase() ?? '';
      if (!contentType.startsWith('text/event-stream')) {
        throw const AiStreamingException('invalid_content_type');
      }

      var sawText = false;
      var done = false;
      final dataLines = <String>[];
      await for (final line in response.stream
          .timeout(timeout)
          .transform(utf8.decoder)
          .transform(const LineSplitter())) {
        if (line.isEmpty) {
          if (dataLines.isEmpty) continue;
          final data = dataLines.join('\n');
          dataLines.clear();
          if (data == '[DONE]') {
            done = true;
            break;
          }
          for (final text in _textFromSseEvent(data)) {
            sawText = true;
            yield text;
          }
        } else if (line.startsWith('data:')) {
          var data = line.substring(5);
          if (data.startsWith(' ')) data = data.substring(1);
          dataLines.add(data);
        }
      }
      if (!done && dataLines.isNotEmpty) {
        final data = dataLines.join('\n');
        if (data != '[DONE]') {
          for (final text in _textFromSseEvent(data)) {
            sawText = true;
            yield text;
          }
        }
      }
      if (!sawText) throw const AiStreamingException('empty_response');
      _consecutiveFailures = 0;
    } catch (error) {
      _consecutiveFailures++;
      if (error is AiStreamingException) rethrow;
      throw const AiStreamingException('stream_failed');
    } finally {
      if (httpClient == null) client.close();
    }
  }

  /// Generates a cumulative lifestyle analysis across all features
  /// (tasks, habits, goals, money, productivity) for a given time range.
  Future<String?> getCumulativeAnalysis({
    required Map<String, dynamic> aggregates,
    required List<Map<String, dynamic>> weeklyTrends,
    required String timeRange,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Generate a comprehensive cumulative lifestyle analysis for the period: $timeRange. Cover task completion rates, habit consistency, goal progress and overall productivity. Identify the top 3 strengths and 3 areas needing improvement. Provide actionable recommendations. Metrics that are absent are unavailable; do not invent numbers.\n\nAggregates (JSON): ${jsonEncode(aggregates)}\nWeekly trends (JSON): ${jsonEncode(weeklyTrends)}',
      languageName: languageName,
      httpClient: httpClient,
      onOutcome: (value) => succeeded = value,
    );
    // sendMessage returns localized fallback text on provider failure;
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
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    var succeeded = false;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Create a performance dashboard summary. Highlight the most important metrics, streaks to celebrate, and one key focus area for next week. Keep it concise and motivational. Metrics that are absent are unavailable; do not invent numbers.\n\nMetrics (JSON): ${jsonEncode(metrics)}\nStreaks (JSON): ${jsonEncode(streaks)}\nHighlights (JSON): ${jsonEncode(highlights)}',
      languageName: languageName,
      httpClient: httpClient,
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
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Analyse these daily productivity stats and identify patterns. Determine the user peak performance windows, flag declining trends, and suggest adjustments.\n\nDaily stats (JSON): ${jsonEncode(dailyStats)}\nPreferences (JSON): ${jsonEncode(preferences)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Generates a personalised weekly comparison report showing
  /// improvements or declines across all lifestyle categories.
  Future<String?> generateWeeklyComparison({
    required Map<String, dynamic> thisWeek,
    required Map<String, dynamic> lastWeek,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Compare this week performance with last week across tasks, habits and goals. Highlight improvements, declines, and one key takeaway.\n\nThis week (JSON): ${jsonEncode(thisWeek)}\nLast week (JSON): ${jsonEncode(lastWeek)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }

  /// Creates a personalised life balance score based on all
  /// lifestyle categories and suggests improvements.
  Future<String?> getLifeBalanceScore({
    required Map<String, dynamic> categoryScores,
    required Map<String, dynamic> weights,
    String languageName = 'Arabic',
    http.Client? httpClient,
  }) async {
    if ((await getEffectiveApiKey()).isEmpty || isKeyPaused) return null;
    final result = await sendMessage(
      conversationHistory: const [],
      newMessage:
          'Calculate a personalised life balance score from these category scores. Provide a 1-10 rating, explain the score, and suggest 2 concrete improvements for the weakest categories.\n\nCategory scores (JSON): ${jsonEncode(categoryScores)}\nWeights (JSON): ${jsonEncode(weights)}',
      languageName: languageName,
      httpClient: httpClient,
    );
    return result.isNotEmpty ? result : null;
  }
}
