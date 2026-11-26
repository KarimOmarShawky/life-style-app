import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_age_confirmation.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_memory_client.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_memory_screen.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_settings_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';
import 'package:lifestyle_mobile/features/ai/data/chat_history_store.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_assistant_screen.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

AppUser user(String id) => AppUser.fromJson({
  'id': id,
  'email': '$id@example.test',
  'displayName': id,
  'timezone': 'UTC',
  'locale': 'en',
  'defaultCurrency': 'USD',
  'status': 'active',
  'productEventsEnabled': false,
});

class SwitchingAuth extends AuthController {
  int generation = 0;
  @override
  int get sessionGeneration => generation;
  @override
  bool sessionIsCurrent(String account, int expected) =>
      generation == expected && activeAccount == account;
  @override
  Future<AppUser?> build() async => user('a');

  void change(String? id) {
    generation++;
    ref.read(authTransitionSignalProvider.notifier).state++;
    state = AsyncData(id == null ? null : user(id));
  }
}

class Settings implements AiSettingsClient {
  static const value = AiSettingsSnapshot(
    consentVersion: 1,
    currentConsentVersion: 1,
    available: true,
    memoryEnabled: true,
    explicitMemoryEnabled: true,
  );
  @override
  Future<AiSettingsSnapshot> fetch() async => value;
  @override
  Future<AiSettingsSnapshot> grantConsent() async => value;
  @override
  Future<AiSettingsSnapshot> withdrawConsent() async => value;
  @override
  Future<AiSettingsSnapshot> setMemoryEnabled(bool enabled) async => value;
}

class Gateway implements AiBackendGateway {
  final calls = <Object?>[];
  final controller = StreamController<String>.broadcast();
  @override
  Future<Object?> post(String path, {Object? body}) async => null;
  @override
  Stream<String> postEventStream(
    String path, {
    Object? body,
    required Duration timeout,
  }) {
    calls.add(body);
    return controller.stream;
  }
}

class FallbackGateway implements AiBackendGateway {
  FallbackGateway(this.onFirst);
  final void Function() onFirst;
  final paths = <String>[];
  @override
  Future<Object?> post(String path, {Object? body}) async => null;
  @override
  Stream<String> postEventStream(
    String path, {
    Object? body,
    required Duration timeout,
  }) async* {
    paths.add(path);
    onFirst();
    throw const ApiException(
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'missing',
    );
  }
}

class SessionStreamHttpClient extends http.BaseClient {
  final calls = <Object?>[];
  final controllers = <StreamController<List<int>>>[];
  final sent = Completer<void>();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final body = (request as http.Request).body;
    calls.add(jsonDecode(body));
    final controller = StreamController<List<int>>.broadcast();
    controllers.add(controller);
    if (!sent.isCompleted) sent.complete();
    return http.StreamedResponse(
      controller.stream,
      200,
      headers: {'content-type': 'text/event-stream'},
    );
  }
}

class ObservedSessionHttpClient extends http.BaseClient {
  int sends = 0;
  final listening = Completer<void>();
  late final StreamController<List<int>> response =
      StreamController<List<int>>.broadcast(onListen: () {
        if (!listening.isCompleted) listening.complete();
      });

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    sends++;
    return http.StreamedResponse(response.stream, 200,
        headers: {'content-type': 'text/event-stream'});
  }
}

// Synthetic response used to observe cancellation at each public stream layer.
class CancellationTraceHttpClient extends http.BaseClient {
  CancellationTraceHttpClient({required this.failOnCancel});

  final bool failOnCancel;
  final listening = Completer<void>();
  final events = <String>[];
  int sends = 0;
  late final StreamController<List<int>> response = StreamController<List<int>>(
    onListen: () {
      events.add('response listening');
      if (!listening.isCompleted) listening.complete();
    },
    onCancel: () {
      events.add('response onCancel');
      if (failOnCancel) {
        return Future<void>.error(StateError('synthetic response cancel failure'));
      }
      return Future<void>.value();
    },
  );

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    sends++;
    events.add('request sent');
    return http.StreamedResponse(response.stream, 200,
        headers: {'content-type': 'text/event-stream'});
  }

  @override
  void close() {
    events.add('client close');
    super.close();
  }
}

class FallbackHttpClient extends http.BaseClient {
  FallbackHttpClient(this.onResponseBody);
  final void Function() onResponseBody;
  final paths = <String>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    paths.add(request.url.path.replaceFirst(RegExp(r'^/'), ''));
    Stream<List<int>> responseBody() async* {
      onResponseBody();
      yield utf8.encode('{}');
    }

