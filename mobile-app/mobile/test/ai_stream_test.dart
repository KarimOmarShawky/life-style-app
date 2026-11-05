import 'support/fake_secure_storage.dart';
import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';

class _FakeClient extends http.BaseClient {
  _FakeClient(this.handle);

  final Future<http.StreamedResponse> Function(http.BaseRequest request) handle;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      handle(request);
}

class _StreamResult {
  _StreamResult(this.chunks, this.error);

  final List<String> chunks;
  final Object? error;
}

String _event(String text) => 'data: ${jsonEncode({
          'candidates': [
            {
              'content': {
                'parts': [
                  {'text': text}
                ]
              }
            }
          ]
        })}\n\n';

Future<_StreamResult> _collect(AiService service, http.Client client) async {
  final chunks = <String>[];
  Object? failure;
  try {
    await for (final chunk in service.streamMessage(
      conversationHistory: const [],
      newMessage: 'Hello',
      languageName: 'English',
      httpClient: client,
    )) {
      chunks.add(chunk);
    }
  } catch (error) {
    failure = error;
  }
  return _StreamResult(chunks, failure);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FakeSecureStorage().install();
  });

  final service = AiService.instance;

  setUp(() async {
    await service.setUserApiKey('test-only-streaming-key');
  });

  tearDown(() async {
    await service.setUserApiKey(null);
  });

  test('buffered JSON emits no content and reports an error', () async {
    final client = _FakeClient((request) async {
      return http.StreamedResponse(
        Stream.value(utf8.encode('{"candidates":[]}')),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final result = await _collect(service, client);
    expect(result.chunks, isEmpty);
    expect(result.error, isNotNull);
  });

  test('SSE emits chunks incrementally and in order, and stops at DONE',
      () async {
    final source = StreamController<List<int>>();
    final requested = Completer<http.BaseRequest>();
    final firstChunk = Completer<void>();
    final finished = Completer<void>();
    final chunks = <String>[];
    Object? failure;
    final client = _FakeClient((request) async {
      requested.complete(request);
      return http.StreamedResponse(
        source.stream,
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });

    final subscription = service.streamMessage(
      conversationHistory: const [],
      newMessage: 'Hello',
      languageName: 'English',
      httpClient: client,
    ).listen((chunk) {
      chunks.add(chunk);
      if (!firstChunk.isCompleted) firstChunk.complete();
    }, onError: (Object error) {
      failure = error;
    }, onDone: () {
      if (!finished.isCompleted) finished.complete();
    });

    try {
      final request =
          await requested.future.timeout(const Duration(seconds: 3));
      expect(request.method, 'POST');
      expect(request.url.path, endsWith(':streamGenerateContent'));
      expect(request.url.queryParameters['alt'], 'sse');
      final first = utf8.encode(_event('أهلاً'));
      source.add(first.sublist(0, first.length ~/ 2));
      source.add(first.sublist(first.length ~/ 2));
      await firstChunk.future.timeout(const Duration(seconds: 3));
      expect(chunks, ['أهلاً']);
      source.add(utf8.encode(_event(' there')));
      source.add(utf8.encode(_event('!')));
      source.add(utf8.encode('data: [DONE]\n\n${_event('ignored')}'));
      await source.close();
      await finished.future.timeout(const Duration(seconds: 3));
      expect(failure, isNull);
      expect(chunks, ['أهلاً', ' there', '!']);
    } finally {
      if (!source.isClosed) await source.close();
      await subscription.cancel();
      client.close();
    }
  });

  test('HTTP 500 reports an error without emitting model content', () async {
    final client = _FakeClient((request) async {
      return http.StreamedResponse(
        Stream.value(utf8.encode('provider failure')),
        500,
        headers: {'content-type': 'text/event-stream'},
      );
    });
    final result = await _collect(service, client);
    expect(result.chunks, isEmpty);
    expect(result.error, isNotNull);
  });

  test('network errors are reported without emitting model content', () async {
    final client = _FakeClient((request) async {
      throw http.ClientException('simulated socket failure');
    });
    final result = await _collect(service, client);
    expect(result.chunks, isEmpty);
    expect(result.error, isNotNull);
  });
}
