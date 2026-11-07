import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

/// Fake backend gateway recording requests and replaying canned results.
class _FakeGateway implements AiBackendGateway {
  Object? postResult;
  ApiException? postError;
  Stream<String> streamResult = const Stream.empty();
  String? lastPath;
  Object? lastBody;

  @override
  Future<Object?> post(String path, {Object? body}) async {
    lastPath = path;
    lastBody = body;
    final failure = postError;
    if (failure != null) throw failure;
    return postResult;
  }

  @override
  Stream<String> postEventStream(
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 60),
  }) {
    lastPath = path;
    lastBody = body;
    return streamResult;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('BackendAiTransport.chat', () {
    test('posts the conversation to the proxy and returns the reply', () async {
      final gateway = _FakeGateway()..postResult = {'reply': '  Plan ready  '};
      final transport = BackendAiTransport(gateway);
      final reply = await transport.chat(
        history: const [
          ChatMessage(role: 'user', text: 'Hi'),
          ChatMessage(role: 'model', text: 'Hello'),
        ],
        message: 'Plan my day',
        languageName: 'Arabic',
        mode: AiReplyMode.chat,
      );
      expect(reply, 'Plan ready');
      expect(gateway.lastPath, 'ai/chat');
      final body = gateway.lastBody! as Map<String, Object?>;
      expect(body['language'], 'Arabic');
      expect(body['mode'], 'chat');
      expect(body['messages'], [
        {'role': 'user', 'text': 'Hi'},
        {'role': 'model', 'text': 'Hello'},
        {'role': 'user', 'text': 'Plan my day'},
      ]);
    });

    test('maps backend quota and auth failures to transport codes', () async {
      final gateway = _FakeGateway()
        ..postError = const ApiException(
          statusCode: 429,
          code: 'RATE_LIMITED',
          message: 'slow down',
        );
      final transport = BackendAiTransport(gateway);
      await expectLater(
        transport.chat(
          history: const [],
          message: 'Hi',
          languageName: 'English',
          mode: AiReplyMode.chat,
        ),
        throwsA(predicate((Object e) =>
            e is AiTransportException && e.code == 'quota_exceeded')),
      );

      gateway.postError = const ApiException(
        statusCode: 401,
        code: 'UNAUTHENTICATED',
        message: 'sign in',
      );
      await expectLater(
        transport.chat(
          history: const [],
          message: 'Hi',
          languageName: 'English',
          mode: AiReplyMode.chat,
        ),
        throwsA(predicate((Object e) =>
            e is AiTransportException && e.code == 'unauthenticated')),
      );
    });

    test('a reply-less success payload is an empty response, never text',
        () async {
      final gateway = _FakeGateway()..postResult = {'unexpected': true};
      final transport = BackendAiTransport(gateway);
      await expectLater(
        transport.chat(
          history: const [],
          message: 'Hi',
          languageName: 'English',
          mode: AiReplyMode.brief,
        ),
        throwsA(predicate((Object e) =>
            e is AiTransportException && e.code == 'empty_response')),
      );
    });
  });

  group('BackendAiTransport.chatStream', () {
    test('yields text events and stops at DONE', () async {
      final gateway = _FakeGateway()
        ..streamResult = Stream.fromIterable([
          jsonEncode({'text': 'One '}),
          jsonEncode({'text': 'two'}),
          '[DONE]',
          jsonEncode({'text': 'ignored'}),
        ]);
      final transport = BackendAiTransport(gateway);
      final chunks = await transport.chatStream(
        history: const [],
        message: 'Hi',
        languageName: 'English',
      ).toList();
      expect(chunks, ['One ', 'two']);
      expect(gateway.lastPath, 'ai/chat/stream');
    });

    test('an error event fails the stream', () async {
      final gateway = _FakeGateway()
        ..streamResult = Stream.fromIterable([
          jsonEncode({'text': 'partial'}),
          jsonEncode({'error': 'stream_failed'}),
        ]);
      final transport = BackendAiTransport(gateway);
      await expectLater(
        transport.chatStream(
          history: const [],
          message: 'Hi',
          languageName: 'English',
        ).toList(),
        throwsA(predicate((Object e) =>
            e is AiTransportException && e.code == 'stream_failed')),
      );
    });

    test('a stream with no text is an empty response', () async {
      final gateway = _FakeGateway()
        ..streamResult = Stream.fromIterable(['[DONE]']);
      final transport = BackendAiTransport(gateway);
      await expectLater(
        transport.chatStream(
          history: const [],
          message: 'Hi',
          languageName: 'English',
        ).toList(),
        throwsA(predicate((Object e) =>
            e is AiTransportException && e.code == 'empty_response')),
      );
    });
  });
}
