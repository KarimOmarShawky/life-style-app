import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_reminders.dart';

class _Store implements TokenStore {
  @override
  Future<void> clear() async {}
  @override
  Future<SessionTokens?> read() async => SessionTokens(
        accessToken: 'token',
        refreshToken: 'refresh',
        accessTokenExpiresAt: DateTime.utc(2100),
        refreshTokenExpiresAt: DateTime.utc(2100),
      );
  @override
  Future<void> write(SessionTokens value) async {}
}

Map<String, Object> _subscription(String id) => {
      'id': id,
      'name': 'Private subscription name',
      'amount': '10.00',
      'currency': 'USD',
      'billingUnit': 'month',
      'billingInterval': 1,
      'anchorDate': '2026-01-31',
      'nextBillingDate': '2026-01-31',
      'status': 'active',
      'monthlyEquivalent': '10.0000',
      'daysUntilNextBilling': 0,
      'version': 1,
    };

http.Response _page(List<Map<String, Object>> subscriptions,
        {required bool hasMore, String? cursor}) =>
    http.Response(
      jsonEncode({
        'success': true,
        'data': {
          'subscriptions': subscriptions,
          'meta': {'hasMore': hasMore, 'nextCursor': cursor}
        }
      }),
      200,
      headers: {'content-type': 'application/json'},
    );

MoneyRepository _repository(http.Client client) => MoneyRepository(ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: _Store(),
      httpClient: client,
    ));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.example.lifestyle_mobile/native_voice');
  const account = '6f1c2d3e-0000-4000-8000-000000000001';
  final calls = <MethodCall>[];

  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return null;
    });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('sync reads all pages and sends no name, amount or currency to Android',
      () async {
    final requests = <Uri>[];
    final repo = _repository(MockClient((request) async {
      requests.add(request.url);
      if (request.url.queryParameters['cursor'] == null) {
        return _page([_subscription('first')], hasMore: true, cursor: 'next');
      }
      return _page([_subscription('second')], hasMore: false);
    }));
    await SubscriptionReminders.sync(
        account: account, repository: repo, currentAccount: () => account);
    expect(requests, hasLength(2));
    expect(requests.every((url) => url.queryParameters['status'] == 'active'),
        isTrue);
    expect(calls, hasLength(1));
    expect(calls.single.method, 'replaceSubscriptionReminders');
    final payload = calls.single.arguments as Map<dynamic, dynamic>;
    final schedules = payload['schedules'] as List<dynamic>;
    expect(schedules, hasLength(2));
    for (final entry in schedules) {
      expect((entry as Map<dynamic, dynamic>).keys.toSet(), {
        'id',
        'anchorDate',
        'nextBillingDate',
        'billingUnit',
        'billingInterval'
      });
    }
    expect(jsonEncode(payload), isNot(contains('Private subscription name')));
    expect(jsonEncode(payload), isNot(contains('10.00')));
  });

  test('automatic sync reports a native scheduling failure', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      throw PlatformException(code: 'reminders_unavailable');
    });
    final repo = _repository(
      MockClient((_) async => _page([_subscription('first')], hasMore: false)),
    );

    await expectLater(
      SubscriptionReminders.sync(
        account: account,
        repository: repo,
        currentAccount: () => account,
      ),
      throwsA(isA<PlatformException>()),
    );
    expect(calls.single.method, 'replaceSubscriptionReminders');
  });

  test('a malformed later page does not replace an existing reminder snapshot',
      () async {
    final repo = _repository(MockClient((request) async {
      if (request.url.queryParameters['cursor'] == null) {
        return _page([_subscription('first')], hasMore: true, cursor: 'next');
      }
      return _page([], hasMore: true, cursor: 'next');
    }));
    await expectLater(
      SubscriptionReminders.sync(
          account: account, repository: repo, currentAccount: () => account),
      throwsFormatException,
    );
    expect(calls, isEmpty);
  });

  test('a response for a signed-out account cannot re-register reminders',
      () async {
    var current = account;
    final pending = Completer<http.Response>();
    final requested = Completer<void>();
    final repo = _repository(MockClient((_) {
      requested.complete();
      return pending.future;
    }));
    final sync = SubscriptionReminders.sync(
        account: account, repository: repo, currentAccount: () => current);
    await requested.future;
    current = '';
    pending.complete(_page([_subscription('first')], hasMore: false));
    await expectLater(sync, throwsStateError);
    expect(calls, isEmpty);
  });
}
