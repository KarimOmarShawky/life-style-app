import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';

class ParsedTaskResult {
  const ParsedTaskResult({
    required this.title,
    this.scheduledDateTime,
    this.dueDate,
    this.dueTime,
    this.hasTime = false,
  });

  final String title;
  final DateTime? scheduledDateTime;
  final String? dueDate;
  final String? dueTime;
  final bool hasTime;

  @override
  String toString() =>
      'ParsedTaskResult(title: "$title", date: $dueDate, time: $dueTime, hasTime: $hasTime)';
}

class SmartTaskParser {
  SmartTaskParser._();

  /// Attempts to parse using Google Gemini AI for ultra-accurate natural language understanding.
  /// Seamlessly falls back to local heuristic parser if offline or if any error/timeout occurs.
  static Future<ParsedTaskResult> parseAsync(
    String rawInput, {
    DateTime? now,
    Duration timeout = const Duration(seconds: 4),
    String? apiKey,
  }) async {
    final current = now ?? DateTime.now();
    final trimmed = rawInput.trim();
    if (trimmed.isEmpty) {
      return const ParsedTaskResult(title: '');
    }

    final key = (apiKey ?? AppConfig.geminiApiKey).trim();
    if (key.isNotEmpty) {
      try {
        final nowFormatted =
            '${current.year}-${current.month.toString().padLeft(2, '0')}-${current.day.toString().padLeft(2, '0')} ${current.hour.toString().padLeft(2, '0')}:${current.minute.toString().padLeft(2, '0')}';

        final url = Uri.parse(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
        );

        final prompt = '''
Current datetime is $nowFormatted.
Extract task information from the user sentence in Arabic or English: "$trimmed".
Return a JSON object with:
"title": (string, clean task title without date/time triggers),
"dueDate": (string YYYY-MM-DD or null),
"dueTime": (string HH:mm in 24-hour format or null),
"hasTime": (boolean, true if explicit or relative time is mentioned, false otherwise).
''';

        final response = await http.post(
          url,
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': key,
          },
          body: jsonEncode({
            'generationConfig': {
              'responseMimeType': 'application/json',
              'temperature': 0.1,
            },
            'contents': [
              {
                'parts': [
                  {'text': prompt}
                ]
              }
            ]
          }),
        ).timeout(timeout);

        if (response.statusCode == 200) {
          final decoded = jsonDecode(response.body) as Map<String, dynamic>;
          final candidates = decoded['candidates'] as List?;
          if (candidates != null && candidates.isNotEmpty) {
            final content = candidates[0]['content'] as Map<String, dynamic>?;
            final parts = content?['parts'] as List?;
            if (parts != null && parts.isNotEmpty) {
              final jsonText = parts[0]['text'] as String?;
              if (jsonText != null && jsonText.isNotEmpty) {
                final parsedJson = jsonDecode(jsonText.trim()) as Map<String, dynamic>;
                final title = (parsedJson['title'] as String?)?.trim();
                final dueDate = (parsedJson['dueDate'] as String?)?.trim();
                final dueTime = (parsedJson['dueTime'] as String?)?.trim();
                final hasTime = parsedJson['hasTime'] == true;

                DateTime? scheduled;
                if (dueDate != null && dueDate.isNotEmpty) {
                  final dateParts = dueDate.split('-');
                  if (dateParts.length == 3) {
                    final y = int.tryParse(dateParts[0]) ?? current.year;
                    final m = int.tryParse(dateParts[1]) ?? current.month;
                    final d = int.tryParse(dateParts[2]) ?? current.day;
                    int hour = 9;
                    int minute = 0;
                    if (hasTime && dueTime != null && dueTime.contains(':')) {
                      final timeParts = dueTime.split(':');
                      hour = int.tryParse(timeParts[0]) ?? 9;
                      minute = int.tryParse(timeParts[1]) ?? 0;
                    }
                    scheduled = DateTime(y, m, d, hour, minute);
                  }
                }

                return ParsedTaskResult(
                  title: (title != null && title.isNotEmpty) ? title : trimmed,
                  scheduledDateTime: scheduled,
                  dueDate: dueDate,
                  dueTime: dueTime,
                  hasTime: hasTime,
                );
              }
            }
          }
        }
      } catch (_) {
        // Fall through to local offline parser
      }
    }

