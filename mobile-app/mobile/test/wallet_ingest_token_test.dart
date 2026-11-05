import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_ingest_token.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Credentials implements WalletCredentialStore {
  String? token;
  String? owner;
  bool failWrite = false;
  Completer<void>? writeStarted;
  Completer<void>? finishWrite;
  @override
  Future<bool> hasTokenFor(String ownerId) async =>
      token != null && owner == ownerId;
  @override
  Future<void> writeBound(String token, String ownerId) async {
    if (failWrite) throw StateError('secure storage failed');
    this.token = token;
    owner = ownerId;
    writeStarted?.complete();
    if (finishWrite != null) await finishWrite!.future;
  }

  @override
  Future<void> clearIfMatches(String expected) async {
    if (token == expected) await clear();
  }

  @override
  Future<void> clear() async {
    token = null;
    owner = null;
  }
}

class _SignedInStore implements TokenStore {
  @override
  Future<SessionTokens?> read() async => SessionTokens(
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: DateTime.utc(2030),
        refreshTokenExpiresAt: DateTime.utc(2030),
      );

  @override
  Future<void> write(SessionTokens tokens) async {}

  @override
  Future<void> clear() async {}
}

ApiClient _apiWith(http.Client httpClient) => ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: _SignedInStore(),
      httpClient: httpClient,
    );

http.Response _json(int status, Map<String, Object?> body) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherAccount = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

