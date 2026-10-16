// Authored tests; require Flutter SDK. Not executed by WASM/Node source checks.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/core/archive/archive_cancellation.dart';
import 'package:lifestyle_mobile/core/archive/archive_verifier.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'api_client_test.dart' show MemoryTokenStore;

SessionTokens tokens(String access, String refresh) => SessionTokens(
    accessToken: access,
    refreshToken: refresh,
    accessTokenExpiresAt: DateTime.utc(2030),
    refreshTokenExpiresAt: DateTime.utc(2030));
http.StreamedResponse response(Stream<List<int>> bytes,
        [int status = 200, String type = 'application/x-ndjson']) =>
    http.StreamedResponse(bytes, status, headers: {'content-type': type});

void main() {
  test(
      'dedicated streamed client disables redirects and refreshes explicit TOKEN_EXPIRED only once',
      () async {
    final store = MemoryTokenStore(tokens('old', 'refresh-old'));
    var refreshes = 0, sends = 0;
    final dedicated = StreamClient((request) async {
      expect(request.followRedirects, false);
      expect(request.maxRedirects, 0);
      expect(request.url.path, '/api/v1/users/me/export/archive');
      expect(jsonDecode((request as http.Request).body),
          {'currentPassword': ' proof with spaces '});
      sends++;
      if (sends == 1) {
        expect(request.headers['authorization'], 'Bearer old');
        return response(
            Stream.value(utf8.encode(jsonEncode({
              'error': {'code': 'TOKEN_EXPIRED'}
            }))),
            401,
            'application/json');
      }
      expect(request.headers['authorization'], 'Bearer new');
      return response(Stream.value(
          File('test/fixtures/account_archive_v1.ndjson').readAsBytesSync()));
    });
    final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        archiveClientFactory: () => dedicated,
        httpClient: MockClient((request) async {
          refreshes++;
          expect(request.url.path.endsWith('auth/refresh'), true);
          return http.Response(
              jsonEncode(tokens('new', 'refresh-new').toJson()), 200);
        }));
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    final output = await client
        .streamAccountArchive(' proof with spaces ', cancel)
        .expand((chunk) => chunk)
        .toList();
    expect(output,
        File('test/fixtures/account_archive_v1.ndjson').readAsBytesSync());
    expect(sends, 2);
    expect(refreshes, 1);
    expect(dedicated.closed, true);
    cancel.cancel();
  });
  for (final status in [302, 400, 401, 403, 429, 503]) {
    test('status $status without explicit expiry never refreshes or retries',
        () async {
      var sends = 0, refreshes = 0;
      final stream = StreamClient((_) async {
        sends++;
        return response(
            Stream.value(
                utf8.encode('{"error":{"message":"private-provider-text"}}')),
            status,
            'application/json');
      });
      final client = ApiClient(
          baseUri: Uri.parse('https://api.example.test/api/v1/'),
          tokenStore: MemoryTokenStore(tokens('access', 'refresh')),
          archiveClientFactory: () => stream,
          httpClient: MockClient((_) async {
            refreshes++;
            return http.Response('{}', 500);
          }));
      addTearDown(client.close);
      final cancel = ArchiveCancellation();
      await expectLater(
          client.streamAccountArchive('proof', cancel).drain<void>(),
          throwsA(isA<ApiException>()));
      expect(sends, 1);
      expect(refreshes, 0);
      expect(stream.closed, true);
      cancel.cancel();
    });
  }
  test('partial network failure is sanitized and never replayed', () async {
    var sends = 0;
    Stream<List<int>> partial() async* {
      yield utf8.encode('{');
      throw StateError('private-provider-text');
    }

    final dedicated = StreamClient((_) async {
      sends++;
      return response(partial());
    });
    final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: MemoryTokenStore(tokens('access', 'refresh')),
        archiveClientFactory: () => dedicated);
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    await expectLater(
        client.streamAccountArchive('proof', cancel).drain<void>(),
        throwsA(isA<ArchiveException>()));
    expect(sends, 1);
    expect(dedicated.closed, true);
    cancel.cancel();
  });
  test(
      'cancellation closes only the dedicated connection, not the shared client',
      () async {
    final source = StreamController<List<int>>();
    final dedicated = StreamClient((_) async => response(source.stream),
        onClose: () => unawaited(source.close()));
    final shared = StreamClient((_) async =>
        response(Stream.value(utf8.encode('{}')), 200, 'application/json'));
    final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: MemoryTokenStore(tokens('access', 'refresh')),
        httpClient: shared,
        archiveClientFactory: () => dedicated);
    addTearDown(client.close);
    final cancel = ArchiveCancellation();
    final pending = expectLater(
        client.streamAccountArchive('proof', cancel).drain<void>(),
        throwsA(isA<ArchiveException>()));
    await Future<void>.delayed(Duration.zero);
    cancel.cancel();
    await pending;
    expect(dedicated.closed, true);
    expect(shared.closed, false);
  });
}

class StreamClient extends http.BaseClient {
  StreamClient(this.reply, {this.onClose});
  final Future<http.StreamedResponse> Function(http.BaseRequest) reply;
  final void Function()? onClose;
  bool closed = false;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      reply(request);
  @override
  void close() {
    closed = true;
    onClose?.call();
  }
}
