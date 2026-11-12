import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/ai/data/text_limits.dart';

/// Where the reported AI text was shown (backend `surface`).
enum AiReportSurface {
  assistant('assistant'),
  weeklyCoaching('weekly_coaching'),
  analyticsInsight('analytics_insight');

  const AiReportSurface(this.wire);

  final String wire;
}

/// Why the user reports the reply (backend `category`).
enum AiReportCategory {
  offensive,
  harmful,
  inaccurate,
  spam,
  other,
}

/// Backend limit for the reply text (`ai_content_reports.reply_text`).
const int aiReportReplyMaxChars = 4000;

/// Backend limit for the optional note (`ai_content_reports.note`).
const int aiReportNoteMaxChars = 500;

/// Sends in-app reports of AI output (Google Play AI-Generated Content
/// policy). Only the surface, the category, the locale and - when the user
/// chose to include them - the reply text and a note are sent.
abstract interface class AiReportsClient {
  Future<void> submit({
    required AiReportSurface surface,
    required AiReportCategory category,
    required String locale,
    String? replyText,
    String? note,
  });
}

class ApiAiReportsClient implements AiReportsClient {
  ApiAiReportsClient(this._api);

  final ApiClient _api;

  @override
  Future<void> submit({
    required AiReportSurface surface,
    required AiReportCategory category,
    required String locale,
    String? replyText,
    String? note,
  }) async {
    final reply = replyText == null
        ? ''
        : clampUtf16(replyText.trim(), aiReportReplyMaxChars);
    final cleanNote =
        note == null ? '' : clampUtf16(note.trim(), aiReportNoteMaxChars);
    await _api.post(
      'ai/reports',
      body: <String, Object?>{
        'surface': surface.wire,
        'category': category.name,
        'locale': locale,
        if (reply.isNotEmpty) 'replyText': reply,
        if (cleanNote.isNotEmpty) 'note': cleanNote,
      },
    );
  }
}

final aiReportsClientProvider = Provider<AiReportsClient>(
  (ref) => ApiAiReportsClient(ref.watch(apiClientProvider)),
);