    return http.StreamedResponse(responseBody(), 404);
  }
}

class RecordingMemory implements AiMemoryClient {
  final created = <String>[];
  @override
  Future<AiMemoryList> list() async =>
      const AiMemoryList(items: [], available: true);
  @override
  Future<AiMemory> create({
    required AiMemoryKind kind,
    required String content,
  }) async {
    created.add(content);
    return AiMemory(id: '1', kind: kind, content: content);
  }

  @override
  Future<AiMemory> update(
    String id, {
    required AiMemoryKind kind,
    required String content,
  }) async => AiMemory(id: id, kind: kind, content: content);
  @override
  Future<void> delete(String id) async {}
  @override
  Future<int> deleteAll() async => 0;
}

class DelayedTokens implements SessionBoundTokenStore {
  final started = Completer<void>();
  final result = Completer<SessionTokens?>();

  @override
  Future<SessionTokens?> read() => result.future;

  @override
  Future<SessionTokens?> readForSession(bool Function() isCurrent) async {
    if (!isCurrent()) throw const StaleCredentialOperation();
    if (!started.isCompleted) started.complete();
    final tokens = await result.future;
    if (!isCurrent()) throw const StaleCredentialOperation();
    return tokens;
  }

  @override
  Future<void> write(SessionTokens tokens) async {}
  @override
  Future<void> clear() async {}
  @override
  Future<void> writeForSession(SessionTokens tokens, bool Function() isCurrent) =>
      throw UnimplementedError('Not needed by these tests');
  @override
  Future<void> clearForSession(bool Function() isCurrent) =>
      throw UnimplementedError('Not needed by these tests');
  @override
  Future<bool> clearIfMatches(SessionTokens expected, bool Function() isCurrent) =>
      throw UnimplementedError('Not needed by these tests');
  @override
  Future<bool> replaceIfMatches(SessionTokens expected, SessionTokens replacement,
          bool Function() isCurrent) =>
      throw UnimplementedError('Not needed by these tests');
}

class UnboundTokens implements TokenStore {
  int reads = 0;
  @override
  Future<SessionTokens?> read() async {
    reads++;
    return null;
  }
  @override
  Future<void> write(SessionTokens tokens) async {}
  @override
  Future<void> clear() async {}
}

