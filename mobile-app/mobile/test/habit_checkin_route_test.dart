import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/habits/data/habits_repository.dart';

class _MemoryTokenStore implements TokenStore {
  _MemoryTokenStore(this.tokens);

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

SessionTokens _session() => SessionTokens(
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    );

ApiClient _apiWith(http.Client client) => ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: _MemoryTokenStore(_session()),
      httpClient: client,
    );

void main() {
  group('HabitsRepository.checkinHabit', () {
    test('uses the PUT checkins route with a status body', () async {
      late http.Request captured;
      final repository = HabitsRepository(
        _apiWith(
          MockClient((request) async {
            captured = request;
            return http.Response('', 204);
          }),
        ),
      );

      await repository.checkinHabit('habit-1', '2026-10-08');

      expect(captured.method, 'PUT');
      expect(
        captured.url.path,
        '/api/v1/habits/habit-1/checkins/2026-10-08',
      );
      expect(jsonDecode(captured.body), {'status': 'done'});
    });
  });
}
