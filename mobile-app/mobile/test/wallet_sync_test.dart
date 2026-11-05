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
import 'package:lifestyle_mobile/features/money/data/pending_wallet_reviews.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_queue_codec.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _UnreadableCodec extends PlainWalletQueueCodec {
  const _UnreadableCodec();

  @override
  Future<String?> read(SharedPreferences prefs, String key) async => null;
}

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
          codec: const PlainWalletQueueCodec(),
        );

        final stored = await queue.flush();

        expect(stored, 1);
        expect(sentKeys, ['one']);
        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('pending_wallet_tx.one'), isNull);
      },
    );

    test('keeps malformed and unreadable entries without sending them',
        () async {
      for (final unreadable in [false, true]) {
        const value = 'damaged-data';
        SharedPreferences.setMockInitialValues({
          'flutter.pending_wallet_tx.damaged': value,
        });
        var requests = 0;
        final queue = PendingWalletTransactions(
          MoneyRepository(_apiWith(MockClient((_) async {
            requests++;
            return _jsonResponse(201, {});
          }))),
          codec: unreadable
              ? const _UnreadableCodec()
              : const PlainWalletQueueCodec(),
        );
        expect(await queue.flush(), 0);
        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('pending_wallet_tx.damaged'), value);
        expect(requests, 0);
      }
    });

    test('stops a stale flush after in-flight success or rejection', () async {
      for (final status in [201, 422]) {
        final original = _queuedItem('one');
        final next = _queuedItem('two');
        SharedPreferences.setMockInitialValues({
          'flutter.pending_wallet_tx.one': original,
          'flutter.pending_wallet_tx.two': next,
        });
        var current = true;
        var requests = 0;
        final queue = PendingWalletTransactions(
          MoneyRepository(_apiWith(MockClient((_) async {
            requests++;
            current = false;
            return status == 201
                ? _jsonResponse(201, {})
                : _jsonResponse(422, {
                    'success': false,
                    'error': {'code': 'REJECTED', 'message': 'Rejected'},
                  });
          }))),
          codec: const PlainWalletQueueCodec(),
          stillCurrent: () => current,
        );
        expect(await queue.flush(), 0);
        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('pending_wallet_tx.one'), original);
        expect(prefs.getString('pending_wallet_tx.two'), next);
        expect(prefs.getString('wallet_tx_rejected.one'), isNull);
        expect(requests, 1); // Already sent; cannot be recalled.
      }
    });

    test('keeps a mismatched transaction ID locked without sending', () async {
      final original = _queuedItem('different');
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_tx.source': original,
      });
      var requests = 0;
      final queue = PendingWalletTransactions(
        MoneyRepository(_apiWith(MockClient((_) async {
          requests++;
          return _jsonResponse(201, {});
        }))),
        codec: const PlainWalletQueueCodec(),
      );
      expect(await queue.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_tx.source'), original);
      expect(prefs.getString('wallet_legacy_hold.source'), 'HELD');
      expect(requests, 0);
    });

    test('keeps a transaction and quarantine collision without uploading',
        () async {
      final original = _queuedItem('same');
      const quarantined = 'different preserved opaque payload';
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_tx.same': original,
        'flutter.pending_wallet_quarantine.same': quarantined,
      });
      var requests = 0;
      final queue = PendingWalletTransactions(
        MoneyRepository(_apiWith(MockClient((_) async {
          requests++;
          return _jsonResponse(201, {});
        }))),
        codec: const PlainWalletQueueCodec(),
      );
      expect(await queue.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_tx.same'), original);
      expect(prefs.getString('pending_wallet_quarantine.same'), quarantined);
      expect(prefs.getString('wallet_legacy_hold.same'), 'HELD');
      expect(requests, 0);
    });

    test('parks rejected transactions without deleting or retrying them',
        () async {
      for (final status in [400, 409, 422]) {
        final original = _queuedItem('bad');
        SharedPreferences.setMockInitialValues({
          'flutter.pending_wallet_tx.bad': original,
        });
        var requests = 0;
        final queue = PendingWalletTransactions(
          MoneyRepository(_apiWith(MockClient((_) async {
            requests++;
            return _jsonResponse(status, {
              'success': false,
              'error': {'code': 'REJECTED', 'message': 'Rejected'},
            });
          }))),
          codec: const PlainWalletQueueCodec(),
        );
        expect(await queue.flush(), 0);
        expect(await queue.flush(), 0);
        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('pending_wallet_tx.bad'), original);
        expect(prefs.getString('wallet_tx_rejected.bad'), 'REJECTED');
        expect(await WalletSmsQuarantineStatus.isQuarantined(), isTrue);
        expect(requests, 1);
      }
    });

    test(
        'honors the native rejected marker and keeps its protected transaction',
        () async {
      final original = _queuedItem('native');
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_tx.native': original,
        'flutter.wallet_tx_rejected.native': 'REJECTED',
      });
      var requests = 0;
      final queue = PendingWalletTransactions(
        MoneyRepository(_apiWith(MockClient((_) async {
          requests++;
          return _jsonResponse(201, {});
        }))),
        codec: const PlainWalletQueueCodec(),
      );
      expect(await queue.flush(), 0);
      expect(requests, 0);
      expect(
          (await SharedPreferences.getInstance())
              .getString('pending_wallet_tx.native'),
          original);
      expect(await WalletSmsQuarantineStatus.isQuarantined(), isTrue);
    });

    test('does not delete an item parked while upload was in flight', () async {
      final original = _queuedItem('race');
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_tx.race': original,
      });
      final queue = PendingWalletTransactions(
        MoneyRepository(_apiWith(MockClient((_) async {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('wallet_tx_rejected.race', 'REJECTED');
          return _jsonResponse(201, {});
        }))),
        codec: const PlainWalletQueueCodec(),
      );
      expect(await queue.flush(), 0);
      expect(
          (await SharedPreferences.getInstance())
              .getString('pending_wallet_tx.race'),
          original);
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
        codec: const PlainWalletQueueCodec(),
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
