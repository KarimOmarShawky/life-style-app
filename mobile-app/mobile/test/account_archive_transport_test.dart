// Authored tests; require Flutter SDK. Not executed by WASM/Node source checks.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/core/archive/archive_cancellation.dart';
import 'package:lifestyle_mobile/core/archive/archive_verifier.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'api_client_test.dart' show MemoryTokenStore;

SessionTokens tokens(String access, String refresh) => SessionTokens(
    accessToken: access,
    refreshToken: refresh,
    accessTokenExpiresAt: DateTime.utc(2030),
    refreshTokenExpiresAt: DateTime.utc(2030));
http.StreamedResponse response(Stream<List<int>> bytes,
        [int status = 200, String type = 'application/x-ndjson']) =>
    http.StreamedResponse(bytes, status, headers: {'content-type': type});

class _ArchiveAuth extends AuthController {
  String? account = 'account-a';
  int generation = 0;
  @override
  Future<AppUser?> build() async => null;
  @override
  String? get activeAccount => account;
  @override
  int get sessionGeneration => generation;
  @override
  bool sessionIsCurrent(String expected, int expectedGeneration) =>
      account == expected && generation == expectedGeneration;
  void transition(String? next) { account = next; generation++; }
}

class _DelayedReadTokens extends MemoryTokenStore {
  _DelayedReadTokens(super.tokens);
  final started = Completer<void>();
  final release = Completer<void>();
  @override
  Future<SessionTokens?> readRaw() async {
    started.complete();
    await release.future;
    return tokens;
  }
}

class _UnsupportedTokens implements TokenStore {
  var reads = 0;
  @override
  Future<SessionTokens?> read() async { reads++; return tokens('a', 'r'); }
  @override
  Future<void> write(SessionTokens value) async {}
  @override
  Future<void> clear() async {}
}