    return parse(trimmed, current);
  }

  /// Parses natural language input (Arabic or English) and extracts clean title, date, and time.
  static ParsedTaskResult parse(String rawInput, [DateTime? now]) {
    final current = now ?? DateTime.now();
    var text = rawInput.trim();
    if (text.isEmpty) {
      return const ParsedTaskResult(title: '');
    }

    // Normalize arabic letters
    var normalized = _normalizeArabic(text.toLowerCase());

    DateTime targetDate;
    int? targetHour;
    int? targetMinute;
    var hasExplicitTime = false;

    // 1. Check relative duration offsets (e.g. "بعد نص ساعة", "بعد ساعتين", "بعد 15 دقيقة")
    final relativeMatch = _matchRelativeDuration(normalized, current);
    if (relativeMatch != null) {
      final cleanTitle = _cleanTitle(text, relativeMatch.matchedPhrases);
      return ParsedTaskResult(
        title: cleanTitle.isEmpty ? text : cleanTitle,
        scheduledDateTime: relativeMatch.dateTime,
        dueDate: _formatDate(relativeMatch.dateTime),
        dueTime: _formatTime(relativeMatch.dateTime.hour, relativeMatch.dateTime.minute),
        hasTime: true,
      );
    }

    final matchedPhrases = <String>[];

    // 2. Extract Date (النهاردة، بكرة، بعد بكرة، أيام الأسبوع)
    final dateExtraction = _extractDate(normalized, current);
    if (dateExtraction != null) {
      targetDate = dateExtraction.date;
      matchedPhrases.addAll(dateExtraction.matchedTokens);
    } else {
      targetDate = DateTime(current.year, current.month, current.day);
    }

    // 3. Extract Time (الساعة 7 بليل، 12 الظهر، 5:30 مساء، 8 الصبح)
    final timeExtraction = _extractTime(normalized);
    if (timeExtraction != null) {
      targetHour = timeExtraction.hour;
      targetMinute = timeExtraction.minute;
      hasExplicitTime = true;
      matchedPhrases.addAll(timeExtraction.matchedTokens);
    }

    DateTime? fullScheduled;
    String dueDateStr = _formatDate(targetDate);
    String? dueTimeStr;

    if (hasExplicitTime && targetHour != null) {
      dueTimeStr = _formatTime(targetHour, targetMinute ?? 0);
      fullScheduled = DateTime(
        targetDate.year,
        targetDate.month,
        targetDate.day,
        targetHour,
        targetMinute ?? 0,
      );

      // If scheduled time has already passed today, advance to tomorrow if no explicit day was specified
      if (dateExtraction == null && fullScheduled.isBefore(current)) {
        fullScheduled = fullScheduled.add(const Duration(days: 1));
        dueDateStr = _formatDate(fullScheduled);
      }
    }

    // 4. Extract and clean title
    final cleanTitle = _cleanTitle(text, matchedPhrases);

    return ParsedTaskResult(
      title: cleanTitle.isEmpty ? text : cleanTitle,
      scheduledDateTime: fullScheduled,
      dueDate: dueDateStr,
      dueTime: dueTimeStr,
      hasTime: hasExplicitTime,
    );
  }

  static String _normalizeArabic(String input) {
    return input
        .replaceAll('أ', 'ا')
        .replaceAll('إ', 'ا')
        .replaceAll('آ', 'ا')
        .replaceAll('ة', 'ه')
        .replaceAll('ى', 'ي')
        .replaceAll('٠', '0')
        .replaceAll('١', '1')
        .replaceAll('٢', '2')
        .replaceAll('٣', '3')
        .replaceAll('٤', '4')
        .replaceAll('٥', '5')
        .replaceAll('٦', '6')
        .replaceAll('٧', '7')
        .replaceAll('٨', '8')
        .replaceAll('٩', '9');
  }

  static _RelativeResult? _matchRelativeDuration(String text, DateTime current) {
    if (RegExp(r'\b(بعد\s+(نص|نصف)\s*ساعه|in\s+half\s+an?\s+hour)\b').hasMatch(text)) {
      final dt = current.add(const Duration(minutes: 30));
      return _RelativeResult(dt, ['بعد نص ساعه', 'بعد نصف ساعه', 'بعد نص ساعة', 'in half an hour']);
    }

    if (RegExp(r'\b(بعد\s+ربع\s*ساعه|in\s+15\s*min(utes)?)\b').hasMatch(text)) {
      final dt = current.add(const Duration(minutes: 15));
      return _RelativeResult(dt, ['بعد ربع ساعه', 'بعد ربع ساعة', 'in 15 min', 'in 15 minutes']);
    }

    if (RegExp(r'\b(بعد\s*ساعتين|in\s+2\s*hours?)\b').hasMatch(text)) {
      final dt = current.add(const Duration(hours: 2));
      return _RelativeResult(dt, ['بعد ساعتين', 'in 2 hours']);
    }

    if (RegExp(r'\b(بعد\s*ساعه|in\s+an?\s+hour)\b').hasMatch(text)) {
      final dt = current.add(const Duration(hours: 1));
      return _RelativeResult(dt, ['بعد ساعه', 'بعد ساعة', 'in an hour', 'in 1 hour']);
    }

    final minMatch = RegExp(r'\b(بعد\s+(\d+)\s*(دقايق|دقيقه|دقائق)|in\s+(\d+)\s*min(utes)?)\b').firstMatch(text);
    if (minMatch != null) {
      final n = int.tryParse(minMatch.group(2) ?? minMatch.group(4) ?? '') ?? 10;
      final dt = current.add(Duration(minutes: n));
      return _RelativeResult(dt, [minMatch.group(0)!]);
    }

    final hourMatch = RegExp(r'\b(بعد\s+(\d+)\s*(ساعات|ساعه)|in\s+(\d+)\s*hours?)\b').firstMatch(text);
    if (hourMatch != null) {
      final n = int.tryParse(hourMatch.group(2) ?? hourMatch.group(4) ?? '') ?? 1;
      final dt = current.add(Duration(hours: n));
      return _RelativeResult(dt, [hourMatch.group(0)!]);
    }

    return null;
  }

  static _DateResult? _extractDate(String text, DateTime current) {
    if (RegExp(r'\b(النهارده|النهاردة|اليوم|today)\b').hasMatch(text)) {
      return _DateResult(
        DateTime(current.year, current.month, current.day),
        ['النهارده', 'النهاردة', 'اليوم', 'today'],
      );
    }

    if (RegExp(r'\b(بعد\s*(بكره|بكرة|غد|غدا)|day after tomorrow)\b').hasMatch(text)) {
      final d = current.add(const Duration(days: 2));
      return _DateResult(
        DateTime(d.year, d.month, d.day),
        ['بعد بكره', 'بعد بكرة', 'بعد غد', 'بعد غدا', 'day after tomorrow'],
      );
    }

    if (RegExp(r'\b(بكره|بكرة|غدا|غدا|tomorrow)\b').hasMatch(text)) {
      final d = current.add(const Duration(days: 1));
      return _DateResult(
        DateTime(d.year, d.month, d.day),
        ['بكره', 'بكرة', 'غدا', 'غدا', 'tomorrow'],
      );
    }

    final weekdays = {
      DateTime.saturday: ['السبت', 'saturday', 'sat'],
      DateTime.sunday: ['الاحد', 'sunday', 'sun'],
      DateTime.monday: ['الاثنين', 'الاتنين', 'monday', 'mon'],
      DateTime.tuesday: ['الثلاثاء', 'التلات', 'الثلاثا', 'tuesday', 'tue'],
      DateTime.wednesday: ['الاربعاء', 'الاربعا', 'wednesday', 'wed'],
      DateTime.thursday: ['الخميس', 'thursday', 'thu'],
      DateTime.friday: ['الجمعه', 'friday', 'fri'],
    };

    for (final entry in weekdays.entries) {
      for (final name in entry.value) {
        final pattern = RegExp('\\b(يوم\\s+)?$name\\b');
        final match = pattern.firstMatch(text);
        if (match != null) {
          final targetWeekday = entry.key;
          var daysToAdd = (targetWeekday - current.weekday) % 7;
          if (daysToAdd <= 0) daysToAdd += 7;
          final target = current.add(Duration(days: daysToAdd));
          return _DateResult(
            DateTime(target.year, target.month, target.day),
            [match.group(0)!],
          );
        }
      }
    }

    return null;
  }

  static _TimeResult? _extractTime(String text) {
    final directMatch = RegExp(r'\b(\d{1,2}):(\d{2})\b').firstMatch(text);
    if (directMatch != null) {
      var hour = int.parse(directMatch.group(1)!);
      final minute = int.parse(directMatch.group(2)!);
      final isPm = RegExp(r'\b(بليل|بالليل|مساء|عصرا|العصر|المغرب|العشا|pm)\b').hasMatch(text);
      if (isPm && hour < 12) hour += 12;
      return _TimeResult(hour, minute, [directMatch.group(0)!]);
    }

    final clockMatch = RegExp(
      r'\b(الساعه|الساعة|at)\s*(\d{1,2}|واحده|اتنين|تلاته|اربعه|خمسه|سته|سبعه|ثمانيه|تمانيه|تسعه|عشره|حداشر|اتناشر)\s*(ونص|ونصف|وربع|وتلت|الا ربع)?\b',
    ).firstMatch(text);

    int? hour;
    int minute = 0;
    String matchedStr = '';

    if (clockMatch != null) {
      matchedStr = clockMatch.group(0)!;
      final hourStr = clockMatch.group(2)!;
      final minuteWord = clockMatch.group(3);

      hour = _wordToHour(hourStr);
      if (minuteWord != null) {
        if (minuteWord.contains('نص')) minute = 30;
        if (minuteWord.contains('ربع') && !minuteWord.contains('الا')) {
          minute = 15;
        }
        if (minuteWord.contains('تلت')) minute = 20;
        if (minuteWord.contains('الا ربع')) {
          minute = 45;
          hour = (hour! - 1);
        }
      }
    } else {
      final bareMatch = RegExp(
        r'\b(\d{1,2})\s*(الصبح|صباحا|الظهر|ظهرا|العصر|عصرا|المغرب|العشا|بليل|بالليل|مساء|مساءا|am|pm)\b',
      ).firstMatch(text);

      if (bareMatch != null) {
        matchedStr = bareMatch.group(0)!;
        hour = int.tryParse(bareMatch.group(1)!);
      }
    }

    if (hour != null) {
      final isNight = RegExp(r'\b(بليل|بالليل|مساء|مساءا|عصرا|العصر|المغرب|العشا|pm|night|evening)\b')
          .hasMatch(text);
      final isMorning = RegExp(r'\b(الصبح|صباحا|صباح|الفجر|فجر|am|morning)\b').hasMatch(text);
      final isNoon = RegExp(r'\b(الظهر|ظهرا|ظهر|noon)\b').hasMatch(text);

      if (isNight && hour < 12) {
        hour += 12;
      } else if (isNoon && hour == 12) {
        hour = 12;
      } else if (isMorning && hour == 12) {
        hour = 0;
      }

      return _TimeResult(hour, minute, [matchedStr]);
    }

    if (RegExp(r'\b(الصبح|صباحا|morning)\b').hasMatch(text)) {
      return _TimeResult(9, 0, ['الصبح', 'صباحا', 'morning']);
    }
    if (RegExp(r'\b(الظهر|ظهرا|noon)\b').hasMatch(text)) {
      return _TimeResult(12, 0, ['الظهر', 'ظهرا', 'noon']);
    }
    if (RegExp(r'\b(العصر|عصرا|afternoon)\b').hasMatch(text)) {
      return _TimeResult(15, 30, ['العصر', 'عصرا', 'afternoon']);
    }
    if (RegExp(r'\b(المغرب|مغرب|sunset)\b').hasMatch(text)) {
      return _TimeResult(18, 0, ['المغرب', 'مغرب', 'sunset']);
    }
    if (RegExp(r'\b(بليل|بالليل|مساء|night)\b').hasMatch(text)) {
      return _TimeResult(20, 0, ['بليل', 'بالليل', 'مساء', 'night']);
    }

    return null;
  }

  static int? _wordToHour(String raw) {
    final parsed = int.tryParse(raw);
    if (parsed != null) return parsed;
    switch (raw) {
      case 'واحده':
      case 'واحدة':
        return 1;
      case 'اتنين':
      case 'اثنين':
        return 2;
      case 'تلاته':
      case 'ثلاثة':
      case 'تلاتة':
        return 3;
      case 'اربعه':
      case 'اربعة':
        return 4;
      case 'خمسه':
      case 'خمسة':
        return 5;
      case 'سته':
      case 'ستة':
        return 6;
      case 'سبعه':
      case 'سبعة':
        return 7;
      case 'ثمانيه':
      case 'تمانيه':
      case 'ثمانية':
        return 8;
      case 'تسعه':
      case 'تسعة':
        return 9;
      case 'عشره':
      case 'عشرة':
        return 10;
      case 'حداشر':
      case 'احد عشر':
        return 11;
      case 'اتناشر':
      case 'اثنا عشر':
        return 12;
      default:
        return null;
    }
  }

  static String _cleanTitle(String original, List<String> phrasesToRemove) {
    var result = original;

    final triggers = [
      r'^\s*فكرني\s*(بـ|ب)?\s*',
      r'^\s*ذكرني\s*(بـ|ب)?\s*',
      r'^\s*تذكير\s*(بـ|ب)?\s*',
      r'^\s*عندي\s*',
      r'^\s*مشوار\s*',
      r'^\s*ميعاد\s*',
      r'^\s*موعد\s*',
      r'^\s*remind\s*me\s*(to)?\s*',
      r'^\s*add\s*task\s*',
    ];

    for (final trigger in triggers) {
      result = result.replaceFirst(RegExp(trigger, caseSensitive: false), '');
    }

    for (final phrase in phrasesToRemove) {
      if (phrase.trim().isNotEmpty) {
        result = result.replaceAll(RegExp('\\b${RegExp.escape(phrase.trim())}\\b', caseSensitive: false), ' ');
      }
    }

    result = result.replaceAll(
      RegExp(r'\b(بليل|بالليل|الصبح|صباحا|مساء|مساءا|الظهر|ظهرا|العصر|عصرا|المغرب|العشا|am|pm|today|tomorrow)\b', caseSensitive: false),
      ' ',
    );

    result = result.replaceAll(RegExp(r'\s+'), ' ').trim();

    return result;
  }

  static String _formatDate(DateTime d) {
    final y = d.year.toString().padLeft(4, '0');
    final m = d.month.toString().padLeft(2, '0');
    final day = d.day.toString().padLeft(2, '0');
    return '$y-$m-$day';
  }

  static String _formatTime(int h, int m) {
    return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}';
  }
}

class _RelativeResult {
  _RelativeResult(this.dateTime, this.matchedPhrases);
  final DateTime dateTime;
  final List<String> matchedPhrases;
}

class _DateResult {
  _DateResult(this.date, this.matchedTokens);
  final DateTime date;
  final List<String> matchedTokens;
}

class _TimeResult {
  _TimeResult(this.hour, this.minute, this.matchedTokens);
  final int hour;
  final int minute;
  final List<String> matchedTokens;
}
