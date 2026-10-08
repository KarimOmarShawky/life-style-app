import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/habits/data/habits_repository.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';
import 'package:lifestyle_mobile/features/money/data/pending_wallet_transactions.dart';
import 'package:shared_preferences/shared_preferences.dart';

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

String _queuedItem(String id, {String kind = 'expense'}) => jsonEncode({
  'id': id,
  'kind': kind,
  'amount': '125.50',
  'currency': 'EGP',
  'occurredOn': '2026-10-08',
  'description': 'Transfer via InstaPay',
  'merchant': 'InstaPay',
  'createdAt': 1,
});

http.Response _jsonResponse(int status, Map<String, Object?> body) {
  return http.Response(
    jsonEncode(body),
    status,
    headers: {'content-type': 'application/json'},
  );
}

void main() {
  group('PendingWalletTransaction.tryParse', () {
    test('rejects missing, malformed and invalid entries', () {
      expect(PendingWalletTransaction.tryParse(null), isNull);
      expect(PendingWalletTransaction.tryParse('not json'), isNull);
      expect(
        PendingWalletTransaction.tryParse(_queuedItem('a', kind: 'transfer')),
        isNull,
      );
      expect(
        PendingWalletTransaction.tryParse(jsonEncode({'kind': 'expense'})),
        isNull,
      );
    });

    test('parses a complete entry and defaults the currency', () {
      final parsed = PendingWalletTransaction.tryParse(_queuedItem('tx-1'));
      expect(parsed, isNotNull);
      expect(parsed!.id, 'tx-1');
      expect(parsed.kind, 'expense');
      expect(parsed.amount, '125.50');
      expect(parsed.currency, 'EGP');
      expect(parsed.occurredOn, '2026-10-08');
      expect(parsed.merchant, 'InstaPay');
    });
  });

  group('PendingWalletTransactions.flush', () {
    test(
      'sends the entry id as Idempotency-Key and removes accepted entries',
      () async {
        SharedPreferences.setMockInitialValues({
          'flutter.pending_wallet_tx.one': _queuedItem('one'),
        });
        final sentKeys = <String>[];
        final queue = PendingWalletTransactions(
          MoneyRepository(
            _apiWith(
              MockClient((request) async {
                expect(request.url.path, endsWith('/money/transactions'));
                sentKeys.add(request.headers['idempotency-key'] ?? '');
                return _jsonResponse(201, {'transaction': <String, Object?>{}});
              }),
            ),
          ),
        );

        final stored = await queue.flush();

        expect(stored, 1);
        expect(sentKeys, ['one']);
        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('pending_wallet_tx.one'), isNull);
      },
    );

    test('drops entries that the API permanently rejects', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_tx.bad': _queuedItem('bad'),
      });
      final queue = PendingWalletTransactions(
        MoneyRepository(
          _apiWith(
            MockClient(
              (request) async => _jsonResponse(400, {
                'success': false,
                'error': {'code': 'VALIDATION_ERROR', 'message': 'Invalid'},
              }),
            ),
          ),
        ),
      );

      expect(await queue.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_tx.bad'), isNull);
    });

    test('keeps entries when the server fails, so they are retried', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_tx.later': _queuedItem('later'),
      });
      final queue = PendingWalletTransactions(
        MoneyRepository(
          _apiWith(
            MockClient(
              (request) async => _jsonResponse(500, {
                'success': false,
                'error': {'code': 'INTERNAL_ERROR', 'message': 'Down'},
              }),
            ),
          ),
        ),
      );

      expect(await queue.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_tx.later'), isNotNull);
    });
  });

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
