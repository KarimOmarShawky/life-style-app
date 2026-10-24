import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_repository.dart';
import 'package:lifestyle_mobile/features/calendar/data/reminder_channel.dart';

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

void main() {
  test('the supported reminder channel is in_app', () {
    expect(CalendarReminderChannel.inApp, 'in_app');
  });

  test('event creation and addReminder use the same deliverable channel',
      () async {
    final bodies = <Map<String, dynamic>>[];
    final client = MockClient((request) async {
      bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
      return http.Response(
        jsonEncode({
          'event': {
            'id': 'event-1',
            'title': 'Standup',
            'startAt': '2026-10-24T09:00:00.000Z',
            'endAt': '2026-10-24T09:30:00.000Z',
            'allDay': false,
            'timezone': 'UTC',
            'reminders': <Object>[],
            'version': 1,
          },
        }),
        201,
        headers: {'content-type': 'application/json'},
      );
    });
    final repository = CalendarRepository(_apiWith(client));

    await repository.createEvent({
      'title': 'Standup',
      'startAt': '2026-10-24T09:00:00.000Z',
      'endAt': '2026-10-24T09:30:00.000Z',
      'allDay': false,
      'timezone': 'UTC',
      'reminders': [
        {'channel': CalendarReminderChannel.inApp, 'offsetMinutes': 15},
      ],
    });
    await repository.addReminder('event-1', 15);

    expect(bodies, hasLength(2));
    for (final body in bodies) {
      final channel = body['channel'] ??
          (body['reminders'] as List<dynamic>).single['channel'];
      // The reminder worker has no push provider: a push row can never be
      // delivered and would only fail after five retries (F-04).
      expect(channel, 'in_app');
      expect(channel, isNot('push'));
    }
  });
}
