import 'dart:convert';

import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/ai/data/text_limits.dart';

class ChatMessage {
  const ChatMessage({
    required this.role,
    required this.text,
    this.timestamp,
  });

  final String role; // 'user' or 'model'
  final String text;
  final DateTime? timestamp;

  Map<String, dynamic> toJson() => {
        'role': role,
        'text': text,
        if (timestamp != null) 'timestamp': timestamp!.toIso8601String(),
      };

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        role: json['role'] as String? ?? 'model',
        text: json['text'] as String? ?? '',
        timestamp: json['timestamp'] is String
            ? DateTime.tryParse(json['timestamp'] as String)
            : null,
      );
}

/// Server-owned generation profiles (see backend AI_GENERATION).
enum AiReplyMode { chat, brief }

/// Backend request limits (backend `AI_LIMITS`): at most 21 turns including
/// the new message, 4,000 characters per turn and 24,000 in total.
const int aiMaxRequestTurns = 21;
const int aiMaxTurnChars = 4000;
const int aiMaxRequestChars = 24000;

/// The part of [history] that fits the backend limits together with
/// [newMessage] (Hybrid AI audit AI0-F1). The full conversation stays on the
/// device; only the most recent answered turns are sent:
///  - empty bubbles (for example an interrupted reply) are skipped and very
///    long turns are cut to [aiMaxTurnChars];
///  - of two turns in a row from the same side, the later one is kept, and a
///    trailing question without an answer is dropped;
///  - the window starts with a user turn and ends with a model turn.
List<ChatMessage> boundedAiHistory(
  List<ChatMessage> history,
  String newMessage,
) {
  final cleaned = <ChatMessage>[];
  for (final message in history) {
    final text = clampUtf16(message.text.trim(), aiMaxTurnChars);
    if (text.isEmpty) continue;
    final role = message.role == 'user' ? 'user' : 'model';
    final turn = ChatMessage(role: role, text: text);
    if (cleaned.isNotEmpty && cleaned.last.role == role) {
      cleaned[cleaned.length - 1] = turn;
    } else {
      cleaned.add(turn);
    }
  }
  while (cleaned.isNotEmpty && cleaned.last.role == 'user') {
    cleaned.removeLast();
  }
  final budget = aiMaxRequestChars - newMessage.length;
  final window = <ChatMessage>[];
  var used = 0;
  for (var i = cleaned.length - 1; i >= 0; i--) {
    final turn = cleaned[i];
    if (window.length >= aiMaxRequestTurns - 1) break;
    if (used + turn.text.length > budget) break;
    window.add(turn);
    used += turn.text.length;
  }
  final ordered = window.reversed.toList();
  while (ordered.isNotEmpty && ordered.first.role != 'user') {
    ordered.removeAt(0);
  }
  return ordered;
}

/// Transport-level AI failure. Codes are deliberately provider-free so the
/// UI can localize them without ever seeing provider payloads or keys.
class AiTransportException implements Exception {
  const AiTransportException(this.code);

  /// One of: quota_exceeded, unavailable, unauthenticated, network,
  /// empty_response, stream_failed; for assistant turns also the denial
  /// reasons consent_required, scope_unavailable and unsupported (AI-2b).
  final String code;

  @override
  String toString() => 'AiTransportException($code)';
}

/// The narrow backend surface the AI feature depends on. [ApiClient]
/// satisfies it; tests substitute fakes.
abstract interface class AiBackendGateway {
  Future<Object?> post(String path, {Object? body});

  Stream<String> postEventStream(
    String path, {
    Object? body,
    required Duration timeout,
  });
}

/// Adapter exposing the app's shared [ApiClient] through the narrow AI
/// gateway surface, so session refresh/rotation rules stay in one place.
class ApiClientAiGateway implements AiBackendGateway {
  ApiClientAiGateway(this._client);

  final ApiClient _client;

  @override
  Future<Object?> post(String path, {Object? body}) =>
      _client.post(path, body: body);

  @override
  Stream<String> postEventStream(
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 60),
  }) =>
      _client.postEventStream(path, body: body, timeout: timeout);
}

/// Denial reasons of an assistant turn (backend AI-2b), passed on as
/// [AiTransportException] codes.
const Set<String> aiAssistantDenialCodes = {
  'consent_required',
  'scope_unavailable',
  'unsupported',
};

/// Talks to the LifeStyle backend AI proxy (`/ai/chat`, `/ai/chat/stream`,
/// `/ai/assistant/turn/stream`). The app no longer holds a Gemini key: the
/// central key, model, system prompt and quotas all live on the server
/// (BYOK retired).
class BackendAiTransport implements AiTransport, AiAssistantTurnTransport {
  BackendAiTransport(this._gateway);

  final AiBackendGateway _gateway;

