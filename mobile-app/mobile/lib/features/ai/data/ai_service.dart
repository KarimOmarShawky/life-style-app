import 'dart:convert';

import 'package:flutter/services.dart';
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

class AiService {
  AiService._();
  static final AiService instance = AiService._();

  static const String _model = 'gemini-3.5-flash-lite';
  static const String _baseUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/$_model:generateContent';
  static const String _byokStorageKey = 'lifestyle.byok.gemini_api_key.v1';
  static const int maxConsecutiveFailures = 3;

  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  String? _cachedUserKey;
  bool _loadedUserKey = false;
  int _consecutiveFailures = 0;

  bool get isKeyPaused => _consecutiveFailures >= maxConsecutiveFailures;

  void resetFailureCount() {
    _consecutiveFailures = 0;
  }

  /// Returns the user's personal BYOK Gemini API key stored in secure storage.
  Future<String> getUserApiKey() async {
    if (_loadedUserKey) {
      return _cachedUserKey ?? '';
    }
    try {
      final stored = await _secureStorage.read(key: _byokStorageKey);
      _cachedUserKey = stored?.trim();
    } on MissingPluginException {
      // Unit/widget tests without platform channels fall back to in-memory cache.
    } on PlatformException {
      // Ignore platform read errors and fall back to in-memory cache.
    }
    _loadedUserKey = true;
    return _cachedUserKey ?? '';
  }

  /// Returns true when the user has saved a personal BYOK Gemini API key.
  Future<bool> hasUserApiKey() async {
    final key = await getUserApiKey();
    return key.isNotEmpty;
  }

  /// Saves or clears the user's personal BYOK Gemini API key in secure storage.
  Future<void> setUserApiKey(String? apiKey) async {
    final trimmed = apiKey?.trim() ?? '';
    _cachedUserKey = trimmed.isEmpty ? null : trimmed;
    _loadedUserKey = true;
    _consecutiveFailures = 0;
    try {
      if (trimmed.isEmpty) {
        await _secureStorage.delete(key: _byokStorageKey);
      } else {
        await _secureStorage.write(key: _byokStorageKey, value: trimmed);
      }
    } on MissingPluginException {
      // Unit/widget tests without platform channels keep the in-memory value.
    } on PlatformException {
      // Ignore platform write errors in non-device environments.
    }
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

  Future<String> sendMessage({
    required List<ChatMessage> conversationHistory,
    required String newMessage,
    String languageName = 'Arabic',
    Duration timeout = const Duration(seconds: 12),
    http.Client? httpClient,
  }) async {
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
}
