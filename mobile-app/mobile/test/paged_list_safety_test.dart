import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/paged_list.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';

class _NoTokenStore implements TokenStore {
  @override
  Future<void> clear() async {}
  @override
  Future<SessionTokens?> read() async => null;
  @override
  Future<void> write(SessionTokens tokens) async {}
}

ApiClient _client(Map<String, dynamic> Function(Uri) page) => ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: _NoTokenStore(),
      httpClient: MockClient((req) async => http.Response(
          jsonEncode(page(req.url)), 200,
          headers: {'content-type': 'application/json'})),
    );

void main() {
  test('a missing cursor or metadata is not mistaken for a complete result',
      () async {
    for (final response in [
      {'data': <dynamic>[]},
      {'data': <dynamic>[], 'meta': <String, dynamic>{}},
      {
        'data': <dynamic>[],
        'meta': {'nextCursor': 123}
      },
      {
        'data': <dynamic>[],
        'meta': {'nextCursor': ''}
      },
      {
        'data': [<String, dynamic>{}],
        'meta': {'nextCursor': null}
      },
    ]) {
      final client = _client((_) => response);
      await expectLater(fetchAllPages(client, 'tasks', requireComplete: true),
          throwsFormatException);
      client.close();
    }
  });

  test(
      'repeated records and repeated cursors fail rather than duplicating data',
      () async {
    final duplicate = _client((url) => {
          'data': [
            {'id': 'same'}
          ],
          'meta': {
            'nextCursor': url.queryParameters['cursor'] == null ? 'next' : null
          }
        });
    await expectLater(fetchAllPages(duplicate, 'tasks', requireComplete: true),
        throwsFormatException);
    duplicate.close();

    final repeating = _client((url) => {
          'data': [
            {'id': url.queryParameters['cursor'] ?? 'first'}
          ],
          'meta': {'nextCursor': 'next'}
        });
    await expectLater(fetchAllPages(repeating, 'tasks', requireComplete: true),
        throwsFormatException);
    repeating.close();
  });

  test('empty pages cannot continue indefinitely', () async {
    final client = _client((_) => {
          'data': <dynamic>[],
          'meta': {'nextCursor': 'next'}
        });
    await expectLater(fetchAllPages(client, 'tasks', requireComplete: true),
        throwsFormatException);
    client.close();
  });

  test('strict reads fail at the page limit; non-strict reads remain bounded',
      () async {
    final client = _client((_) => {
          'data': [
            {'id': 'first'}
          ],
          'meta': {'nextCursor': 'next'}
        });
    await expectLater(
        fetchAllPages(client, 'tasks', maxPages: 1, requireComplete: true),
        throwsStateError);
    final partial = await fetchAllPages(client, 'tasks', maxPages: 1);
    expect(partial.single['id'], 'first');
    client.close();
  });

  test('complete pages return all items exactly once', () async {
    final client = _client((url) => {
          'data': [
            {'id': url.queryParameters['cursor'] ?? 'first'}
          ],
          'meta': {
            'nextCursor':
                url.queryParameters['cursor'] == null ? 'second' : null
          }
        });
    final items = await fetchAllPages(client, 'tasks', requireComplete: true);
    expect(items.map((item) => item['id']).toList(), ['first', 'second']);
    client.close();
  });
}