void main() {
  late ProviderContainer container;
  late _ArchiveAuth auth;
  setUp(() {
    container = ProviderContainer(overrides: [authProvider.overrideWith(_ArchiveAuth.new)]);
    auth = container.read(authProvider.notifier) as _ArchiveAuth;
  });
  tearDown(() => container.dispose());
  AuthSessionContext capture() => auth.captureSession()!;

  test(
      'dedicated streamed client disables redirects and refreshes explicit TOKEN_EXPIRED only once',
      () async {
    final store = MemoryTokenStore(tokens('old', 'refresh-old'));
    var refreshes = 0, sends = 0;
    final dedicated = StreamClient((request) async {
      expect(request.followRedirects, false);
      expect(request.maxRedirects, 0);
      expect(request.url.path, '/api/v1/users/me/export/archive');
      expect(jsonDecode((request as http.Request).body),
          {'currentPassword': ' proof with spaces '});
      sends++;
      if (sends == 1) {
        expect(request.headers['authorization'], 'Bearer old');
        return response(
            Stream.value(utf8.encode(jsonEncode({
              'error': {'code': 'TOKEN_EXPIRED'}
            }))),
            401,
            'application/json');
      }
      expect(request.headers['authorization'], 'Bearer new');
      return response(Stream.value(
          File('test/fixtures/account_archive_v1.ndjson').readAsBytesSync()));
    });
    final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        archiveClientFactory: () => dedicated,
        httpClient: MockClient((request) async {
          refreshes++;
          expect(request.url.path.endsWith('auth/refresh'), true);
          return http.Response(
              jsonEncode(tokens('new', 'refresh-new').toJson()), 200);
        }));
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    final output = await client
        .streamAccountArchive(' proof with spaces ', cancel, session: capture())
        .expand((chunk) => chunk)
        .toList();
    expect(output,
        File('test/fixtures/account_archive_v1.ndjson').readAsBytesSync());
    expect(sends, 2);
    expect(refreshes, 1);
    expect(dedicated.closed, true);
    cancel.cancel();
  });
  for (final status in [302, 400, 401, 403, 429, 503]) {
    test('status $status without explicit expiry never refreshes or retries',
        () async {
      var sends = 0, refreshes = 0;
      final stream = StreamClient((_) async {
        sends++;
        return response(
            Stream.value(
                utf8.encode('{"error":{"message":"private-provider-text"}}')),
            status,
            'application/json');
      });
      final client = ApiClient(
          baseUri: Uri.parse('https://api.example.test/api/v1/'),
          tokenStore: MemoryTokenStore(tokens('access', 'refresh')),
          archiveClientFactory: () => stream,
          httpClient: MockClient((_) async {
            refreshes++;
            return http.Response('{}', 500);
          }));
      addTearDown(client.close);
      final cancel = ArchiveCancellation();
      await expectLater(
          client.streamAccountArchive('proof', cancel, session: capture()).drain<void>(),
          throwsA(isA<ApiException>()));
      expect(sends, 1);
      expect(refreshes, 0);
      expect(stream.closed, true);
      cancel.cancel();
    });
  }
  test('partial network failure is sanitized and never replayed', () async {
    var sends = 0;
    Stream<List<int>> partial() async* {
      yield utf8.encode('{');
      throw StateError('private-provider-text');
    }

    final dedicated = StreamClient((_) async {
      sends++;
      return response(partial());
    });
    final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: MemoryTokenStore(tokens('access', 'refresh')),
        archiveClientFactory: () => dedicated);
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    await expectLater(
        client.streamAccountArchive('proof', cancel, session: capture()).drain<void>(),
        throwsA(isA<ArchiveException>()));
    expect(sends, 1);
    expect(dedicated.closed, true);
    cancel.cancel();
  });
  test(
      'cancellation closes only the dedicated connection, not the shared client',
      () async {
    final source = StreamController<List<int>>();
    final dedicated = StreamClient((_) async => response(source.stream),
        onClose: () => unawaited(source.close()));
    final shared = StreamClient((_) async =>
        response(Stream.value(utf8.encode('{}')), 200, 'application/json'));
    final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: MemoryTokenStore(tokens('access', 'refresh')),
        httpClient: shared,
        archiveClientFactory: () => dedicated);
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    final pending = expectLater(
        client.streamAccountArchive('proof', cancel, session: capture()).drain<void>(),
        throwsA(isA<ArchiveException>()));
    await Future<void>.delayed(Duration.zero);
    cancel.cancel();
    await pending;
    expect(dedicated.closed, true);
    expect(shared.closed, false);
  });
  test('unsupported token store fails closed without credential access', () async {
    final store = _UnsupportedTokens();
    var sends = 0;
    final dedicated = StreamClient((_) async { sends++; return response(Stream.empty()); });
    final client = ApiClient(baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store, archiveClientFactory: () => dedicated);
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    await expectLater(client.streamAccountArchive('proof', cancel, session: capture()).drain<void>(),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'SESSION_CHANGED')));
    expect(store.reads, 0);
    expect(sends, 0);
    cancel.cancel();
  });

  test('account switch during credential read prevents dispatch', () async {
    final store = _DelayedReadTokens(tokens('a', 'refresh-a'));
    var sends = 0;
    final dedicated = StreamClient((_) async { sends++; return response(Stream.empty()); });
    final client = ApiClient(baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store, archiveClientFactory: () => dedicated);
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    final pending = client.streamAccountArchive('proof', cancel, session: capture()).drain<void>();
    final rejected = expectLater(pending, throwsA(isA<ApiException>()
        .having((e) => e.code, 'code', 'SESSION_CHANGED')));
    await store.started.future;
    auth.transition('account-b');
    store.release.complete();
    await rejected;
    expect(sends, 0);
    expect(dedicated.closed, isTrue);
    cancel.cancel();
  });

  test('stale session before subscription fails before dispatch', () async {
    var sends = 0;
    final dedicated = StreamClient((_) async { sends++; return response(Stream.empty()); });
    final client = ApiClient(baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: MemoryTokenStore(tokens('a', 'r')),
        archiveClientFactory: () => dedicated);
    addTearDown(client.close);
    final session = capture();
    auth.transition(null);
    final cancel = ArchiveCancellation();
    await expectLater(client.streamAccountArchive('proof', cancel, session: session).drain<void>(),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'SESSION_CHANGED')));
    expect(sends, 0);
    cancel.cancel();
  });

  test('invalidation while expiry body arrives prevents refresh and retry', () async {
    final started = Completer<void>();
    final release = Completer<void>();
    var sends = 0, refreshes = 0;
    Stream<List<int>> errorBody() async* {
      started.complete();
      await release.future;
      yield utf8.encode('{"error":{"code":"TOKEN_EXPIRED"}}');
    }
    final dedicated = StreamClient((_) async { sends++; return response(errorBody(), 401, 'application/json'); });
    final client = ApiClient(baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: MemoryTokenStore(tokens('a', 'r')), archiveClientFactory: () => dedicated,
        httpClient: MockClient((_) async { refreshes++; return http.Response('', 500); }));
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    final pending = client.streamAccountArchive('proof', cancel, session: capture()).drain<void>();
    final rejected = expectLater(pending, throwsA(isA<ApiException>()
        .having((e) => e.code, 'code', 'SESSION_CHANGED')));
    await started.future;
    auth.transition('account-b');
    release.complete();
    await rejected;
    expect(sends, 1);
    expect(refreshes, 0);
    cancel.cancel();
  });

  test('transition stops later chunks but cannot retract an earlier chunk', () async {
    final firstDelivered = Completer<void>();
    final release = Completer<void>();
    Stream<List<int>> chunks() async* {
      yield utf8.encode('first');
      await release.future;
      yield utf8.encode('second');
    }
    final dedicated = StreamClient((_) async => response(chunks()));
    final client = ApiClient(baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: MemoryTokenStore(tokens('a', 'r')), archiveClientFactory: () => dedicated);
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    final delivered = <int>[];
    final operation = client.streamAccountArchive('proof', cancel, session: capture())
        .forEach((chunk) { delivered.addAll(chunk); if (!firstDelivered.isCompleted) firstDelivered.complete(); });
    final rejected = expectLater(operation, throwsA(isA<ApiException>()
        .having((e) => e.code, 'code', 'SESSION_CHANGED')));
    await firstDelivered.future;
    auth.transition('account-b');
    release.complete();
    await rejected;
    expect(utf8.decode(delivered), 'first');
    cancel.cancel();
  });

  for (final returnToA in [false, true]) {
    test(returnToA ? 'A to B to A rejects a delayed archive response' :
        'logout rejects a delayed archive response', () async {
      final started = Completer<void>();
      final release = Completer<void>();
      final dedicated = StreamClient((_) async {
        started.complete();
        await release.future;
        return response(Stream.value(utf8.encode('private old response')));
      });
      final client = ApiClient(baseUri: Uri.parse('https://api.example.test/api/v1/'),
          tokenStore: MemoryTokenStore(tokens('a', 'r')), archiveClientFactory: () => dedicated);
      addTearDown(client.close);
      final cancel = ArchiveCancellation();
      final delivered = <int>[];
      final operation = client.streamAccountArchive('proof', cancel, session: capture())
          .forEach(delivered.addAll);
      final rejected = expectLater(operation, throwsA(isA<ApiException>()
          .having((e) => e.code, 'code', 'SESSION_CHANGED')));
      await started.future;
      auth.transition(returnToA ? 'account-b' : null);
      if (returnToA) auth.transition('account-a');
      release.complete();
      await rejected;
      expect(delivered, isEmpty);
      expect(dedicated.closed, isTrue);
      cancel.cancel();
    });
  }

}

class StreamClient extends http.BaseClient {
  StreamClient(this.reply, {this.onClose});
  final Future<http.StreamedResponse> Function(http.BaseRequest) reply;
  final void Function()? onClose;
  bool closed = false;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      reply(request);
  @override
  void close() {
    closed = true;
    onClose?.call();
  }
}
