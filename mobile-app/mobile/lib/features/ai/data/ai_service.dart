import 'dart:convert';
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

  static const String _systemPrompt = '''
You are "LifeStyle AI Assistant", an intelligent, empathetic, and highly practical personal productivity coach and life organizer.
You help the user:
- Plan their day and structure their daily schedule with concrete time slots.
- Suggest healthy, sustainable habits and give motivational tips.
- Help them organize their thoughts, notes, and tasks efficiently.
- Answer questions with actionable, clear, bullet-pointed advice.
Language: Respond in the exact language the user talks in (Egyptian Arabic, Modern Standard Arabic, or English).
Tone: Friendly, motivating, professional, concise, and focused on execution. Avoid fluff.
''';

  Future<String> sendMessage({
    required List<ChatMessage> conversationHistory,
    required String newMessage,
    bool isArabic = true,
    Duration timeout = const Duration(seconds: 12),
  }) async {
    final key = AppConfig.geminiApiKey.trim();
    if (key.isEmpty) {
      return isArabic
          ? 'يرجى التأكد من تهيئة مفتاح الذكاء الاصطناعي (Gemini API Key).'
          : 'Please make sure Gemini API Key is configured.';
    }

    try {
      final contents = <Map<String, dynamic>>[];

      // Add conversation history
      for (final msg in conversationHistory) {
        contents.add({
          'role': msg.role == 'user' ? 'user' : 'model',
          'parts': [
            {'text': msg.text}
          ]
        });
      }

      // Add current message with system instructions context
      contents.add({
        'role': 'user',
        'parts': [
          {'text': 'System context: $_systemPrompt\nPreferred language: ${isArabic ? "Arabic" : "English"}\n\nUser request: $newMessage'}
        ]
      });

      final response = await http
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
        final decoded = jsonDecode(response.body) as Map<String, dynamic>;
        final candidates = decoded['candidates'] as List?;
        if (candidates != null && candidates.isNotEmpty) {
          final content = candidates[0]['content'] as Map<String, dynamic>?;
          final parts = content?['parts'] as List?;
          if (parts != null && parts.isNotEmpty) {
            final text = parts[0]['text'] as String?;
            if (text != null && text.trim().isNotEmpty) {
              return text.trim();
            }
          }
        }
      }
      return isArabic
          ? 'عذراً، لم أتمكن من معالجة الطلب حالياً. يرجى المحاولة بعد لحظات.'
          : 'Sorry, I could not process your request right now. Please try again shortly.';
    } catch (e) {
      return isArabic
          ? 'تعذر الاتصال بالذكاء الاصطناعي. يرجى التحقق من اتصال الإنترنت.'
          : 'Could not connect to AI. Please check your internet connection.';
    }
  }

  Future<String> generateDailyBriefing({
    required String userName,
    required int pendingTasksCount,
    required int completedHabitsCount,
    required int totalHabitsCount,
    bool isArabic = true,
  }) async {
    final key = AppConfig.geminiApiKey.trim();
    final hour = DateTime.now().hour;
    final isMorning = hour < 14;

    if (key.isEmpty) {
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
Language: ${isArabic ? "Friendly Egyptian/Modern Arabic." : "English. Friendly, clear, and inspiring."}
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
        final decoded = jsonDecode(response.body) as Map<String, dynamic>;
        final candidates = decoded['candidates'] as List?;
        if (candidates != null && candidates.isNotEmpty) {
          final text = candidates[0]['content']?['parts']?[0]?['text'] as String?;
          if (text != null && text.trim().isNotEmpty) {
            return text.trim();
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
