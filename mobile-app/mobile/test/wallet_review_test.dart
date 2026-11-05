import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';
import 'package:lifestyle_mobile/features/money/data/pending_wallet_reviews.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_queue_codec.dart';
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
  String occurredOn = '2026-10-08',
  int createdAt = 1,
}) =>
    jsonEncode({
      'id': id,
      'kind': kind,
      'amount': amount,
      'currency': 'EGP',
      'occurredOn': occurredOn,
      'description': 'Transfer via wallet',
      'merchant': 'InstaPay',
      'sender': '[PHONE]',
      'text': 'paid 250 EGP',
      'createdAt': createdAt,
    });

/// One queued candidate. [receivedAtMs] defaults to a fresh timestamp because
/// older or undated legacy entries are held rather than retried.
String _candidateItem(
  String id, {
  int attempts = 0,
  int? receivedAtMs,
}) =>
    jsonEncode({
      'id': id,
      'text': 'Debited 450 EGP at UNKNOWN SHOP',
      'sender': '[PHONE]',
      'receivedAtMs':
          receivedAtMs ?? DateTime.now().millisecondsSinceEpoch - 60000,
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

/// Simulates a Keystore-backed codec where one stored value cannot be
/// authenticated (invalidated key or damaged ciphertext) while the rest of the
/// queue keeps working.
class _FlakyCodec implements WalletQueueCodec {
  final Set<String> unreadableKeys = <String>{};
  final Set<String> unwritableKeys = <String>{};

  @override
  Future<String?> read(SharedPreferences prefs, String key) async {
    if (unreadableKeys.contains(key)) {
      throw WalletQueueSecurityException('value cannot be authenticated');
    }
    return prefs.getString(key);
  }

  @override
  Future<String?> unseal(String stored) async => stored;

  @override
  Future<void> write(SharedPreferences prefs, String key, String value) async {
    if (unwritableKeys.contains(key)) {
      throw WalletQueueSecurityException('value cannot be protected');
    }
    await prefs.setString(key, value);
  }
}

void main() {
  group('WalletReviewItem.tryParse', () {
    test('rejects missing, malformed and invalid entries', () {
      expect(WalletReviewItem.tryParse(null), isNull);
      expect(WalletReviewItem.tryParse('not json'), isNull);
      expect(WalletReviewItem.tryParse(_reviewItem('a', kind: 'transfer')),
          isNull);
      expect(WalletReviewItem.tryParse(_reviewItem('b', amount: '250.999')),
          isNull);
      expect(WalletReviewItem.tryParse(_reviewItem('c', amount: '-5')), isNull);
      expect(
        WalletReviewItem.tryParse(
          _reviewItem('impossible-date', occurredOn: '2026-02-30'),
        ),
        isNull,
      );
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
    test('loads queued reviews oldest first and keeps malformed entries parked',
        () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_review.later':
            _reviewItem('later', createdAt: 20),
        'flutter.pending_wallet_review.earlier':
            _reviewItem('earlier', createdAt: 10),
        'flutter.pending_wallet_review.bad': 'not json',
      });
      final reviews = PendingWalletReviews(
          MoneyRepository(_apiWith(MockClient(
            (request) async => http.Response('', 500),
          ))),
          codec: const PlainWalletQueueCodec());

      final items = await reviews.load();

      expect(items.map((item) => item.id).toList(), ['earlier', 'later']);
      // The unparseable entry is not listed, but it is also not deleted: it is
      // the only copy of that message, so the state is published instead (V-02).
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_review.bad'), isNotNull);
      expect(prefs.getString('wallet_sms_quarantined'), isNotNull);
    });

    test(
        'confirm saves the edited values with the review id as idempotency key',
        () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_review.one': _reviewItem('one'),
      });
      late http.Request captured;
      final reviews = PendingWalletReviews(MoneyRepository(_apiWith(
        MockClient((request) async {
          captured = request;
          return http.Response('', 201);
        }),
      )), codec: const PlainWalletQueueCodec());

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

    test('a held review is not listed, saved, or discarded', () async {
      final original = _reviewItem('held');
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_review.held': original,
      });
      var calls = 0;
      final reviews = PendingWalletReviews(
        MoneyRepository(_apiWith(MockClient((_) async {
          calls++;
          return http.Response('', 201);
        }))),
        codec: const PlainWalletQueueCodec(),
      );
      final item = (await reviews.load()).single;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('wallet_legacy_hold.held', 'HELD');
      expect(await reviews.load(), isEmpty);
      await expectLater(
        reviews.confirm(item: item, kind: 'expense', amount: '1.00'),
        throwsA(isA<WalletLegacyHeldException>()),
      );
      await expectLater(
        reviews.discard(item.id),
        throwsA(isA<WalletLegacyHeldException>()),
      );
      expect(calls, 0);
      expect(prefs.getString('pending_wallet_review.held'), original);
    });

    test('a hold arriving during confirmation prevents local removal',
        () async {
      final original = _reviewItem('in-flight-review');
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_review.in-flight-review': original,
      });
      final requested = Completer<void>();
      final response = Completer<http.Response>();
      final reviews = PendingWalletReviews(
        MoneyRepository(_apiWith(MockClient((_) {
          requested.complete();
          return response.future;
        }))),
        codec: const PlainWalletQueueCodec(),
      );
      final item = (await reviews.load()).single;
      final confirm = reviews.confirm(item: item, kind: 'expense', amount: '1');
      final rejected =
          expectLater(confirm, throwsA(isA<WalletLegacyHeldException>()));
      await requested.future;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('wallet_legacy_hold.in-flight-review', 'HELD');
      response.complete(http.Response('', 201));
      await rejected;
      // The remote request was already sent; this assertion concerns only the
      // local source and cannot undo an accepted remote transaction.
      expect(
          prefs.getString('pending_wallet_review.in-flight-review'), original);
    });

    test('a review whose item id differs from its key stays hidden and kept',
        () async {
      final original = _reviewItem('other');
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_review.mismatch': original,
      });
      final reviews = PendingWalletReviews(
        MoneyRepository(
            _apiWith(MockClient((_) async => http.Response('', 500)))),
        codec: const PlainWalletQueueCodec(),
      );
      expect(await reviews.load(), isEmpty);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_review.mismatch'), original);
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
      )), codec: const PlainWalletQueueCodec());

      await reviews.discard('gone');

      expect(called, isFalse);
      expect(await reviews.load(), isEmpty);
    });
  });

  group('Trusted sender normalization', () {
    test('keeps phone numbers numeric and normalizes alphanumeric IDs', () {
      expect(
        PendingWalletCandidates.normalizeTrustedSender('+20 100-123-4567'),
        '201001234567',
      );
      expect(
        PendingWalletCandidates.normalizeTrustedSender('  Bank-X 9  '),
        'BANKX9',
      );
    });

    test(
      'persists the key the native receiver reads and supports removal',
      () async {
        SharedPreferences.setMockInitialValues({});
        await PendingWalletCandidates.addTrustedSender('Bank-X 9');
        var prefs = await SharedPreferences.getInstance();
        expect(
          prefs.getString('wallet_trusted_senders'),
          jsonEncode(['BANKX9']),
        );
        // SharedPreferences normalizes platform-prefixed keys in its Dart API.
        // Reading the logical key above verifies the value used by the native
        // receiver without depending on mock/plugin `getKeys()` representation.

        await PendingWalletCandidates.removeTrustedSender('bank-x9');
        prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('wallet_trusted_senders'), jsonEncode([]));
      },
    );
  });

  group('PendingWalletCandidates.flush', () {
    test('queues a high-confidence parse for user review without saving it',
        () async {
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
        codec: const PlainWalletQueueCodec(),
      );

      final resolved = await candidates.flush();

      expect(resolved, 1);
      expect(requestedPaths.single, endsWith('/ingest/sms/analyze'));
      expect(sentKeys, isEmpty);
      final reviews = await PendingWalletReviews(
              MoneyRepository(_apiWith(MockClient(
                (request) async => http.Response('', 500),
              ))),
              codec: const PlainWalletQueueCodec())
          .load();
      expect(reviews, hasLength(1));
      expect(reviews.single.id, 'high');
      expect(reviews.single.amount, '450.00');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_candidate.high'), isNull);
    });

    test('low confidence becomes a review item instead of being saved',
        () async {
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
        codec: const PlainWalletQueueCodec(),
      );

      final resolved = await candidates.flush();

      expect(resolved, 1);
      expect(saved, isFalse);
      final reviews = await PendingWalletReviews(
              MoneyRepository(_apiWith(
                MockClient((request) async => http.Response('', 500)),
              )),
              codec: const PlainWalletQueueCodec())
          .load();
      expect(reviews, hasLength(1));
      expect(reviews.single.id, 'low');
      expect(reviews.single.amount, '450.00');
      final prefs = await SharedPreferences.getInstance();
      // The review item is written to the review queue, never back into the
      // candidate queue (that key would be analyzed again on the next flush).
      expect(prefs.getString('pending_wallet_review.low'), isNotNull);
      expect(prefs.getString('pending_wallet_candidate.low'), isNull);
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
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
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
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      expect(await candidates.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString('pending_wallet_candidate.later');
      expect(stored, isNotNull);
      expect(jsonDecode(stored!)['attempts'], 1);
    });

    test('a rejected candidate and an unreadable entry are quarantined',
        () async {
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
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      expect(await candidates.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      // A rejected request says nothing about the transaction: park its
      // original value instead of throwing the candidate away.
      expect(prefs.getString('pending_wallet_candidate.bad'), isNull);
      final parked = jsonDecode(
        prefs.getString('pending_wallet_quarantine.bad')!,
      ) as Map<String, dynamic>;
      expect(parked['reason'], PendingWalletCandidates.rejectedReason);
      expect(jsonDecode(parked['payload'] as String)['id'], 'bad');
      expect(jsonDecode(parked['payload'] as String)['text'],
          'Debited 450 EGP at UNKNOWN SHOP');

      // Malformed content is not deleted any more: it is quarantined, still
      // present, and the state is published for the UI (V-02).
      expect(prefs.getString('pending_wallet_candidate.junk'), isNull);
      expect(prefs.getString('pending_wallet_quarantine.junk'), isNotNull);
      expect(prefs.getString('wallet_sms_quarantined'), isNotNull);
    });

    for (final status in [400, 409, 422]) {
      test('HTTP $status retains the candidate without another request',
          () async {
        final original = _candidateItem('rejected');
        SharedPreferences.setMockInitialValues({
          'flutter.pending_wallet_candidate.rejected': original,
        });
        var calls = 0;
        final candidates = PendingWalletCandidates(
          _apiWith(MockClient((request) async {
            calls++;
            return http.Response(
              jsonEncode({
                'success': false,
                'error': {'code': 'REJECTED', 'message': 'Rejected'},
              }),
              status,
              headers: {'content-type': 'application/json'},
            );
          })),
          MoneyRepository(
              _apiWith(MockClient((request) async => http.Response('', 201)))),
          codec: const PlainWalletQueueCodec(),
        );

        expect(await candidates.flush(), 0);
        final prefs = await SharedPreferences.getInstance();
        final parked = jsonDecode(
          prefs.getString('pending_wallet_quarantine.rejected')!,
        ) as Map<String, dynamic>;
        expect(parked['reason'], PendingWalletCandidates.rejectedReason);
        expect(parked['payload'], original);
        expect(await WalletSmsQuarantineStatus.isQuarantined(), isTrue);
        expect(await candidates.flush(), 0);
        expect(calls, 1);
        expect(prefs.getString('pending_wallet_candidate.rejected'), isNull);
        expect(
            prefs.getString('pending_wallet_quarantine.rejected'), isNotNull);
      });
    }

    test('a rejected candidate stays put if quarantine encryption fails',
        () async {
      final original = _candidateItem('rejected');
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.rejected': original,
      });
      final codec = _FlakyCodec();
      codec.unwritableKeys.add('pending_wallet_quarantine.rejected');
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async => http.Response(
              jsonEncode({
                'success': false,
                'error': {'code': 'REJECTED', 'message': 'Rejected'},
              }),
              400,
              headers: {'content-type': 'application/json'},
            ))),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: codec,
      );

      expect(await candidates.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_candidate.rejected'), original);
      expect(prefs.getString('pending_wallet_quarantine.rejected'), isNull);
      expect(await WalletSmsQuarantineStatus.isQuarantined(), isTrue);
    });

    test(
        'a candidate that exhausted its attempts stops retrying but stays '
        'visible', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.old':
            _candidateItem('old', attempts: 5),
      });
      var called = false;
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async {
          called = true;
          return http.Response('', 200);
        })),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      await candidates.flush();

      expect(called, isFalse);
      final prefs = await SharedPreferences.getInstance();
      // Not deleted: dropping it would lose a reviewable financial message.
      final stored = prefs.getString('pending_wallet_candidate.old');
      expect(stored, isNotNull);
      expect(jsonDecode(stored!)['blocked'], isTrue);
      // A spent retry budget is an interpretation problem, not a stalled
      // provider: the quarantine state is published instead (V-01).
      expect(prefs.getString('wallet_sms_quarantined'), isNotNull);
    });

    test('an unknown analyze status is retried, never treated as handled',
        () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.future': _candidateItem('future'),
      });
      var calls = 0;
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async {
          calls++;
          return http.Response(
            _analyzeResponse(status: 'partially_recognized'),
            200,
            headers: {'content-type': 'application/json'},
          );
        })),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      // Nothing is resolved: the message is neither recognized nor rejected.
      expect(await candidates.flush(), 0);
      expect(calls, 1);
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString('pending_wallet_candidate.future');
      expect(stored, isNotNull, reason: 'an unknown status must not delete it');
      final decoded = jsonDecode(stored!) as Map<String, dynamic>;
      expect(decoded['attempts'], 1);
      expect(decoded['retryReason'], 'unknownStatus');
      expect(prefs.getString('wallet_sms_quarantined'), isNotNull);
    });

    test('an unreadable entry is quarantined and restored once it can be read',
        () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.sealed': _candidateItem('sealed'),
      });
      final codec = _FlakyCodec();
      codec.unreadableKeys.add('pending_wallet_candidate.sealed');
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async => http.Response(
              _analyzeResponse(status: 'unrecognized'),
              200,
              headers: {'content-type': 'application/json'},
            ))),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: codec,
      );

      await candidates.flush();
      final prefs = await SharedPreferences.getInstance();
      // Parked, not deleted, and the state is visible.
      expect(prefs.getString('pending_wallet_candidate.sealed'), isNull);
      expect(prefs.getString('pending_wallet_quarantine.sealed'), isNotNull);
      expect(prefs.getString('wallet_sms_quarantined'), isNotNull);

      // The value can be authenticated again: it goes back to its own queue
      // exactly once, and the published state is cleared.
      codec.unreadableKeys.clear();
      await candidates.flush();
      expect(prefs.getString('pending_wallet_quarantine.sealed'), isNull);
      expect(prefs.getString('pending_wallet_candidate.sealed'), isNotNull);
      expect(prefs.getString('wallet_sms_quarantined'), isNull);

      // The next round analyzes it normally.
      expect(await candidates.flush(), 1);
      expect(prefs.getString('pending_wallet_candidate.sealed'), isNull);
    });

    test('candidate collisions and mismatched IDs remain locked', () async {
      for (final caseName in ['review', 'quarantine', 'mismatch']) {
        final original =
            _candidateItem(caseName == 'mismatch' ? 'other' : 'same');
        final values = <String, Object>{
          'flutter.pending_wallet_candidate.same': original,
          if (caseName == 'review')
            'flutter.pending_wallet_review.same': _reviewItem('same'),
          if (caseName == 'quarantine')
            'flutter.pending_wallet_quarantine.same': 'opaque conflict',
        };
        SharedPreferences.setMockInitialValues(values);
        var calls = 0;
        final candidates = PendingWalletCandidates(
          _apiWith(MockClient((_) async {
            calls++;
            return http.Response(_analyzeResponse(status: 'unrecognized'), 200);
          })),
          MoneyRepository(
              _apiWith(MockClient((_) async => http.Response('', 201)))),
          codec: const PlainWalletQueueCodec(),
        );
        expect(await candidates.flush(), 0, reason: caseName);
        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('pending_wallet_candidate.same'), original);
        if (caseName == 'review') {
          expect(prefs.getString('pending_wallet_review.same'),
              _reviewItem('same'));
        }
        if (caseName == 'quarantine') {
          expect(prefs.getString('pending_wallet_quarantine.same'),
              'opaque conflict');
        }
        expect(prefs.getString('wallet_legacy_hold.same'), 'HELD');
        expect(await WalletSmsQuarantineStatus.isQuarantined(), isTrue);
        expect(calls, 0);
      }
    });

    test(
        'a review arriving during analysis cannot be overwritten or delete its source',
        () async {
      final original = _candidateItem('race');
      final existingReview = _reviewItem('race');
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.race': original,
      });
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((_) async {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('pending_wallet_review.race', existingReview);
          return http.Response(
            _analyzeResponse(
                status: 'recognized', transaction: _strictTransaction),
            200,
            headers: {'content-type': 'application/json'},
          );
        })),
        MoneyRepository(
            _apiWith(MockClient((_) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );
      expect(await candidates.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_candidate.race'), original);
      expect(prefs.getString('pending_wallet_review.race'), existingReview);
      expect(prefs.getString('wallet_legacy_hold.race'), 'HELD');
    });

    test('recovery preserves an occupied destination and the quarantine source',
        () async {
      const existing = 'existing transaction';
      final quarantine = jsonEncode({
        'origin': 'pending_wallet_tx.',
        'reason': 'UNREADABLE',
        'attempts': 0,
        'payload': 'another opaque record',
        'quarantinedAtMs': DateTime.now().millisecondsSinceEpoch,
      });
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_tx.same': existing,
        'flutter.pending_wallet_quarantine.same': quarantine,
      });
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((_) async => http.Response('', 200))),
        MoneyRepository(
            _apiWith(MockClient((_) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );
      expect(await candidates.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_tx.same'), existing);
      expect(prefs.getString('pending_wallet_quarantine.same'), quarantine);
      expect(prefs.getString('wallet_legacy_hold.same'), 'HELD');
    });

    test('an orphaned hold marker alone does not show a quarantine notice',
        () async {
      SharedPreferences.setMockInitialValues({
        'flutter.wallet_legacy_hold.orphan': 'HELD',
      });
      expect(await WalletSmsQuarantineStatus.isQuarantined(), isFalse);
    });

    test('quarantine recovery refuses unrelated destination prefixes',
        () async {
      final quarantine = jsonEncode({
        'origin': 'pending_wallet_unrelated.',
        'reason': 'UNREADABLE',
        'attempts': 0,
        'payload': 'wrong destination data',
        'quarantinedAtMs': DateTime.now().millisecondsSinceEpoch,
      });
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_quarantine.same': quarantine,
        'flutter.pending_wallet_unrelated.same': 'preserve me',
      });
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((_) async => http.Response('', 200))),
        MoneyRepository(
            _apiWith(MockClient((_) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );
      await candidates.flush();
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_unrelated.same'), 'preserve me');
      expect(prefs.getString('pending_wallet_quarantine.same'), quarantine);
    });

    test('a malformed entry is never restored into a parse loop', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.junk': 'not json',
      });
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async => http.Response('', 200))),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      await candidates.flush();
      await candidates.flush();
      final prefs = await SharedPreferences.getInstance();
      // Parked exactly once: restoring it would bounce between the two queues.
      expect(prefs.getString('pending_wallet_quarantine.junk'), isNotNull);
      expect(prefs.getString('pending_wallet_candidate.junk'), isNull);
    });

    test(
        'old or undated quarantine entries remain unchanged and are not revived',
        () async {
      final stale = jsonEncode({
        'origin': PendingWalletCandidates.keyPrefix,
        'reason': 'UNREADABLE',
        'attempts': 0,
        'payload': _candidateItem('stale'),
        'quarantinedAtMs': DateTime.now().millisecondsSinceEpoch -
            const Duration(days: 8).inMilliseconds,
      });
      final undated = jsonEncode({
        'origin': PendingWalletCandidates.keyPrefix,
        'reason': 'UNREADABLE',
        'attempts': 0,
        'payload': _candidateItem('undated'),
      });
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_quarantine.stale': stale,
        'flutter.pending_wallet_quarantine.undated': undated,
        'flutter.wallet_sms_quarantined': '{"count":1,"lastAtMs":1}',
      });
      var calls = 0;
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async {
          calls++;
          return http.Response('', 200);
        })),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      await candidates.flush();
      await candidates.flush();
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_quarantine.stale'), stale);
      expect(prefs.getString('pending_wallet_quarantine.undated'), undated);
      expect(prefs.getString('pending_wallet_candidate.stale'), isNull);
      expect(prefs.getString('pending_wallet_candidate.undated'), isNull);
      expect(prefs.getString('wallet_sms_quarantined'), isNotNull);
      expect(calls, 0);
    });

    test('an unavailable fallback keeps the candidate for a later attempt',
        () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.later': _candidateItem('later'),
      });
      var attempts = 0;
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async {
          attempts++;
          return http.Response(
            jsonEncode({
              'success': false,
              'error': {
                'code': 'SMS_FALLBACK_UNAVAILABLE',
                'message':
                    'SMS analysis is temporarily unavailable; retry later',
              },
            }),
            503,
            headers: {'content-type': 'application/json'},
          );
        })),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      // "unavailable" is not a verdict on the message: nothing is resolved.
      expect(await candidates.flush(), 0);
      expect(attempts, 1);

      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString('pending_wallet_candidate.later');
      expect(stored, isNotNull);
      final decoded = jsonDecode(stored!) as Map<String, dynamic>;
      expect(decoded['attempts'], 1);
      expect(decoded['nextAttemptAtMs'], isNotNull);
      // The stalled fallback is published so the UI can surface it.
      expect(prefs.getString('wallet_sms_fallback_unavailable'), isNotNull);
    });

    test('a fifth unavailable response keeps the candidate blocked and visible',
        () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.limit':
            _candidateItem('limit', attempts: 4),
      });
      var calls = 0;
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async {
          calls++;
          return http.Response(
            jsonEncode({
              'success': false,
              'error': {
                'code': 'SMS_FALLBACK_UNAVAILABLE',
                'message':
                    'SMS analysis is temporarily unavailable; retry later',
              },
            }),
            503,
            headers: {'content-type': 'application/json'},
          );
        })),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      expect(await candidates.flush(), 0);
      expect(calls, 1);
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString('pending_wallet_candidate.limit');
      expect(stored, isNotNull);
      final decoded = jsonDecode(stored!) as Map<String, dynamic>;
      expect(decoded['attempts'], 5);
      expect(decoded['blocked'], isTrue);
      expect(decoded['retryReason'], 'unavailable');
      expect(prefs.getString('wallet_sms_fallback_unavailable'), isNotNull);
      expect(await candidates.flush(), 0);
      expect(calls, 1);
    });

    test('an unavailable status inside a 200 body is also retryable', () async {
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.soft': _candidateItem('soft'),
      });
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async => http.Response(
              _analyzeResponse(status: 'unavailable'),
              200,
              headers: {'content-type': 'application/json'},
            ))),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      expect(await candidates.flush(), 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_candidate.soft'), isNotNull);
    });

    test('recorded age holds survive a backward clock change in both queues',
        () async {
      final actual = DateTime.now();
      var clock = actual.add(const Duration(days: 8));
      final candidate = _candidateItem('held-candidate',
          receivedAtMs: actual.millisecondsSinceEpoch);
      final quarantine = jsonEncode({
        'origin': PendingWalletCandidates.keyPrefix,
        'reason': 'UNREADABLE',
        'attempts': 0,
        'payload': _candidateItem('held-quarantine'),
        'quarantinedAtMs': actual.millisecondsSinceEpoch,
      });
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.held-candidate': candidate,
        'flutter.pending_wallet_quarantine.held-quarantine': quarantine,
      });
      var calls = 0;
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((_) async {
          calls++;
          return http.Response('', 200);
        })),
        MoneyRepository(
            _apiWith(MockClient((_) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
        clock: () => clock,
      );
      expect(await candidates.flush(), 0);
      var prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('wallet_legacy_hold.held-candidate'), 'HELD');
      expect(prefs.getString('wallet_legacy_hold.held-quarantine'), 'HELD');
      clock = actual.subtract(const Duration(days: 1));
      expect(await candidates.flush(), 0);
      prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_candidate.held-candidate'),
          candidate);
      expect(prefs.getString('pending_wallet_quarantine.held-quarantine'),
          quarantine);
      expect(
          prefs.getString('pending_wallet_candidate.held-quarantine'), isNull);
      expect(calls, 0);
    });

    test(
        'a hold arriving during analysis preserves the source after the response',
        () async {
      final candidate = _candidateItem('in-flight');
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.in-flight': candidate,
      });
      final started = Completer<void>();
      final response = Completer<http.Response>();
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((_) {
          started.complete();
          return response.future;
        })),
        MoneyRepository(
            _apiWith(MockClient((_) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );
      final flush = candidates.flush();
      await started.future;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('wallet_legacy_hold.in-flight', 'HELD');
      response.complete(http.Response(
        _analyzeResponse(status: 'recognized', transaction: _strictTransaction),
        200,
        headers: {'content-type': 'application/json'},
      ));
      expect(await flush, 0);
      expect(prefs.getString('pending_wallet_candidate.in-flight'), candidate);
      expect(prefs.getString('pending_wallet_review.in-flight'), isNull);
    });

    test('old or undated candidates stay unchanged and are not sent', () async {
      final stale = _candidateItem('stale',
          receivedAtMs: DateTime.now().millisecondsSinceEpoch -
              const Duration(days: 8).inMilliseconds);
      final undated = jsonEncode({
        'id': 'undated',
        'text': 'Debited 10 EGP',
        'sender': '[PHONE]',
        'attempts': 0,
      });
      final zero = _candidateItem('zero', receivedAtMs: 0);
      SharedPreferences.setMockInitialValues({
        'flutter.pending_wallet_candidate.stale': stale,
        'flutter.pending_wallet_candidate.undated': undated,
        'flutter.pending_wallet_candidate.zero': zero,
      });
      var calls = 0;
      final candidates = PendingWalletCandidates(
        _apiWith(MockClient((request) async {
          calls++;
          return http.Response('', 200);
        })),
        MoneyRepository(
            _apiWith(MockClient((request) async => http.Response('', 201)))),
        codec: const PlainWalletQueueCodec(),
      );

      await candidates.flush();
      await candidates.flush();
      expect(calls, 0);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('pending_wallet_candidate.stale'), stale);
      expect(prefs.getString('pending_wallet_candidate.undated'), undated);
      expect(prefs.getString('pending_wallet_candidate.zero'), zero);
    });
  });
}
