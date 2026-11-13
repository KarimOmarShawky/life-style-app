import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_settings_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

// Hybrid AI AI-2c: the assistant sends turns to /ai/assistant/turn/stream,
// optionally with the app-data scopes, and reads the AI-2b denial events.

class _Call {
  _Call(this.path, this.body);

  final String path;
  final Object? body;
}

/// Replays one canned stream (or error) per request, in order.
class _ScriptedGateway implements AiBackendGateway {
  _ScriptedGateway(this.script);

  final List<Object> script;
  final calls = <_Call>[];

  @override
  Future<Object?> post(String path, {Object? body}) async {
    throw UnimplementedError();
  }

  @override
  Stream<String> postEventStream(
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    calls.add(_Call(path, body));
    final next = script.removeAt(0);
    if (next is ApiException) throw next;
    for (final event in next as List<String>) {
      yield event;
    }
  }
}

ApiException _status(int statusCode) => ApiException(
      statusCode: statusCode,
      code: 'TEST',
      message: 'test',
    );

Future<String> _collect(Stream<String> stream) async {
  final buffer = StringBuffer();
  await for (final chunk in stream) {
    buffer.write(chunk);
  }
  return buffer.toString();
}

Future<String> _codeOf(Stream<String> stream) async {
  try {
    await _collect(stream);
  } on AiTransportException catch (error) {
    return error.code;
  } on AiStreamingException catch (error) {
    return error.code;
  }
  return 'no error';
}

class _MemoryTokens implements TokenStore {
  SessionTokens? _stored = SessionTokens(
    accessToken: 'access',
    refreshToken: 'refresh',
    accessTokenExpiresAt: DateTime.utc(2030),
    refreshTokenExpiresAt: DateTime.utc(2030),
  );

  @override
  Future<SessionTokens?> read() async => _stored;

  @override
  Future<void> write(SessionTokens tokens) async {
    _stored = tokens;
  }

  @override
  Future<void> clear() async {
    _stored = null;
  }
}

Map<String, Object?> _settingsView({int? version, bool available = true}) => {
      'success': true,
      'data': {
        'settings': {
          'egressConsentVersion': version,
          'egressConsentAt': version == null ? null : '2026-11-12T10:00:00Z',
          'memoryEnabled': false,
          'explicitMemoryEnabled': false,
          'learningEnabled': false,
          'quickActionsEnabled': false,
          'languageMode': 'auto',
        },
        'currentConsentVersion': 1,
        'available': available,
      },
    };

