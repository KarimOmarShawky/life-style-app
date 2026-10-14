import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';

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
