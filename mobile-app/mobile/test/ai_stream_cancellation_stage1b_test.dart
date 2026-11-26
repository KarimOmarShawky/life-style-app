import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

import 'ai_history_account_isolation_test.dart' show DelayedTokens;

const _limit = Duration(seconds: 5);
final _clock = Stopwatch();
void _startTrace(String name) {
  _clock..reset()..start();
  _trace('case start: $name');
}
// ignore: avoid_print
void _trace(String event) => print('STAGE1C +${_clock.elapsedMilliseconds}ms $event');

Future<void> _cancel(StreamSubscription<dynamic> subscription) async {
  _trace('cancel invoked');
  try {
    await subscription.cancel();
  } finally {
    _trace('cancel settled (success or error)');
  }
}

Future<void> _closeBody(StreamController<List<int>> body) async {
  _trace('body close requested');
  try {
    await body.close();
  } finally {
    _trace('body close settled (success or error)');
  }
}

class _TraceTransport extends BackendAiTransport {
  _TraceTransport(super.gateway);

  @override
  Stream<String> chatStream({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    Duration timeout = const Duration(seconds: 60),
    bool Function()? sessionIsCurrent,
  }) {
    _trace('entered chatStream');
    return super.chatStream(history: history, message: message,
        languageName: languageName, timeout: timeout,
        sessionIsCurrent: sessionIsCurrent);
  }
}

Stream<List<int>> _notFoundBody() async* {
  _trace('404 body listening');
  try {
    yield utf8.encode('{}');
  } finally {
    _trace('404 body stream finished or cancelled');
  }
}

SessionTokens _tokens() => SessionTokens(
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    );

class _DelayedSendClient extends http.BaseClient {
  final started = Completer<void>();
  final result = Completer<http.StreamedResponse>();
  final paths = <String>[];
  int closes = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    paths.add(request.url.path);
    _trace('request #${paths.length}: ${request.url.path}');
    if (!started.isCompleted) started.complete();
    if (paths.length > 1) {
      _trace('unexpected additional request: returning a fresh response body');
      return Future.value(http.StreamedResponse(
          Stream<List<int>>.value(utf8.encode('{}')), 200,
          headers: const {'content-type': 'application/json'}));
    }
    return result.future;
  }

  @override
  void close() {
    closes++;
    _trace('request client close #$closes, request count=${paths.length}');
    super.close();
  }
}

class _ResponseClient extends http.BaseClient {
  _ResponseClient({this.cancelFailure});

  final Object? cancelFailure;
  final listening = Completer<void>();
  final cancelled = Completer<void>();
  final paths = <String>[];
  int closes = 0;
  late final StreamController<List<int>> body = StreamController<List<int>>(
    onListen: () {
      _trace('response body listening');
      if (!listening.isCompleted) listening.complete();
    },
    onCancel: () {
      _trace('response body onCancel');
      if (!cancelled.isCompleted) cancelled.complete();
      final failure = cancelFailure;
      if (failure != null) return Future<void>.error(failure);
      return Future<void>.value();
    },
  );

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    paths.add(request.url.path);
    _trace('request #${paths.length}: ${request.url.path}; delivering 200');
    return http.StreamedResponse(body.stream, 200,
        headers: const {'content-type': 'text/event-stream'});
  }

  @override
  void close() {
    closes++;
    _trace('request client close #$closes, request count=${paths.length}');
    super.close();
  }
}