void main() {
  const history = [
    ChatMessage(role: 'user', text: 'Hi'),
    ChatMessage(role: 'model', text: 'Hello'),
  ];

  group('BackendAiTransport.assistantTurnStream', () {
    test('sends the turn with the scopes and streams the text', () async {
      final gateway = _ScriptedGateway([
        ['{"text":"You have "}', '{"text":"3 tasks"}', '[DONE]'],
      ]);
      final reply = await _collect(
        BackendAiTransport(gateway).assistantTurnStream(
          history: history,
          message: 'What is left today?',
          clientLocale: 'ar',
          languageName: 'Arabic',
          contextScopes: const ['today', 'tasks'],
        ),
      );
      expect(reply, 'You have 3 tasks');
      expect(gateway.calls.single.path, 'ai/assistant/turn/stream');
      expect(gateway.calls.single.body, {
        'message': 'What is left today?',
        'conversation': [
          {'role': 'user', 'text': 'Hi'},
          {'role': 'model', 'text': 'Hello'},
        ],
        'contextScopes': ['today', 'tasks'],
        'clientLocale': 'ar',
      });
    });

    test('leaves out empty conversation and scopes', () async {
      final gateway = _ScriptedGateway([
        ['{"text":"Hello"}', '[DONE]'],
      ]);
      await _collect(
        BackendAiTransport(gateway).assistantTurnStream(
          history: const [],
          message: 'Hi',
          clientLocale: 'en',
          languageName: 'English',
        ),
      );
      expect(gateway.calls.single.body, {
        'message': 'Hi',
        'clientLocale': 'en',
      });
    });

    test('keeps the conversation inside the backend limits', () async {
      final long = [
        for (var i = 0; i < 30; i++) ...[
          ChatMessage(role: 'user', text: 'q$i ${'x' * 1500}'),
          ChatMessage(role: 'model', text: 'a$i ${'y' * 1500}'),
        ],
      ];
      final gateway = _ScriptedGateway([
        ['{"text":"ok"}', '[DONE]'],
      ]);
      await _collect(
        BackendAiTransport(gateway).assistantTurnStream(
          history: long,
          message: 'Next?',
          clientLocale: 'en',
          languageName: 'English',
        ),
      );
      final body = gateway.calls.single.body! as Map<String, Object?>;
      final conversation = body['conversation']! as List<Object?>;
      expect(conversation.length, lessThanOrEqualTo(aiMaxRequestTurns - 1));
      var total = 'Next?'.length;
      for (final turn in conversation) {
        total += ((turn! as Map<String, Object?>)['text']! as String).length;
      }
      expect(total, lessThanOrEqualTo(aiMaxRequestChars));
      expect((conversation.last! as Map<String, Object?>)['text'],
          startsWith('a29 '));
    });

    for (final reason in ['consent_required', 'scope_unavailable']) {
      test('passes the $reason denial on as its code', () async {
        final gateway = _ScriptedGateway([
          [
            '{"type":"unsupported_or_denied","reason":"$reason"}',
            '[DONE]',
          ],
        ]);
        final code = await _codeOf(
          BackendAiTransport(gateway).assistantTurnStream(
            history: const [],
            message: 'Plan my day',
            clientLocale: 'en',
            languageName: 'English',
            contextScopes: const ['today'],
          ),
        );
        expect(code, reason);
      });
    }

    test('an unknown denial reason is a failed stream', () async {
      final gateway = _ScriptedGateway([
        ['{"type":"unsupported_or_denied","reason":"later"}', '[DONE]'],
      ]);
      final code = await _codeOf(
        BackendAiTransport(gateway).assistantTurnStream(
          history: const [],
          message: 'Hi',
          clientLocale: 'en',
          languageName: 'English',
        ),
      );
      expect(code, 'stream_failed');
    });

    test('an error after text fails the stream', () async {
      final gateway = _ScriptedGateway([
        ['{"text":"Half a"}', '{"error":"stream_failed"}', '[DONE]'],
      ]);
      final chunks = <String>[];
      Object? failure;
      try {
        await for (final chunk
            in BackendAiTransport(gateway).assistantTurnStream(
          history: const [],
          message: 'Hi',
          clientLocale: 'en',
          languageName: 'English',
        )) {
          chunks.add(chunk);
        }
      } on AiTransportException catch (error) {
        failure = error;
      }
      expect(chunks, ['Half a']);
      expect((failure! as AiTransportException).code, 'stream_failed');
    });

    test('an older server without the endpoint falls back to the chat proxy',
        () async {
      final gateway = _ScriptedGateway([
        _status(404),
        ['{"text":"From chat"}', '[DONE]'],
      ]);
      final reply = await _collect(
        BackendAiTransport(gateway).assistantTurnStream(
          history: history,
          message: 'Hi again',
          clientLocale: 'en',
          languageName: 'English',
        ),
      );
      expect(reply, 'From chat');
      expect(gateway.calls.map((call) => call.path), [
        'ai/assistant/turn/stream',
        'ai/chat/stream',
      ]);
    });

    test('app data never goes through the chat proxy', () async {
      final gateway = _ScriptedGateway([_status(404)]);
      final code = await _codeOf(
        BackendAiTransport(gateway).assistantTurnStream(
          history: const [],
          message: 'Hi',
          clientLocale: 'en',
          languageName: 'English',
          contextScopes: const ['today'],
        ),
      );
      expect(code, 'unavailable');
      expect(gateway.calls.length, 1);
    });

    test('maps quota, session and network errors', () async {
      for (final entry in {
        429: 'quota_exceeded',
        401: 'unauthenticated',
        0: 'network',
        503: 'unavailable',
      }.entries) {
        final gateway = _ScriptedGateway([_status(entry.key)]);
        final code = await _codeOf(
          BackendAiTransport(gateway).assistantTurnStream(
            history: const [],
            message: 'Hi',
            clientLocale: 'en',
            languageName: 'English',
          ),
        );
        expect(code, entry.value, reason: 'status ${entry.key}');
      }
    });
  });

  group('AiService.streamAssistantTurn', () {
    test('denials do not count toward the pause', () async {
      final gateway = _ScriptedGateway([
        for (var i = 0; i < 4; i++)
          ['{"type":"unsupported_or_denied","reason":"consent_required"}'],
      ]);
      final service = AiService.forTesting(
        transport: BackendAiTransport(gateway),
      );
      for (var i = 0; i < 4; i++) {
        final code = await _codeOf(
          service.streamAssistantTurn(
            conversationHistory: const [],
            newMessage: 'Hi',
            clientLocale: 'en',
            contextScopes: const ['today'],
          ),
        );
        expect(code, 'consent_required');
      }
      expect(service.isPaused, isFalse);
    });

    test('failures still pause after three in a row', () async {
      final gateway = _ScriptedGateway([
        for (var i = 0; i < 3; i++) _status(503),
      ]);
      final service = AiService.forTesting(
        transport: BackendAiTransport(gateway),
      );
      for (var i = 0; i < 3; i++) {
        await _codeOf(
          service.streamAssistantTurn(
            conversationHistory: const [],
            newMessage: 'Hi',
            clientLocale: 'en',
          ),
        );
      }
      expect(service.isPaused, isTrue);
      final code = await _codeOf(
        service.streamAssistantTurn(
          conversationHistory: const [],
          newMessage: 'Hi',
          clientLocale: 'en',
        ),
      );
      expect(code, 'paused');
      expect(gateway.calls.length, 3);
    });
  });

  group('ApiAiSettingsClient', () {
    test('reads the settings and stores the current consent version', () async {
      final requests = <http.Request>[];
      final client = ApiAiSettingsClient(
        ApiClient(
          baseUri: Uri.parse('https://api.example.test/api/v1/'),
          tokenStore: _MemoryTokens(),
          httpClient: MockClient((request) async {
            requests.add(request);
            final version = request.method == 'PATCH' ? 1 : null;
            return http.Response(
              jsonEncode(_settingsView(version: version)),
              200,
              headers: {'content-type': 'application/json'},
            );
          }),
        ),
      );
      final before = await client.fetch();
      expect(before.available, isTrue);
      expect(before.hasCurrentConsent, isFalse);
      final after = await client.grantConsent();
      expect(after.hasCurrentConsent, isTrue);
      expect(requests.map((r) => '${r.method} ${r.url.path}'), [
        'GET /api/v1/ai/settings',
        'PATCH /api/v1/ai/settings',
      ]);
      expect(jsonDecode(requests.last.body), {
        'egressConsentVersion': aiEgressConsentVersion,
      });
    });

    test('withdraws the consent with a null version', () async {
      final requests = <http.Request>[];
      final client = ApiAiSettingsClient(
        ApiClient(
          baseUri: Uri.parse('https://api.example.test/api/v1/'),
          tokenStore: _MemoryTokens(),
          httpClient: MockClient((request) async {
            requests.add(request);
            return http.Response(
              jsonEncode(_settingsView()),
              200,
              headers: {'content-type': 'application/json'},
            );
          }),
        ),
      );
      final after = await client.withdrawConsent();
      expect(after.consentVersion, isNull);
      expect(requests.single.method, 'PATCH');
      expect(jsonDecode(requests.single.body), {'egressConsentVersion': null});
    });

    test('an older consent or missing table is not a current consent', () {
      final older = AiSettingsSnapshot.fromJson(
        _settingsView(version: 1)['data'],
      );
      expect(older.hasCurrentConsent, isTrue);
      final view = _settingsView(version: 1)['data']! as Map<String, Object?>;
      final newer = AiSettingsSnapshot.fromJson({
        ...view,
        'currentConsentVersion': 2,
      });
      expect(newer.hasCurrentConsent, isFalse);
      final missing = AiSettingsSnapshot.fromJson(
        _settingsView(available: false)['data'],
      );
      expect(missing.hasCurrentConsent, isFalse);
      expect(
        () => AiSettingsSnapshot.fromJson({'settings': 'nope'}),
        throwsFormatException,
      );
    });
  });
}
