import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

import 'ai_history_account_isolation_test.dart' show DelayedTokens;

const _limit = Duration(seconds: 5);

SessionTokens _tokens() => SessionTokens(
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    );

class _Client extends http.BaseClient {
  _Client({this.delayed = false});

  final bool delayed;
  final started = Completer<void>();
  final response = Completer<http.StreamedResponse>();
  final paths = <String>[];
  int closes = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    paths.add(request.url.path);
    if (!started.isCompleted) started.complete();
    if (delayed) return response.future;
    return Future.value(http.StreamedResponse(
      Stream<List<int>>.empty(),
      200,
      headers: const {'content-type': 'text/event-stream'},
    ));
  }

  @override
  void close() {
    closes++;
    super.close();
  }
}

class _Gateway implements AiBackendGateway {
  final firstListening = Completer<void>();
  final firstCancelled = Completer<void>();
  final paths = <String>[];
  late final StreamController<String> first = StreamController<String>(
    onListen: () => firstListening.complete(),
    onCancel: () {
      if (!firstCancelled.isCompleted) firstCancelled.complete();
    },
  );

  @override
  Future<Object?> post(String path, {Object? body}) =>
      Future<Object?>.error(StateError('Unexpected non-stream request'));

  @override
  Stream<String> postEventStream(String path,
      {Object? body, required Duration timeout}) {
    paths.add(path);
    if (paths.length == 1) return first.stream;
    return Stream<String>.fromIterable(['{"text":"fallback"}', '[DONE]']);
  }
}

Stream<String> _turn(BackendAiTransport transport) =>
    transport.assistantTurnStream(
      history: const [],
      message: 'synthetic',
      clientLocale: 'en',
      languageName: 'English',
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('API: cancel during credentials prevents a subsequent send', () async {
    final tokens = DelayedTokens();
    final requestClient = _Client();
    final sharedClient = _Client();
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      httpClient: sharedClient,
      eventStreamClientFactory: () => requestClient,
    );
    addTearDown(api.close);
    final chunks = <String>[];
    final errors = <Object>[];
    final subscription = api.postEventStream('ai/chat/stream',
        sessionIsCurrent: () => true).listen(chunks.add,
        onError: (Object error) => errors.add(error));
    await tokens.started.future.timeout(_limit,
        onTimeout: () => throw TimeoutException('credentials did not start', _limit));
    final cancellation = subscription.cancel();
    tokens.result.complete(_tokens());
    await expectLater(
      cancellation.timeout(_limit,
          onTimeout: () => throw TimeoutException('API cancellation timed out', _limit)),
      completes,
    );
    expect(requestClient.paths, isEmpty);
    expect(chunks, isEmpty);
    expect(errors, isEmpty);
    expect(requestClient.closes, 1);
    expect(sharedClient.closes, 0);
  });

  test('API: cancel during send rejects a late successful response', () async {
    final tokens = DelayedTokens()..result.complete(_tokens());
    final requestClient = _Client(delayed: true);
    final sharedClient = _Client();
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      httpClient: sharedClient,
      eventStreamClientFactory: () => requestClient,
    );
    addTearDown(api.close);
    var bodyListened = false;
    var bodyCancelled = false;
    final body = StreamController<List<int>>.broadcast(
      onListen: () => bodyListened = true,
      onCancel: () => bodyCancelled = true,
    );
    addTearDown(() async {
      if (!body.isClosed) {
        await body.close().timeout(_limit,
            onTimeout: () => throw TimeoutException('late body close timed out', _limit));
      }
    });
    final chunks = <String>[];
    final errors = <Object>[];
    final subscription = api.postEventStream('ai/chat/stream',
        sessionIsCurrent: () => true).listen(chunks.add,
        onError: (Object error) => errors.add(error));
    await requestClient.started.future.timeout(_limit,
        onTimeout: () => throw TimeoutException('send did not start', _limit));
    final cancellation = subscription.cancel();
    requestClient.response.complete(http.StreamedResponse(body.stream, 200,
        headers: const {'content-type': 'text/event-stream'}));
    await expectLater(
      cancellation.timeout(_limit,
          onTimeout: () => throw TimeoutException('API cancellation timed out', _limit)),
      completes,
    );
    expect(requestClient.paths, hasLength(1));
    expect(chunks, isEmpty);
    expect(errors, isEmpty);
    expect(requestClient.closes, 1);
    expect(sharedClient.closes, 0);
    expect(body.hasListener, isFalse);
    if (bodyListened) expect(bodyCancelled, isTrue);
  });

  test('transport: cancellation reaches an open gateway stream', () async {
    final gateway = _Gateway();
    addTearDown(() async {
      if (!gateway.first.isClosed) {
        await gateway.first.close().timeout(_limit,
            onTimeout: () => throw TimeoutException('gateway close timed out', _limit));
      }
    });
    final errors = <Object>[];
    final subscription = _turn(BackendAiTransport(gateway)).listen((_) {},
        onError: (Object error) => errors.add(error));
    await gateway.firstListening.future.timeout(_limit,
        onTimeout: () => throw TimeoutException('gateway listener timed out', _limit));
    await expectLater(
      subscription.cancel().timeout(_limit,
          onTimeout: () => throw TimeoutException('transport cancellation timed out', _limit)),
      completes,
    );
    expect(gateway.first.isClosed, isFalse);
    expect(gateway.firstCancelled.isCompleted, isTrue);
    expect(gateway.paths, ['ai/assistant/turn/stream']);
    expect(errors, isEmpty);
  });

  test('transport: late 404 after cancel does not start fallback', () async {
    final gateway = _Gateway();
    addTearDown(() async {
      if (!gateway.first.isClosed) {
        await gateway.first.close().timeout(_limit,
            onTimeout: () => throw TimeoutException('gateway close timed out', _limit));
      }
    });
    final chunks = <String>[];
    final errors = <Object>[];
    final subscription = _turn(BackendAiTransport(gateway)).listen(chunks.add,
        onError: (Object error) => errors.add(error));
    await gateway.firstListening.future.timeout(_limit,
        onTimeout: () => throw TimeoutException('gateway listener timed out', _limit));
    final cancellation = expectLater(
      subscription.cancel().timeout(_limit,
          onTimeout: () => throw TimeoutException('transport cancellation timed out', _limit)),
      completes,
    );
    gateway.first.addError(const ApiException(
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'synthetic',
    ));
    await gateway.first.close().timeout(_limit,
        onTimeout: () => throw TimeoutException('gateway close timed out', _limit));
    await cancellation;
    expect(gateway.paths, ['ai/assistant/turn/stream']);
    expect(chunks, isEmpty);
    expect(errors, isEmpty);
  });

  test('transport: 404 without cancellation still starts fallback', () async {
    final gateway = _Gateway();
    addTearDown(() async {
      if (!gateway.first.isClosed) {
        await gateway.first.close().timeout(_limit,
            onTimeout: () => throw TimeoutException('gateway close timed out', _limit));
      }
    });
    final result = _turn(BackendAiTransport(gateway)).toList();
    await gateway.firstListening.future.timeout(_limit,
        onTimeout: () => throw TimeoutException('gateway listener timed out', _limit));
    gateway.first.addError(const ApiException(
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'synthetic',
    ));
    await gateway.first.close().timeout(_limit,
        onTimeout: () => throw TimeoutException('gateway close timed out', _limit));
    expect(await result.timeout(_limit,
        onTimeout: () => throw TimeoutException('fallback result timed out', _limit)),
        ['fallback']);
    expect(gateway.paths, ['ai/assistant/turn/stream', 'ai/chat/stream']);
  });
}
