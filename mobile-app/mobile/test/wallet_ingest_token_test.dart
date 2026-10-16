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
  bool failWrite = false;
  @override
  Future<bool> hasToken() async => token != null;
  @override
  Future<void> write(String token) async {
    if (failWrite) throw StateError('secure storage failed');
    this.token = token;
  }

  @override
  Future<void> clear() async {
    token = null;
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
        return _json(201, {'token': 'lsi_unused'});
      }),
    );

    await WalletIngestToken(api, credentials: credentials).ensure();

    expect(requests, 0);
  });

  test('issues and stores a token when SMS capture is on', () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    late http.Request captured;
    final api = _apiWith(
      MockClient((request) async {
        captured = request;
        return _json(201, {'token': 'lsi_issued'});
      }),
    );

    await WalletIngestToken(api, credentials: credentials).ensure();

    expect(captured.method, 'POST');
    expect(captured.url.path, '/api/v1/ingest/token');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), isNull);
    expect(credentials.token, 'lsi_issued');
  });

  test('keeps the stored token unless it is forced to be replaced', () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    var requests = 0;
    final api = _apiWith(
      MockClient((request) async {
        requests++;
        return _json(201, {'token': 'lsi_replacement'});
      }),
    );
    credentials.token = 'lsi_existing';
    final walletToken = WalletIngestToken(api, credentials: credentials);

    await walletToken.ensure();
    expect(requests, 0);

    await walletToken.ensure(force: true);
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
      WalletIngestToken(api, credentials: credentials).ensure(),
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
    final api =
        _apiWith(MockClient((_) async => _json(201, {'token': 'lsi_secret'})));
    await expectLater(WalletIngestToken(api, credentials: credentials).ensure(),
        throwsStateError);
    expect(
        (await SharedPreferences.getInstance())
            .getString(WalletIngestToken.storageKey),
        isNull);
  });
}
