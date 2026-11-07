import 'dart:convert';

import 'package:lifestyle_mobile/data/api_client.dart';

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

/// Server-owned generation profiles (see backend AI_GENERATION).
enum AiReplyMode { chat, brief }

/// Transport-level AI failure. Codes are deliberately provider-free so the
/// UI can localize them without ever seeing provider payloads or keys.
class AiTransportException implements Exception {
  const AiTransportException(this.code);

  /// One of: quota_exceeded, unavailable, unauthenticated, network,
  /// empty_response, stream_failed.
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

/// Talks to the LifeStyle backend AI proxy (`/ai/chat`, `/ai/chat/stream`).
/// The app no longer holds a Gemini key: the central key, model, system
/// prompt and quotas all live on the server (BYOK retired).
class BackendAiTransport implements AiTransport {
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

  Map<String, Object?> _requestBody({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
  }) {
    return {
      'messages': [
        for (final turn in history)
          {
            'role': turn.role == 'user' ? 'user' : 'model',
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