ApiClient _api(DelayedTokens tokens, http.Client Function() factory) => ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      eventStreamClientFactory: factory,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('open response cancellation reaches body and closes its client', () async {
    _startTrace('open response cancellation reaches body and closes its client');
    final tokens = DelayedTokens()..result.complete(_tokens());
    final client = _ResponseClient();
    final api = _api(tokens, () => client);
    addTearDown(api.close);
    addTearDown(() async {
      if (client.listening.isCompleted && !client.body.isClosed) {
        await _closeBody(client.body).timeout(_limit, onTimeout: () => throw TimeoutException('response body close timed out', _limit));
      }
    });
    final sub = api.postEventStream('ai/assistant/turn/stream',
        sessionIsCurrent: () => true).listen((_) {});
    await client.listening.future.timeout(_limit, onTimeout: () => throw TimeoutException('response body listener timed out', _limit));
    await expectLater(_cancel(sub).timeout(_limit, onTimeout: () => throw TimeoutException('cancel did not complete', _limit)), completes);
    expect(client.body.isClosed, isFalse,
        reason: 'The producer must still be open when cancel completes');
    expect(client.cancelled.isCompleted, isTrue);
    expect(client.closes, 1);
  });

  test('response cancellation cleanup failure remains visible', () async {
    _startTrace('response cancellation cleanup failure remains visible');
    final tokens = DelayedTokens()..result.complete(_tokens());
    final failure = StateError('synthetic response cleanup failure');
    final client = _ResponseClient(cancelFailure: failure);
    final api = _api(tokens, () => client);
    addTearDown(api.close);
    addTearDown(() async {
      if (client.listening.isCompleted && !client.body.isClosed) {
        await _closeBody(client.body).timeout(_limit, onTimeout: () => throw TimeoutException('response body close timed out', _limit));
      }
    });
    final sub = api.postEventStream('ai/assistant/turn/stream',
        sessionIsCurrent: () => true).listen((_) {});
    await client.listening.future.timeout(_limit, onTimeout: () => throw TimeoutException('response body listener timed out', _limit));
    await expectLater(_cancel(sub).timeout(_limit, onTimeout: () => throw TimeoutException('cancel did not complete', _limit)), throwsA(same(failure)));
    expect(client.cancelled.isCompleted, isTrue);
    expect(client.closes, 1);
  });

  test('active stale listener rejects chunks without another request', () async {
    final tokens = DelayedTokens()..result.complete(_tokens());
    final client = _ResponseClient();
    final api = _api(tokens, () => client);
    addTearDown(api.close);
    addTearDown(() async {
      if (client.listening.isCompleted && !client.body.isClosed) {
        await _closeBody(client.body).timeout(_limit, onTimeout: () => throw TimeoutException('response body close timed out', _limit));
      }
    });
    var current = true;
    final chunks = <String>[];
    final errors = <Object>[];
    final done = Completer<void>();
    AiService.forTesting(transport: _TraceTransport(ApiClientAiGateway(api)))
        .streamAssistantTurn(
          conversationHistory: const [],
          newMessage: 'synthetic',
          clientLocale: 'en',
          sessionIsCurrent: () => current,
        ).listen(chunks.add, onError: (Object e) => errors.add(e),
            onDone: () => done.complete());
    await client.listening.future.timeout(_limit, onTimeout: () => throw TimeoutException('response body listener timed out', _limit));
    current = false;
    client.body.add(utf8.encode('data: {"text":"old private"}\n\n'));
    await _closeBody(client.body).timeout(_limit, onTimeout: () => throw TimeoutException('response body close timed out', _limit));
    await done.future.timeout(_limit, onTimeout: () => throw TimeoutException('stream done timed out', _limit));
    expect(chunks, isEmpty);
    expect(client.paths, hasLength(1));
    expect(errors, hasLength(1));
    expect(errors.single, isA<AiStreamingException>()
        .having((e) => e.code, 'code', 'unauthenticated'));
  });

  test('deliberate cancellation does not trip breaker or start fallback', () async {
    _startTrace('deliberate cancellation does not trip breaker or start fallback');
    final tokens = DelayedTokens()..result.complete(_tokens());
    final clients = <_ResponseClient>[];
    late Completer<_ResponseClient> created;
    final api = _api(tokens, () {
      final client = _ResponseClient();
      clients.add(client);
      _trace('request client created; total=${clients.length}');
      if (!created.isCompleted) created.complete(client);
      return client;
    });
    addTearDown(api.close);
    addTearDown(() async {
      for (final client in clients) {
        if (client.listening.isCompleted && !client.body.isClosed) {
          await _closeBody(client.body).timeout(_limit, onTimeout: () => throw TimeoutException('response body close timed out', _limit));
        }
      }
    });
    final service = AiService.forTesting(
        transport: _TraceTransport(ApiClientAiGateway(api)));
    for (var i = 0; i < AiService.maxConsecutiveFailures; i++) {
      final errors = <Object>[];
      created = Completer<_ResponseClient>();
      final sub = service.streamAssistantTurn(
        conversationHistory: const [],
        newMessage: 'synthetic',
        clientLocale: 'en',
        sessionIsCurrent: () => true,
      ).listen((_) {}, onError: (Object e) => errors.add(e));
      final client = await created.future.timeout(_limit, onTimeout: () => throw TimeoutException('client creation timed out', _limit));
      expect(clients, hasLength(i + 1));
      await client.listening.future.timeout(_limit, onTimeout: () => throw TimeoutException('response body listener timed out', _limit));
      await expectLater(_cancel(sub).timeout(_limit, onTimeout: () => throw TimeoutException('cancel did not complete', _limit)), completes);
      expect(errors, isEmpty, reason: 'No empty_response on cancellation');
      expect(client.paths, hasLength(1), reason: 'No fallback request');
      expect(client.cancelled.isCompleted, isTrue);
    }
    expect(service.isPaused, isFalse);
  });

  test('stream timeout reports network error and closes request client', () async {
    final tokens = DelayedTokens()..result.complete(_tokens());
    final client = _ResponseClient();
    final api = _api(tokens, () => client);
    addTearDown(api.close);
    addTearDown(() async {
      if (client.listening.isCompleted && !client.body.isClosed) {
        await _closeBody(client.body).timeout(_limit, onTimeout: () => throw TimeoutException('response body close timed out', _limit));
      }
    });
    final result = api.postEventStream('ai/chat/stream',
        timeout: const Duration(milliseconds: 100),
        sessionIsCurrent: () => true).toList();
    await expectLater(result.timeout(_limit, onTimeout: () => throw TimeoutException('stream result timed out', _limit)), throwsA(isA<ApiException>()
        .having((e) => e.code, 'code', 'NETWORK_ERROR')));
    expect(client.closes, 1);
  });

  test('paused stream does not deliver chunks until resumed', () async {
    final tokens = DelayedTokens()..result.complete(_tokens());
    final client = _ResponseClient();
    final api = _api(tokens, () => client);
    addTearDown(api.close);
    addTearDown(() async {
      if (client.listening.isCompleted && !client.body.isClosed) {
        await _closeBody(client.body).timeout(_limit, onTimeout: () => throw TimeoutException('response body close timed out', _limit));
      }
    });
    final chunks = <String>[];
    final first = Completer<void>();
    final done = Completer<void>();
    final sub = api.postEventStream('ai/chat/stream',
        sessionIsCurrent: () => true).listen((chunk) {
      chunks.add(chunk);
      if (!first.isCompleted) first.complete();
    }, onDone: () => done.complete());
    addTearDown(sub.resume);
    await client.listening.future.timeout(_limit, onTimeout: () => throw TimeoutException('response body listener timed out', _limit));
    client.body.add(utf8.encode('data: first\n\n'));
    await first.future.timeout(_limit, onTimeout: () => throw TimeoutException('first chunk timed out', _limit));
    sub.pause();
    client.body.add(utf8.encode('data: second\n\n'));
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(chunks, ['first']);
    sub.resume();
    await _closeBody(client.body).timeout(_limit, onTimeout: () => throw TimeoutException('response body close timed out', _limit));
    await done.future.timeout(_limit, onTimeout: () => throw TimeoutException('stream done timed out', _limit));
    expect(chunks, ['first', 'second']);
  });

  test('cancel during delayed credentials prevents a later request', () async {
    _startTrace('cancel during delayed credentials prevents a later request');
    final tokens = DelayedTokens();
    final httpClient = _DelayedSendClient();
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      eventStreamClientFactory: () => httpClient,
    );
    addTearDown(api.close);
    final chunks = <String>[];
    final errors = <Object>[];
    final sub = AiService.forTesting(
      transport: _TraceTransport(ApiClientAiGateway(api)),
    ).streamAssistantTurn(
      conversationHistory: const [],
      newMessage: 'synthetic',
      clientLocale: 'en',
      sessionIsCurrent: () => true,
    ).listen(chunks.add, onError: (Object error) => errors.add(error));

    await tokens.started.future.timeout(_limit, onTimeout: () => throw TimeoutException('credential read started timed out', _limit));
    final cancelled = expectLater(_cancel(sub), completes);
    _trace('credential completer delivered tokens; request count=${httpClient.paths.length}');
    tokens.result.complete(_tokens());
    await cancelled.timeout(_limit, onTimeout: () => throw TimeoutException('cancel expectation timed out', _limit));
    expect(httpClient.paths, isEmpty);
    expect(chunks, isEmpty);
    expect(errors, isEmpty);
    expect(httpClient.closes, 1);
  });

  test('cancel during delayed send rejects late successful response', () async {
    final tokens = DelayedTokens()..result.complete(_tokens());
    final httpClient = _DelayedSendClient();
    final api = _api(tokens, () => httpClient);
    addTearDown(api.close);
    var bodyListened = false;
    var bodyCancelled = false;
    late final StreamController<List<int>> body;
    body = StreamController<List<int>>.broadcast(
      onListen: () {
        bodyListened = true;
        body.add(utf8.encode('data: {"text":"late private"}\n\n'));
      },
      onCancel: () { bodyCancelled = true; },
    );
    addTearDown(() async {
      if (!body.isClosed) await _closeBody(body).timeout(_limit, onTimeout: () => throw TimeoutException('response body close timed out', _limit));
    });
    final chunks = <String>[];
    final errors = <Object>[];
    final sub = AiService.forTesting(
      transport: _TraceTransport(ApiClientAiGateway(api)),
    ).streamAssistantTurn(
      conversationHistory: const [],
      newMessage: 'synthetic',
      clientLocale: 'en',
      sessionIsCurrent: () => true,
    ).listen(chunks.add, onError: (Object e) => errors.add(e));
    await httpClient.started.future.timeout(_limit, onTimeout: () => throw TimeoutException('request started timed out', _limit));
    final cancelled = expectLater(_cancel(sub), completes);
    _trace('delivering late 200; request count=${httpClient.paths.length}');
    httpClient.result.complete(http.StreamedResponse(body.stream, 200,
        headers: const {'content-type': 'text/event-stream'}));
    // Allow late response callbacks to execute before checking observations.
    await Future<void>.delayed(const Duration(milliseconds: 200));
    await cancelled.timeout(_limit, onTimeout: () => throw TimeoutException('cancel expectation timed out', _limit));
    expect(httpClient.paths, hasLength(1), reason: 'No retry or fallback');
    expect(chunks, isEmpty);
    expect(errors, isEmpty);
    expect(httpClient.closes, 1);
    expect(body.hasListener, isFalse);
    if (bodyListened) expect(bodyCancelled, isTrue);
  });

  test('cancel during delayed send rejects late 404 and fallback', () async {
    _startTrace('cancel during delayed send rejects late 404 and fallback');
    final tokens = DelayedTokens()..result.complete(_tokens());
    final httpClient = _DelayedSendClient();
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      eventStreamClientFactory: () => httpClient,
    );
    addTearDown(api.close);
    final chunks = <String>[];
    final errors = <Object>[];
    final sub = AiService.forTesting(
      transport: _TraceTransport(ApiClientAiGateway(api)),
    ).streamAssistantTurn(
      conversationHistory: const [],
      newMessage: 'synthetic',
      clientLocale: 'en',
      sessionIsCurrent: () => true,
    ).listen(chunks.add, onError: (Object error) => errors.add(error));

    await httpClient.started.future.timeout(_limit, onTimeout: () => throw TimeoutException('request started timed out', _limit));
    final cancelled = expectLater(_cancel(sub), completes);
    _trace('delivering late 404; request count=${httpClient.paths.length}');
    httpClient.result.complete(http.StreamedResponse(
      _notFoundBody(),
      404,
      headers: const {'content-type': 'application/json'},
    ));
    await cancelled.timeout(_limit, onTimeout: () => throw TimeoutException('cancel expectation timed out', _limit));
    expect(httpClient.paths, hasLength(1), reason: 'No retry or fallback');
    expect(chunks, isEmpty);
    expect(errors, isEmpty);
    expect(httpClient.closes, 1);
  });
}
