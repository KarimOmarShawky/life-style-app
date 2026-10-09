import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_ingest_token.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
  test('does nothing while SMS capture is off', () async {
    SharedPreferences.setMockInitialValues({});
    var requests = 0;
    final api = _apiWith(
      MockClient((request) async {
        requests++;
        return _json(201, {'token': 'lsi_unused'});
      }),
    );

    await WalletIngestToken(api).ensure();

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

    await WalletIngestToken(api).ensure();

    expect(captured.method, 'POST');
    expect(captured.url.path, '/api/v1/ingest/token');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), 'lsi_issued');
  });

  test('keeps the stored token unless it is forced to be replaced', () async {
    SharedPreferences.setMockInitialValues({
      'sms_sync_enabled': true,
      WalletIngestToken.storageKey: 'lsi_existing',
    });
    var requests = 0;
    final api = _apiWith(
      MockClient((request) async {
        requests++;
        return _json(201, {'token': 'lsi_replacement'});
      }),
    );
    final walletToken = WalletIngestToken(api);

    await walletToken.ensure();
    expect(requests, 0);

    await walletToken.ensure(force: true);
    expect(requests, 1);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), 'lsi_replacement');
  });

  test('stores nothing when the backend refuses to issue a token', () async {
    SharedPreferences.setMockInitialValues({'sms_sync_enabled': true});
    final api = _apiWith(
      MockClient((request) async => _json(500, {'error': {'code': 'X'}})),
    );

    await WalletIngestToken(api).ensure();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), isNull);
  });

  test('revoke removes the local copy and calls DELETE on the backend', () async {
    SharedPreferences.setMockInitialValues({
      WalletIngestToken.storageKey: 'lsi_to_revoke',
    });
    late http.Request captured;
    final api = _apiWith(
      MockClient((request) async {
        captured = request;
        return http.Response('', 204);
      }),
    );

    await WalletIngestToken(api).revoke();

    expect(captured.method, 'DELETE');
    expect(captured.url.path, '/api/v1/ingest/token');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), isNull);
  });

  test('clearLocal removes the token without any request', () async {
    SharedPreferences.setMockInitialValues({
      WalletIngestToken.storageKey: 'lsi_signed_out',
    });

    await WalletIngestToken.clearLocal();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(WalletIngestToken.storageKey), isNull);
  });
}
