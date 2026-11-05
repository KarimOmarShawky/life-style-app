import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';

void main() {
  group('ApiClient refresh handling', () {
    test(
      'coalesces concurrent expired-token responses into one strict rotation',
      () async {
        final store = MemoryTokenStore(_tokens('access-old', 'refresh-old'));
        var refreshRequests = 0;
        var taskRequests = 0;
        final client = ApiClient(
          baseUri: Uri.parse('https://api.example.test/api/v1/'),
          tokenStore: store,
          httpClient: MockClient((request) async {
            if (request.url.path.endsWith('/auth/refresh')) {
              refreshRequests++;
              await Future<void>.delayed(const Duration(milliseconds: 20));
              return http.Response(
                jsonEncode(_tokens('access-new', 'refresh-new').toJson()),
                200,
                headers: {'content-type': 'application/json'},
              );
            }
            if (request.url.path.endsWith('/tasks')) {
              taskRequests++;
              if (request.headers['authorization'] == 'Bearer access-old') {
                await Future<void>.delayed(const Duration(milliseconds: 5));
                return http.Response(
                  jsonEncode(<String, dynamic>{
                    'success': false,
                    'error': <String, dynamic>{
                      'code': 'TOKEN_EXPIRED',
                      'message': 'Expired',
                    },
                  }),
                  401,
                );
              }
              return http.Response(
                jsonEncode(<String, dynamic>{
                  'data': <Map<String, dynamic>>[],
                  'meta': <String, dynamic>{},
                }),
                200,
              );
            }
            return http.Response('', 404);
          }),
        );
        addTearDown(client.close);

        await Future.wait([client.get('tasks'), client.get('tasks')]);

        expect(refreshRequests, 1);
        expect(taskRequests, 4);
        expect((await store.read())?.refreshToken, 'refresh-new');
      },
    );

    test('an expired request is not replayed with a different account token',
        () async {
      final store = MemoryTokenStore(_tokens('account-a', 'refresh-a'));
      final started = Completer<void>();
      final firstResponse = Completer<http.Response>();
      final authorizations = <String?>[];
      var refreshRequests = 0;
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) {
          if (request.url.path.endsWith('/auth/refresh')) refreshRequests++;
          authorizations.add(request.headers['authorization']);
          started.complete();
          return firstResponse.future;
        }),
      );
      addTearDown(client.close);
      final request = client.post('ingest/sms/analyze', body: {'text': 'test'});
      final rejection = expectLater(
        request,
        throwsA(isA<ApiException>()
            .having((error) => error.code, 'code', 'SESSION_CHANGED')),
      );
      await started.future;
      await store.write(_tokens('account-b', 'refresh-b'));
      firstResponse.complete(http.Response(
        jsonEncode({
          'error': {'code': 'TOKEN_EXPIRED', 'message': 'Expired'}
        }),
        401,
        headers: {'content-type': 'application/json'},
      ));
      await rejection;
      expect(authorizations, ['Bearer account-a']);
      expect(refreshRequests, 0);
      expect((await store.read())?.accessToken, 'account-b');
    });

    test('a changed refresh token with the same access token is not used',
        () async {
      final store = MemoryTokenStore(_tokens('access-a', 'refresh-a'));
      final started = Completer<void>();
      final response = Completer<http.Response>();
      var calls = 0;
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((_) {
          calls++;
          started.complete();
          return response.future;
        }),
      );
      addTearDown(client.close);
      final request = client.get('tasks');
      final rejection = expectLater(
        request,
        throwsA(isA<ApiException>()
            .having((error) => error.code, 'code', 'SESSION_CHANGED')),
      );
      await started.future;
      await store.write(_tokens('access-a', 'refresh-changed'));
      response.complete(http.Response(
        jsonEncode({
          'error': {'code': 'TOKEN_EXPIRED', 'message': 'Expired'}
        }),
        401,
      ));
      await rejection;
      expect(calls, 1);
      expect((await store.read())?.refreshToken, 'refresh-changed');
    });

    test(
        'a successful old response is not delivered after identity invalidation',
        () async {
      final store = MemoryTokenStore(_tokens('account-a', 'refresh-a'));
      final started = Completer<void>();
      final response = Completer<http.Response>();
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((_) {
          started.complete();
          return response.future;
        }),
      );
      addTearDown(client.close);
      final request = client.get('money/transactions');
      final rejection = expectLater(
        request,
        throwsA(isA<ApiException>()
            .having((error) => error.code, 'code', 'SESSION_CHANGED')),
      );
      await started.future;
      client.invalidateSessionRetries();
      await store.write(_tokens('account-b', 'refresh-b'));
      response.complete(http.Response(
        jsonEncode({'data': 'account-a-private-response'}),
        200,
        headers: {'content-type': 'application/json'},
      ));
      await rejection;
      expect((await store.read())?.accessToken, 'account-b');
    });

    test('a fenced stale profile response does not clear a new account',
        () async {
      final store = MemoryTokenStore(_tokens('account-a', 'refresh-a'));
      final profileStarted = Completer<void>();
      final profile = Completer<http.Response>();
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) {
          if (request.url.path.endsWith('/auth/refresh')) {
            return Future.value(http.Response(
              jsonEncode(_tokens('rotated-a', 'refresh-rotated-a').toJson()),
              200,
            ));
          }
          profileStarted.complete();
          return profile.future;
        }),
      );
      addTearDown(client.close);
      final repo = AuthRepository(api: client, tokens: store);
      final restore = repo.restoreSession();
      final rejection = expectLater(
        restore,
        throwsA(isA<ApiException>()
            .having((error) => error.code, 'code', 'SESSION_CHANGED')),
      );
      await profileStarted.future;
      client.invalidateSessionRetries();
      await store.write(_tokens('account-b', 'refresh-b'));
      profile.complete(http.Response(
        jsonEncode({
          'error': {'code': 'UNAUTHENTICATED', 'message': 'Expired'}
        }),
        401,
      ));
      await rejection;
      expect((await store.read())?.accessToken, 'account-b');
    });

    test('a stale refresh response cannot write after invalidation', () async {
      final store = MemoryTokenStore(_tokens('account-a', 'refresh-a'));
      final started = Completer<void>();
      final refresh = Completer<http.Response>();
      var requests = 0;
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) {
          requests++;
          if (request.url.path.endsWith('/auth/refresh')) {
            started.complete();
            return refresh.future;
          }
          return Future.value(http.Response(
            jsonEncode({
              'error': {'code': 'TOKEN_EXPIRED', 'message': 'Expired'}
            }),
            401,
            headers: {'content-type': 'application/json'},
          ));
        }),
      );
      addTearDown(client.close);
      final request = client.get('tasks');
      final rejection = expectLater(
        request,
        throwsA(isA<ApiException>()
            .having((error) => error.code, 'code', 'SESSION_CHANGED')),
      );
      await started.future;
      client.invalidateSessionRetries();
      await store.write(_tokens('account-b', 'refresh-b'));
      refresh.complete(http.Response(
        jsonEncode(_tokens('rotated-a', 'rotated-refresh-a').toJson()),
        200,
        headers: {'content-type': 'application/json'},
      ));
      await rejection;
      expect(requests, 2); // original request and one refresh, no replay
      expect((await store.read())?.accessToken, 'account-b');
    });

    test('a changed stored pair blocks a stale refresh even without a signal',
        () async {
      final store = MemoryTokenStore(_tokens('account-a', 'refresh-a'));
      final started = Completer<void>();
      final refresh = Completer<http.Response>();
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) {
          if (request.url.path.endsWith('/auth/refresh')) {
            started.complete();
            return refresh.future;
          }
          return Future.value(http.Response(
            jsonEncode({
              'error': {'code': 'TOKEN_EXPIRED', 'message': 'Expired'}
            }),
            401,
          ));
        }),
      );
      addTearDown(client.close);
      final request = client.get('tasks');
      final rejection = expectLater(
        request,
        throwsA(isA<ApiException>()
            .having((error) => error.code, 'code', 'SESSION_CHANGED')),
      );
      await started.future;
      // Models another writer that did not notify this ApiClient.
      await store.write(_tokens('account-b', 'refresh-b'));
      refresh.complete(http.Response(
        jsonEncode(_tokens('rotated-a', 'rotated-refresh-a').toJson()),
        200,
      ));
      await rejection;
      expect((await store.read())?.accessToken, 'account-b');
    });

    test('a stale failed refresh does not clear the replacement account',
        () async {
      final store = MemoryTokenStore(_tokens('account-a', 'refresh-a'));
      final started = Completer<void>();
      final refresh = Completer<http.Response>();
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) {
          if (request.url.path.endsWith('/auth/refresh')) {
            started.complete();
            return refresh.future;
          }
          return Future.value(http.Response(
            jsonEncode({
              'error': {'code': 'TOKEN_EXPIRED', 'message': 'Expired'}
            }),
            401,
            headers: {'content-type': 'application/json'},
          ));
        }),
      );
      addTearDown(client.close);
      final request = client.get('tasks');
      final rejection = expectLater(request, throwsA(isA<ApiException>()));
      await started.future;
      client.invalidateSessionRetries();
      await store.write(_tokens('account-b', 'refresh-b'));
      refresh.complete(http.Response(
        jsonEncode({
          'error': {'code': 'INVALID_REFRESH_TOKEN', 'message': 'Invalid'}
        }),
        401,
        headers: {'content-type': 'application/json'},
      ));
      await rejection;
      expect((await store.read())?.accessToken, 'account-b');
    });

    test('does not forward bearer authorization across redirects', () async {
      final store = MemoryTokenStore(_tokens('access', 'refresh'));
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) async {
          expect(request.followRedirects, isFalse);
          return http.Response(
            '',
            302,
            headers: {'location': 'https://other.example.test'},
          );
        }),
      );
      addTearDown(client.close);

      await expectLater(
        client.get('tasks'),
        throwsA(
          isA<ApiException>().having(
            (error) => error.code,
            'code',
            'UNEXPECTED_REDIRECT',
          ),
        ),
      );
    });

    test('does not refresh for other unauthorized errors', () async {
      final store = MemoryTokenStore(_tokens('access', 'refresh'));
      var refreshRequests = 0;
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/auth/refresh')) refreshRequests++;
          return http.Response(
            jsonEncode({
              'success': false,
              'error': {'code': 'UNAUTHENTICATED', 'message': 'Not signed in'},
            }),
            401,
          );
        }),
      );
      addTearDown(client.close);

      await expectLater(client.get('tasks'), throwsA(isA<ApiException>()));
      expect(refreshRequests, 0);
    });

    test(
      'clears uncertain credentials when rotation cannot be confirmed',
      () async {
        final store = MemoryTokenStore(_tokens('access', 'refresh'));
        final client = ApiClient(
          baseUri: Uri.parse('https://api.example.test/api/v1/'),
          tokenStore: store,
          httpClient: MockClient(
            (request) async => http.Response(
              jsonEncode({
                'success': false,
                'error': {
                  'code': 'INVALID_REFRESH_TOKEN',
                  'message': 'Invalid',
                },
              }),
              401,
            ),
          ),
        );
        addTearDown(client.close);

        await expectLater(
          client.restoreSession(),
          throwsA(isA<ApiException>()),
        );
        expect(await store.read(), isNull);
      },
    );
  });
}

class MemoryTokenStore implements TokenStore {
  MemoryTokenStore(this.tokens);

  SessionTokens? tokens;

  @override
  Future<void> clear() async {
    tokens = null;
  }

  @override
  Future<SessionTokens?> read() async => tokens;

  @override
  Future<void> write(SessionTokens value) async {
    tokens = value;
  }
}

SessionTokens _tokens(String accessToken, String refreshToken) => SessionTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    );