void main() {
  late _Credentials credentials;
  setUp(() {
    credentials = _Credentials();
  });
  test('does nothing while SMS capture is off', () async {
    SharedPreferences.setMockInitialValues({});
    var requests = 0;
    final api = _apiWith(
      MockClient((request) async {
        requests++;
        return _json(201, {'token': 'lsi_unused', 'ownerId': account});
      }),
    );

    await WalletIngestToken(api, credentials: credentials)
        .ensure(account: account, currentAccount: () => account);

    expect(requests, 0);
  });

  test('issues and stores a token when SMS capture is on', () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    late http.Request captured;
    final api = _apiWith(
      MockClient((request) async {
        captured = request;
        return _json(201, {'token': 'lsi_issued', 'ownerId': account});
      }),
    );

    await WalletIngestToken(api, credentials: credentials)
        .ensure(account: account, currentAccount: () => account);

    expect(captured.method, 'POST');
    expect(captured.url.path, '/api/v1/ingest/token');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), isNull);
    expect(credentials.token, 'lsi_issued');
    expect(credentials.owner, account);
  });

  test('keeps the stored token unless it is forced to be replaced', () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    var requests = 0;
    final api = _apiWith(
      MockClient((request) async {
        requests++;
        return _json(201, {'token': 'lsi_replacement', 'ownerId': account});
      }),
    );
    credentials.token = 'lsi_existing';
    credentials.owner = account;
    final walletToken = WalletIngestToken(api, credentials: credentials);

    await walletToken.ensure(account: account, currentAccount: () => account);
    expect(requests, 0);

    await walletToken.ensure(
        account: account, currentAccount: () => account, force: true);
    expect(requests, 1);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), isNull);
    expect(credentials.token, 'lsi_replacement');
  });

  test('stores nothing when the backend refuses to issue a token', () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    final api = _apiWith(
      MockClient((request) async => _json(500, {
            'error': {'code': 'X'}
          })),
    );

    await expectLater(
      WalletIngestToken(api, credentials: credentials)
          .ensure(account: account, currentAccount: () => account),
      throwsA(isA<ApiException>()),
    );

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), isNull);
  });

  test('revoke removes the local copy and calls DELETE on the backend',
      () async {
    SharedPreferences.setMockInitialValues({});
    late http.Request captured;
    final api = _apiWith(
      MockClient((request) async {
        captured = request;
        return http.Response('', 204);
      }),
    );

    credentials.token = 'lsi_to_revoke';
    await WalletIngestToken(api, credentials: credentials).revoke();
    expect(credentials.token, isNull);

    expect(captured.method, 'DELETE');
    expect(captured.url.path, '/api/v1/ingest/token');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), isNull);
  });

  test('clearLocal removes the token without any request', () async {
    SharedPreferences.setMockInitialValues({});

    credentials.token = 'lsi_signed_out';
    await WalletIngestToken.clearLocal(credentials: credentials);
    expect(credentials.token, isNull);

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), isNull);
  });
  test('secure-store failure never falls back to plaintext preferences',
      () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    credentials.failWrite = true;
    final api = _apiWith(MockClient(
        (_) async => _json(201, {'token': 'lsi_secret', 'ownerId': account})));
    await expectLater(
        WalletIngestToken(api, credentials: credentials)
            .ensure(account: account, currentAccount: () => account),
        throwsStateError);
    expect(
        (await SharedPreferences.getInstance())
            .getString(WalletIngestToken.storageKey),
        isNull);
  });

  test('legacy token has no owner and is replaced, not assigned an owner',
      () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    credentials.token = 'legacy-token';
    final api = _apiWith(MockClient(
        (_) async => _json(201, {'token': 'fresh-token', 'ownerId': account})));
    await WalletIngestToken(api, credentials: credentials).ensure(
      account: account,
      currentAccount: () => account,
    );
    expect(credentials.token, 'fresh-token');
    expect(credentials.owner, account);
  });

  test('rejects a token issued to a different account', () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    final api = _apiWith(MockClient((_) async =>
        _json(201, {'token': 'wrong-token', 'ownerId': otherAccount})));
    await expectLater(
      WalletIngestToken(api, credentials: credentials).ensure(
        account: account,
        currentAccount: () => account,
      ),
      throwsStateError,
    );
    expect(credentials.token, isNull);
    expect(credentials.owner, isNull);
  });

  test('an older server without owner metadata does not guess an account',
      () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    credentials.token = 'legacy-token';
    final api =
        _apiWith(MockClient((_) async => _json(201, {'token': 'new-token'})));
    await expectLater(
      WalletIngestToken(api, credentials: credentials).ensure(
        account: account,
        currentAccount: () => account,
      ),
      throwsFormatException,
    );
    expect(credentials.owner, isNull);
    expect(credentials.token, 'legacy-token');
  });

  test('a response arriving after account change is never saved', () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    var current = account;
    final requested = Completer<void>();
    final response = Completer<http.Response>();
    final api = _apiWith(MockClient((_) {
      requested.complete();
      return response.future;
    }));
    final issue = WalletIngestToken(api, credentials: credentials).ensure(
      account: account,
      currentAccount: () => current,
    );
    await requested.future;
    current = otherAccount;
    response.complete(_json(201, {'token': 'old-token', 'ownerId': account}));
    await expectLater(issue, throwsStateError);
    expect(credentials.token, isNull);
  });

  test('sign-out invalidation prevents a delayed issue from restoring a token',
      () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    final requested = Completer<void>();
    final response = Completer<http.Response>();
    final api = _apiWith(MockClient((_) {
      requested.complete();
      return response.future;
    }));
    final issue = WalletIngestToken(api, credentials: credentials).ensure(
      account: account,
      currentAccount: () => account,
    );
    await requested.future;
    WalletIngestToken.invalidatePending();
    final clear = WalletIngestToken.clearLocal(credentials: credentials);
    // Local sign-out cleanup must not wait for a stalled issuance request.
    await clear.timeout(const Duration(seconds: 1));
    response.complete(_json(201, {'token': 'old-token', 'ownerId': account}));
    await expectLater(issue, throwsStateError);
    expect(credentials.token, isNull);
  });

  test(
      'invalidating a credential while its write is in flight clears that token',
      () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    credentials.writeStarted = Completer<void>();
    credentials.finishWrite = Completer<void>();
    final api = _apiWith(MockClient((_) async =>
        _json(201, {'token': 'in-flight-token', 'ownerId': account})));
    final issue = WalletIngestToken(api, credentials: credentials).ensure(
      account: account,
      currentAccount: () => account,
    );
    await credentials.writeStarted!.future;
    WalletIngestToken.invalidatePending();
    credentials.finishWrite!.complete();
    await expectLater(issue, throwsStateError);
    expect(credentials.token, isNull);
    expect(credentials.owner, isNull);
  });

  test('concurrent ensures reuse one issued token for the same account',
      () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    var requests = 0;
    final api = _apiWith(MockClient((_) async {
      requests++;
      return _json(201, {'token': 'new-token', 'ownerId': account});
    }));
    final token = WalletIngestToken(api, credentials: credentials);
    await Future.wait([
      token.ensure(account: account, currentAccount: () => account),
      token.ensure(account: account, currentAccount: () => account),
    ]);
    expect(requests, 1);
    expect(credentials.owner, account);
    expect(credentials.token, 'new-token');
  });
}
