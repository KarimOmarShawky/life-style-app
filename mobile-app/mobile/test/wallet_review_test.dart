import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';
import 'package:lifestyle_mobile/features/money/data/pending_wallet_reviews.dart';
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

String _reviewItem(
  String id, {
  String kind = 'expense',
  String amount = '250.00',
  int createdAt = 1,
}) =>
    jsonEncode({
      'id': id,
      'kind': kind,
      'amount': amount,
      'currency': 'EGP',
      'occurredOn': '2026-10-08',
      'description': 'Transfer via wallet',
      'merchant': 'InstaPay',
      'sender': '[PHONE]',
      'text': 'paid 250 EGP',
      'createdAt': createdAt,
    });

String _candidateItem(String id, {int attempts = 0}) => jsonEncode({
  'id': id,
  'text': 'Debited 450 EGP at UNKNOWN SHOP',
  'sender': '[PHONE]',
  'receivedAtMs': 1791460000000,
  'attempts': attempts,
});

String _analyzeResponse({
  required String status,
  String? confidence,
  Map<String, Object?>? transaction,
}) =>
    jsonEncode({
      'status': status,
      'transaction': transaction,
      'confidence': confidence,
    });

const Map<String, Object?> _strictTransaction = {
  'kind': 'expense',
  'amount': '450.00',
  'currency': 'EGP',
  'occurredOn': '2026-10-08',
  'description': 'Purchase',
  'merchant': 'Some Shop',
};