class RecordingClient extends http.BaseClient {
  int sends = 0;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    sends++;
    return http.StreamedResponse(
      const Stream.empty(),
      200,
      headers: {'content-type': 'text/event-stream'},
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('account keys isolate history and never touch legacy data', () async {
    const legacy = '[{"role":"user","text":"legacy"}]';
    SharedPreferences.setMockInitialValues({
      ChatHistoryStore.storageKey: legacy,
    });
    final store = ChatHistoryStore();
    await store.save('a', [const ChatMessage(role: 'user', text: 'A private')]);
    expect(await store.load('b'), isEmpty);
    expect(await store.load('new'), isEmpty);
    expect((await store.load('a')).single.text, 'A private');
    await store.clear('b');
    expect((await store.load('a')).single.text, 'A private');
    expect(
      (await SharedPreferences.getInstance()).getString(
        ChatHistoryStore.storageKey,
      ),
      legacy,
    );
  });

  for (final layer in ['api', 'transport', 'service']) {
    for (final stale in [false, true]) {
      for (final failOnCancel in [false, true]) {
        test('cancellation layers: $layer stale=$stale cancelError=$failOnCancel',
            () async {
          final tokens = DelayedTokens();
          tokens.result.complete(SessionTokens(
            accessToken: 'synthetic',
            refreshToken: 'synthetic',
            accessTokenExpiresAt: DateTime.utc(2030),
            refreshTokenExpiresAt: DateTime.utc(2030),
          ));
          final httpClient = CancellationTraceHttpClient(
            failOnCancel: failOnCancel,
          );
          final api = ApiClient(
            baseUri: Uri.parse('https://example.test/'),
            tokenStore: tokens,
            eventStreamClientFactory: () => httpClient,
          );
          addTearDown(api.close);
          var valid = true;
          final transport = BackendAiTransport(ApiClientAiGateway(api));
          final Stream<String> source;
          if (layer == 'api') {
            source = api.postEventStream(
              'ai/assistant/turn/stream',
              body: const {'message': 'synthetic'},
              sessionIsCurrent: () => valid,
            );
          } else if (layer == 'transport') {
            source = transport.assistantTurnStream(
              history: const [],
              message: 'synthetic',
              clientLocale: 'en',
              languageName: 'English',
              contextScopes: const [],
              sessionIsCurrent: () => valid,
            );
          } else {
            source = AiService.forTesting(transport: transport).streamAssistantTurn(
              conversationHistory: const [],
              newMessage: 'synthetic',
              clientLocale: 'en',
              sessionIsCurrent: () => valid,
            );
          }
          final listenerErrors = <Object>[];
          final subscription = source.listen((_) {},
              onError: (Object error, StackTrace stack) {
            httpClient.events.add('listener error: $error\n$stack');
            listenerErrors.add(error);
          });
          await httpClient.listening.future.timeout(const Duration(seconds: 5));
          if (stale) valid = false;
          httpClient.events.add('cancel invoked');
          final result = Completer<(Object?, StackTrace?)>();
          subscription.cancel().then((_) {
            httpClient.events.add('cancel completed');
            result.complete((null, null));
          }, onError: (Object error, StackTrace stack) {
            httpClient.events.add('cancel error: $error\n$stack');
            result.complete((error, stack));
          });
          await Future<void>.delayed(const Duration(milliseconds: 200));
          httpClient.events.add('cancel completed with response open: ${result.isCompleted}');
          httpClient.events.add('response close requested');
          final closing = httpClient.response.close();
          print('CANCELLATION LAYERS $layer stale=$stale cancelError=$failOnCancel before close wait\n'
              '${httpClient.events.join('\n')}');
          final (error, stack) = await result.future.timeout(const Duration(seconds: 5));
          await closing.timeout(const Duration(seconds: 5));
          httpClient.events.add('response close completed');
          print('CANCELLATION LAYERS $layer stale=$stale cancelError=$failOnCancel\n'
              '${httpClient.events.join('\n')}');
          expect(httpClient.sends, 1);
          expect(listenerErrors, isEmpty);
          if (error != null &&
              (!failOnCancel ||
                  error is! StateError ||
                  error.message != 'synthetic response cancel failure')) {
            Error.throwWithStackTrace(error, stack!);
          }
          if (failOnCancel) {
            expect(error, isA<StateError>(),
                reason: 'The synthetic cancellation failure must remain visible');
            expect(stack, isNotNull);
          }
        });
      }
    }
  }

  test('contract: active stale listener rejects late response', () async {
    final tokens = DelayedTokens();
    tokens.result.complete(SessionTokens(
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    ));
    final httpClient = ObservedSessionHttpClient();
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      eventStreamClientFactory: () => httpClient,
    );
    addTearDown(api.close);
    addTearDown(() async {
      if (!httpClient.response.isClosed) await httpClient.response.close();
    });
    final service = AiService.forTesting(
      transport: BackendAiTransport(ApiClientAiGateway(api)),
    );
    var valid = true;
    final chunks = <String>[];
    final errors = <Object>[];
    final done = Completer<void>();
    service.streamAssistantTurn(
      conversationHistory: const [],
      newMessage: 'synthetic',
      clientLocale: 'en',
      sessionIsCurrent: () => valid,
    ).listen(chunks.add, onError: (Object error, StackTrace stack) {
      errors.add(error);
    }, onDone: () => done.complete());
    await httpClient.listening.future.timeout(const Duration(seconds: 5));
    valid = false;
    httpClient.response.add(utf8.encode('data: {"text":"old private"}\n\n'));
    await httpClient.response.close();
    await done.future.timeout(const Duration(seconds: 5));
    expect(chunks, isEmpty);
    expect(errors, hasLength(1));
    expect(errors.single, isA<AiStreamingException>()
        .having((error) => error.code, 'code', 'unauthenticated'));
    expect(httpClient.sends, 1, reason: 'No new request after the switch');
  });