  @override
  Future<String> chat({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final Object? decoded;
    try {
      decoded = await _gateway.post(
        'ai/chat',
        body: _requestBody(
          history: history,
          message: message,
          languageName: languageName,
          mode: mode,
        ),
      );
    } on ApiException catch (error) {
      throw AiTransportException(_codeFor(error));
    } on Object {
      throw const AiTransportException('unavailable');
    }
    if (decoded is Map<String, dynamic>) {
      final reply = decoded['reply'];
      if (reply is String && reply.trim().isNotEmpty) {
        return reply.trim();
      }
    }
    throw const AiTransportException('empty_response');
  }

  @override
  Stream<String> chatStream({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    var sawText = false;
    try {
      await for (final payload in _gateway.postEventStream(
        'ai/chat/stream',
        body: _requestBody(
          history: history,
          message: message,
          languageName: languageName,
          mode: AiReplyMode.chat,
        ),
        timeout: timeout,
      )) {
        if (payload == '[DONE]') break;
        final Object? decoded;
        try {
          decoded = jsonDecode(payload);
        } on FormatException {
          throw const AiTransportException('stream_failed');
        }
        if (decoded is Map<String, dynamic>) {
          if (decoded.containsKey('error')) {
            throw const AiTransportException('stream_failed');
          }
          final text = decoded['text'];
          if (text is String && text.isNotEmpty) {
            sawText = true;
            yield text;
          }
          continue;
        }
        throw const AiTransportException('stream_failed');
      }
    } on ApiException catch (error) {
      throw AiTransportException(_codeFor(error));
    }
    if (!sawText) {
      throw const AiTransportException('empty_response');
    }
  }

  /// One assistant turn through `/ai/assistant/turn/stream` (AI-2b). With
  /// [contextScopes] the server adds a capped summary of the user's day,
  /// after checking the durable AI consent. A denial arrives as one event
  /// and is thrown with its reason as the code (see
  /// [aiAssistantDenialCodes]). A server without this endpoint (for example
  /// after a rollback) answers 404; a turn without app data then goes
  /// through `/ai/chat/stream` instead.
  @override
  Stream<String> assistantTurnStream({
    required List<ChatMessage> history,
    required String message,
    required String clientLocale,
    required String languageName,
    List<String> contextScopes = const [],
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    final conversation = [
      for (final turn in boundedAiHistory(history, message))
        {'role': turn.role, 'text': turn.text},
    ];
    var sawText = false;
    var useChatProxy = false;
    try {
      await for (final payload in _gateway.postEventStream(
        'ai/assistant/turn/stream',
        body: <String, Object?>{
          'message': message,
          if (conversation.isNotEmpty) 'conversation': conversation,
          if (contextScopes.isNotEmpty) 'contextScopes': contextScopes,
          'clientLocale': clientLocale,
        },
        timeout: timeout,
      )) {
        if (payload == '[DONE]') break;
        final Object? decoded;
        try {
          decoded = jsonDecode(payload);
        } on FormatException {
          throw const AiTransportException('stream_failed');
        }
        if (decoded is! Map<String, dynamic>) {
          throw const AiTransportException('stream_failed');
        }
        if (decoded['type'] == 'unsupported_or_denied') {
          final reason = decoded['reason'];
          throw AiTransportException(
            aiAssistantDenialCodes.contains(reason)
                ? reason as String
                : 'stream_failed',
          );
        }
        if (decoded.containsKey('error')) {
          throw const AiTransportException('stream_failed');
        }
        final text = decoded['text'];
        if (text is String && text.isNotEmpty) {
          sawText = true;
          yield text;
        }
      }
    } on ApiException catch (error) {
      if (error.statusCode != 404 || contextScopes.isNotEmpty || sawText) {
        throw AiTransportException(_codeFor(error));
      }
      useChatProxy = true;
    }
    if (useChatProxy) {
      yield* chatStream(
        history: history,
        message: message,
        languageName: languageName,
        timeout: timeout,
      );
      return;
    }
    if (!sawText) {
      throw const AiTransportException('empty_response');
    }
  }

  Map<String, Object?> _requestBody({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
  }) {
    return {
      'messages': [
        for (final turn in boundedAiHistory(history, message))
          {
            'role': turn.role,
            'text': turn.text,
          },
        {'role': 'user', 'text': message},
      ],
      'language': languageName,
      'mode': mode.name,
    };
  }

  String _codeFor(ApiException error) {
    if (error.statusCode == 429) return 'quota_exceeded';
    if (error.statusCode == 401) return 'unauthenticated';
    if (error.statusCode == 0) return 'network';
    return 'unavailable';
  }
}

/// Chat transport used by [AiService]. Implementations must only throw
/// [AiTransportException]; raw provider/transport errors never cross this
/// boundary.
abstract interface class AiTransport {
  Future<String> chat({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
    required Duration timeout,
  });

  Stream<String> chatStream({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required Duration timeout,
  });
}

/// Assistant turns with optional app context (Hybrid AI AI-2b/AI-2c).
/// Kept apart from [AiTransport] so transports without it (test fakes) keep
/// working through [AiTransport.chatStream].
abstract interface class AiAssistantTurnTransport {
  Stream<String> assistantTurnStream({
    required List<ChatMessage> history,
    required String message,
    required String clientLocale,
    required String languageName,
    required List<String> contextScopes,
    required Duration timeout,
  });
}