void main() {
  group('WalletReviewItem.tryParse', () {
    test('rejects missing, malformed and invalid entries', () {
      expect(WalletReviewItem.tryParse(null), isNull);
      expect(WalletReviewItem.tryParse('not json'), isNull);
      expect(WalletReviewItem.tryParse(_reviewItem('a', kind: 'transfer')), isNull);
      expect(WalletReviewItem.tryParse(_reviewItem('b', amount: '250.999')), isNull);
      expect(WalletReviewItem.tryParse(_reviewItem('c', amount: '-5')), isNull);
      expect(
        WalletReviewItem.tryParse(jsonEncode({'id': 'd', 'kind': 'expense'})),
        isNull,
      );
    });

    test('parses a complete entry and defaults the currency', () {
      final parsed = WalletReviewItem.tryParse(
        jsonEncode({
          'id': 'tx-1',
          'kind': 'income',
          'amount': '1200.00',
          'occurredOn': '2026-10-08',
        }),
      );
      expect(parsed, isNotNull);
      expect(parsed!.id, 'tx-1');
      expect(parsed.kind, 'income');
      expect(parsed.amount, '1200.00');
      expect(parsed.currency, 'EGP');
    });
  });

  group('PendingWalletReviews', () {
    test('loads queued reviews oldest first and drops malformed entries', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_review.later': _reviewItem('later', createdAt: 20),
        'flutter.pending_wallet_review.earlier': _reviewItem('earlier', createdAt: 10),
        'flutter.pending_wallet_review.bad': 'not json',
      });
      final reviews = PendingWalletReviews(MoneyRepository(_apiWith(MockClient(
        (request) async => http.Response('', 500),
      ))));

      final items = await reviews.load();

      expect(items.map((item) => item.id).toList(), ['earlier', 'later']);
    });

    test('confirm saves the edited values with the review id as idempotency key', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_review.one': _reviewItem('one'),
      });
      late http.Request captured;
      final reviews = PendingWalletReviews(MoneyRepository(_apiWith(
        MockClient((request) async {
          captured = request;
          return http.Response('', 201);
        }),
      )));

      final item = (await reviews.load()).single;
      await reviews.confirm(
        item: item,
        kind: 'income',
        amount: '999.00',
        description: 'Edited',
        merchant: 'Edited Shop',
      );

      expect(captured.url.path, endsWith('/money/transactions'));
      expect(captured.headers['idempotency-key'], 'one');
      final body = jsonDecode(captured.body) as Map<String, dynamic>;
      expect(body['kind'], 'income');
      expect(body['amount'], '999.00');
      expect(body['description'], 'Edited');
      expect(body['merchant'], 'Edited Shop');

      final prefs = await SharedPreferences.getInstance();
      expect(await reviews.load(), isEmpty);
      expect(prefs.getString('pending_wallet_review.one'), isNull);
    });

    test('discard removes the entry without any API call', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_review.gone': _reviewItem('gone'),
      });
      var called = false;
      final reviews = PendingWalletReviews(MoneyRepository(_apiWith(
        MockClient((request) async {
          called = true;
          return http.Response('', 201);
        }),
      )));

      await reviews.discard('gone');

      expect(called, isFalse);
      expect(await reviews.load(), isEmpty);
    });
  });

  group('PendingWalletCandidates.flush', () {
    test('auto-saves a high-confidence parse with the candidate id as idempotency key', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.high': _candidateItem('high'),
      });
      final requestedPaths = <String>[];
      final sentKeys = <String>[];
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async {
          requestedPaths.add(request.url.path);
          return http.Response(
            _analyzeResponse(
              status: 'recognized',
              confidence: 'high',
              transaction: _strictTransaction,
            ),
            200,
            headers: {'content-type': 'application/json'},
          );
        })),
        MoneyRepository(_apiWith(MockClient((request) async {
          sentKeys.add(request.headers['idempotency-key'] ?? '');
          return http.Response(
            jsonEncode({'transaction': <String, Object?>{}}),
            201,
            headers: {'content-type': 'application/json'},
          );
        }))),
      );

      final resolved = await candidates.flush();

      expect(resolved, 1);
      expect(requestedPaths.single, endsWith('/ingest/sms/analyze'));
      expect(sentKeys, ['high']);
      expect(await PendingWalletReviews(MoneyRepository(_apiWith(MockClient(
        (request) async => http.Response('', 500),
      )))).load(), isEmpty);
    });

    test('low confidence becomes a review item instead of being saved', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.low': _candidateItem('low'),
      });
      var saved = false;
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async => http.Response(
          _analyzeResponse(
            status: 'recognized',
            confidence: 'low',
            transaction: _strictTransaction,
          ),
          200,
          headers: {'content-type': 'application/json'},
        ))),
        MoneyRepository(_apiWith(MockClient((request) async {
          saved = true;
          return http.Response('', 201);
        }))),
      );

      final resolved = await candidates.flush();

      expect(resolved, 1);
      expect(saved, isFalse);
      final reviews = await PendingWalletReviews(MoneyRepository(_apiWith(
        MockClient((request) async => http.Response('', 500)),
      ))).load();
      expect(reviews, hasLength(1));
      expect(reviews.single.id, 'low');
      expect(reviews.single.amount, '450.00');
    });

    test('unrecognized results drop the candidate', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.no': _candidateItem('no'),
      });
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async => http.Response(
          _analyzeResponse(status: 'unrecognized'),
          200,
          headers: {'content-type': 'application/json'},
        ))),
        MoneyRepository(_apiWith(MockClient((request) async => http.Response('', 201)))),
      );

      expect(await candidates.flush(), 1);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_candidate.no'), isNull);
    });

    test('server failures keep the candidate and count the attempt', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.later': _candidateItem('later'),
      });
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async => http.Response(
          jsonEncode({
            'success': false,
            'error': {'code': 'INTERNAL_ERROR', 'message': 'Down'},
          }),
          500,
          headers: {'content-type': 'application/json'},
        ))),
        MoneyRepository(_apiWith(MockClient((request) async => http.Response('', 201)))),
      );

      expect(await candidates.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString('pending_wallet_candidate.later');
      expect(stored, isNotNull);
      expect(jsonDecode(stored!)['attempts'], 1);
    });

    test('permanent rejections and malformed entries are dropped', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.bad': _candidateItem('bad'),
        'flutter.pending_wallet_candidate.junk': 'not json',
      });
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async => http.Response(
          jsonEncode({
            'success': false,
            'error': {'code': 'VALIDATION_ERROR', 'message': 'Invalid'},
          }),
          400,
          headers: {'content-type': 'application/json'},
        ))),
        MoneyRepository(_apiWith(MockClient((request) async => http.Response('', 201)))),
      );

      expect(await candidates.flush(), 1);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_candidate.bad'), isNull);
      expect(prefs.getString('pending_wallet_candidate.junk'), isNull);
    });

    test('a candidate that exhausted its attempts is dropped', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.old': _candidateItem('old', attempts: 5),
      });
      var called = false;
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async {
          called = true;
          return http.Response('', 200);
        })),
        MoneyRepository(_apiWith(MockClient((request) async => http.Response('', 201)))),
      );

      await candidates.flush();

      expect(called, isFalse);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_candidate.old'), isNull);
    });
  });
}