  test('contract: deliberate cancel after session change completes quietly', () async {
    final tokens = DelayedTokens();
    tokens.result.complete(SessionTokens(
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    ));
    final httpClient = ObservedSessionHttpClient();
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      eventStreamClientFactory: () => httpClient,
    );
    addTearDown(api.close);
    addTearDown(() async {
      if (!httpClient.response.isClosed) await httpClient.response.close();
    });
    final service = AiService.forTesting(
      transport: BackendAiTransport(ApiClientAiGateway(api)),
    );
    var valid = true;
    final errors = <Object>[];
    final subscription = service.streamAssistantTurn(
      conversationHistory: const [],
      newMessage: 'synthetic',
      clientLocale: 'en',
      sessionIsCurrent: () => valid,
    ).listen((_) {}, onError: (Object error) => errors.add(error));
    print('CANCEL CONTRACT before response listener wait');
    await httpClient.listening.future.timeout(const Duration(seconds: 5));
    print('CANCEL CONTRACT response listener active');
    valid = false;
    print('CANCEL CONTRACT before subscription.cancel');
    try {
      await subscription.cancel().timeout(const Duration(seconds: 5));
      print('CANCEL CONTRACT subscription.cancel completed');
    } catch (error, stackTrace) {
      print('CANCEL CONTRACT subscription.cancel failed: $error');
      print(stackTrace);
      rethrow;
    }
    expect(errors, isEmpty);
    expect(httpClient.sends, 1);
  });

  test('stage 0b: observe cancel before and after fake response closes', () async {
    final tokens = DelayedTokens();
    tokens.result.complete(SessionTokens(
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    ));
    final httpClient = ObservedSessionHttpClient();
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      eventStreamClientFactory: () => httpClient,
    );
    addTearDown(api.close);
    addTearDown(() async {
      if (!httpClient.response.isClosed) await httpClient.response.close();
    });
    final service = AiService.forTesting(
      transport: BackendAiTransport(ApiClientAiGateway(api)),
    );
    var valid = true;
    final errors = <Object>[];
    final subscription = service.streamAssistantTurn(
      conversationHistory: const [],
      newMessage: 'synthetic',
      clientLocale: 'en',
      sessionIsCurrent: () => valid,
    ).listen((_) {}, onError: (Object error) => errors.add(error));
    await httpClient.listening.future.timeout(const Duration(seconds: 5));
    valid = false;
    final clock = Stopwatch()..start();
    final result = Completer<(Object?, StackTrace?)>();
    subscription.cancel().then((_) {
      print('STAGE 0B cancel success at ${clock.elapsedMilliseconds} ms');
      result.complete((null, null));
    }, onError: (Object error, StackTrace stack) {
      print('STAGE 0B cancel error at ${clock.elapsedMilliseconds} ms: $error');
      print(stack);
      result.complete((error, stack));
    });
    await Future<void>.delayed(const Duration(milliseconds: 100));
    print('STAGE 0B cancel completed before response close: ${result.isCompleted}');
    print('STAGE 0B closing fake response at ${clock.elapsedMilliseconds} ms');
    final closing = httpClient.response.close();
    final (error, stack) = await result.future.timeout(const Duration(seconds: 5));
    await closing.timeout(const Duration(seconds: 5));
    if (error != null) Error.throwWithStackTrace(error, stack!);
    expect(errors, isEmpty);
    expect(httpClient.sends, 1);
  });

  test('diagnostic: cancelling a stream after session change', () async {
    final tokens = DelayedTokens();
    tokens.result.complete(SessionTokens(
      accessToken: 'synthetic',
      refreshToken: 'synthetic',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    ));
    final gateway = SessionStreamHttpClient();
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      eventStreamClientFactory: () => gateway,
    );
    addTearDown(api.close);
    addTearDown(() async {
      for (final controller in gateway.controllers) {
        if (!controller.isClosed) await controller.close();
      }
    });
    final service = AiService.forTesting(
      transport: BackendAiTransport(ApiClientAiGateway(api)),
    );
    var valid = true;
    final errors = <Object>[];
    final subscription = service
        .streamAssistantTurn(
          conversationHistory: const [],
          newMessage: 'synthetic',
          clientLocale: 'en',
          sessionIsCurrent: () => valid,
        )
        .listen((_) {}, onError: (Object error) {
          print('DIAGNOSTIC listener onError: $error');
          errors.add(error);
        });
    await gateway.sent.future;
    print('DIAGNOSTIC request sent');
    valid = false;
    print('DIAGNOSTIC before subscription.cancel');
    try {
      await subscription.cancel();
      print('DIAGNOSTIC subscription.cancel completed');
    } catch (error, stackTrace) {
      print('DIAGNOSTIC subscription.cancel threw: $error');
      print(stackTrace);
      rethrow;
    }
    print('DIAGNOSTIC before response controller close');
    await gateway.controllers.single.close();
    print('DIAGNOSTIC response controller close completed');
    expect(gateway.calls, hasLength(1));
    expect(errors, isEmpty);
  });

  test(
    'credential read pending during switch cannot dispatch old context',
    () async {
      final tokens = DelayedTokens();
      final httpClient = RecordingClient();
      final client = ApiClient(
        baseUri: Uri.parse('https://example.test/'),
        tokenStore: tokens,
        eventStreamClientFactory: () => httpClient,
      );
      addTearDown(client.close);
      var valid = true;
      final pending =
          client
              .postEventStream(
                'ai/assistant/turn/stream',
                body: {'conversation': 'account A history'},
                sessionIsCurrent: () => valid,
              )
              .toList();
      final rejected = expectLater(
        pending,
        throwsA(
          isA<ApiException>().having((e) => e.code, 'code', 'SESSION_CHANGED'),
        ),
      );
      await tokens.started.future;
      valid = false;
      tokens.result.complete(
        SessionTokens(
          accessToken: 'b',
          refreshToken: 'b',
          accessTokenExpiresAt: DateTime.utc(2030),
          refreshTokenExpiresAt: DateTime.utc(2030),
        ),
      );
      await rejected;
      expect(httpClient.sends, 0);
    },
  );

  test('A4: session-bound stream rejects an unbound token store', () async {
    final tokens = UnboundTokens();
    final httpClient = RecordingClient();
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      eventStreamClientFactory: () => httpClient,
    );
    addTearDown(api.close);
    await expectLater(
      api.postEventStream('ai/assistant/turn/stream',
          sessionIsCurrent: () => true).toList(),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'SESSION_CHANGED')),
    );
    expect(tokens.reads, 0);
    expect(httpClient.sends, 0);
  });

  test('A4: session-bound stream rejects an unguarded gateway', () async {
    final gateway = FallbackGateway(() {});
    final service = AiService.forTesting(transport: BackendAiTransport(gateway));
    await expectLater(
      service.streamAssistantTurn(
        conversationHistory: const [],
        newMessage: 'synthetic',
        clientLocale: 'en',
        sessionIsCurrent: () => true,
      ).toList(),
      throwsA(isA<AiStreamingException>()
          .having((error) => error.code, 'code', 'unauthenticated')),
    );
    expect(gateway.paths, isEmpty);
  });

  test('404 fallback cannot send old history after a transition', () async {
    var valid = true;
    final tokens = DelayedTokens();
    tokens.result.complete(SessionTokens(
      accessToken: 'a',
      refreshToken: 'a',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    ));
    final httpClient = FallbackHttpClient(() => valid = false);
    final api = ApiClient(
      baseUri: Uri.parse('https://example.test/'),
      tokenStore: tokens,
      eventStreamClientFactory: () => httpClient,
    );
    addTearDown(api.close);
    final transport = BackendAiTransport(ApiClientAiGateway(api));
    await expectLater(
      transport
          .assistantTurnStream(
            history: const [
              ChatMessage(role: 'user', text: 'private'),
              ChatMessage(role: 'model', text: 'reply'),
            ],
            message: 'next',
            clientLocale: 'en',
            languageName: 'English',
            sessionIsCurrent: () => valid,
          )
          .toList(),
      throwsA(isA<AiTransportException>()),
    );
    expect(httpClient.paths, ['ai/assistant/turn/stream']);
  });

  test(
    'memory create rejects a session switch during credential read',
    () async {
      final tokens = DelayedTokens();
      var sends = 0;
      final httpClient = MockClient((request) async {
        sends++;
        return http.Response('{}', 200);
      });
      final api = ApiClient(
        baseUri: Uri.parse('https://example.test/'),
        tokenStore: tokens,
        httpClient: httpClient,
      );
      addTearDown(api.close);
      var valid = true;
      final pending = ApiAiMemoryClient(api).createForSession(
        kind: AiMemoryKind.fact,
        content: 'account A private',
        sessionIsCurrent: () => valid,
      );
      final rejected = expectLater(
        pending,
        throwsA(
          isA<ApiException>().having((e) => e.code, 'code', 'SESSION_CHANGED'),
        ),
      );
      await tokens.started.future;
      valid = false;
      tokens.result.complete(
        SessionTokens(
          accessToken: 'b',
          refreshToken: 'b',
          accessTokenExpiresAt: DateTime.utc(2030),
          refreshTokenExpiresAt: DateTime.utc(2030),
        ),
      );
      await rejected;
      expect(sends, 0);
    },
  );

  test(
    'age confirmation guard stops stale writes; an already submitted write is not atomic',
    () async {
      SharedPreferences.setMockInitialValues({});
      await AiAgeConfirmationStore.confirm('a', sessionIsCurrent: () => false);
      expect(await AiAgeConfirmationStore.isConfirmed('a'), isFalse);
      var current = true;
      await AiAgeConfirmationStore.confirm(
        'a',
        sessionIsCurrent: () {
          // The session can change immediately after the last check; storage cannot
          // atomically cancel the already-authorized per-account operation.
          final wasCurrent = current;
          current = false;
          return wasCurrent;
        },
      );
      expect(current, isFalse);
      expect(await AiAgeConfirmationStore.isConfirmed('a'), isTrue);
      expect(await AiAgeConfirmationStore.isConfirmed('b'), isFalse);
    },
  );

  testWidgets('memory editor result from A is rejected after switching to B', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final memories = RecordingMemory();
    final container = ProviderContainer(
      overrides: [
        authProvider.overrideWith(SwitchingAuth.new),
        aiSettingsClientProvider.overrideWithValue(Settings()),
        aiMemoryClientProvider.overrideWithValue(memories),
      ],
    );
    addTearDown(container.dispose);
    await container.read(authProvider.future);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: AiMemoryScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('ai-memory-add')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('ai-memory-field')),
      'A private draft',
    );
    await tester.pump();
    (container.read(authProvider.notifier) as SwitchingAuth).change('b');
    await tester.pump();
    expect(find.byKey(const ValueKey('ai-memory-field')), findsNothing);
    expect(find.text('A private draft'), findsNothing);
    await tester.pumpAndSettle();
    expect(memories.created, isEmpty);
    await tester.tap(find.byKey(const ValueKey('ai-memory-add')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();
    (container.read(authProvider.notifier) as SwitchingAuth).change('a');
    await tester.pumpAndSettle();
    expect(memories.created, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'switching accounts hides stale history and restores it on return',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        ChatHistoryStore.keyForAccount('a'): jsonEncode([
          {'role': 'user', 'text': 'A private'},
          {'role': 'model', 'text': 'A reply'},
        ]),
        'ai_age_confirmed.v1.a': true,
        'ai_age_confirmed.v1.b': true,
      });
      final tokens = DelayedTokens();
      tokens.result.complete(SessionTokens(
        accessToken: 'synthetic',
        refreshToken: 'synthetic',
        accessTokenExpiresAt: DateTime.utc(2030),
        refreshTokenExpiresAt: DateTime.utc(2030),
      ));
      final gateway = SessionStreamHttpClient();
      final api = ApiClient(
        baseUri: Uri.parse('https://example.test/'),
        tokenStore: tokens,
        eventStreamClientFactory: () => gateway,
      );
      AiService.bindGateway(ApiClientAiGateway(api));
      addTearDown(api.close);
      AiService.instance.resetFailureCount();
      final container = ProviderContainer(
        overrides: [
          authProvider.overrideWith(SwitchingAuth.new),
          aiSettingsClientProvider.overrideWithValue(Settings()),
        ],
      );
      addTearDown(container.dispose);
      addTearDown(() async {
        for (final controller in gateway.controllers) {
          if (!controller.isClosed) await controller.close();
        }
      });
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            locale: Locale('en'),
            localizationsDelegates: [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            supportedLocales: AppLocalizations.supportedLocales,
            home: AiAssistantScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('A private'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'question from a');
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();
      await tester.pump();
      expect(gateway.calls, hasLength(1));
      final auth = container.read(authProvider.notifier) as SwitchingAuth;
      auth.change(null);
      await tester.pumpAndSettle();
      expect(find.text('A private'), findsNothing);
      auth.change('b');
      await tester.pumpAndSettle();
      gateway.controllers.first.add(
        utf8.encode('data: {"text":"stale answer from A"}\n\n'),
      );
      await tester.pump();
      expect(find.text('A private'), findsNothing);
      expect(find.text('stale answer from A'), findsNothing);
      await tester.enterText(find.byType(TextField), 'question from b');
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();
      await tester.pump();
      expect(gateway.calls, hasLength(2));
      expect(jsonEncode(gateway.calls.last), isNot(contains('A private')));
      expect(jsonEncode(gateway.calls.last), isNot(contains('A reply')));
      auth.change('a');
      await tester.pumpAndSettle();
      expect(find.text('A private'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      final closed = Future.wait(
        gateway.controllers.map((controller) => controller.close()),
      );
      await tester.pump();
      await closed;
      await tester.pump();
    },
  );
}
