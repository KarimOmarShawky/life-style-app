import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/more/data/daily_plan_models.dart';

SessionTokens _tokens() => SessionTokens(
  accessToken: 'access-token',
  accessTokenExpiresAt: DateTime.utc(2026, 10, 12, 12),
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: DateTime.utc(2026, 11, 12, 12),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AiService BYOK lifecycle & circuit breaker', () {
    setUp(() async {
      await AiService.instance.setUserApiKey(null);
      AiService.instance.resetFailureCount();
    });

    test('stores, uses, and clears user BYOK key with X-goog-api-key header', () async {
      expect(await AiService.instance.hasUserApiKey(), isFalse);
      await AiService.instance.setUserApiKey('user-byok-key-123');
      expect(await AiService.instance.hasUserApiKey(), isTrue);
      expect(await AiService.instance.getEffectiveApiKey(), 'user-byok-key-123');

      String? capturedHeader;
      final mockClient = MockClient((request) async {
        capturedHeader = request.headers['X-goog-api-key'] ??
            request.headers['x-goog-api-key'];
        expect(request.url.queryParameters.containsKey('key'), isFalse);
        return http.Response(
          jsonEncode(<String, dynamic>{
            'candidates': <Map<String, dynamic>>[
              <String, dynamic>{
                'content': <String, dynamic>{
                  'parts': <Map<String, dynamic>>[
                    <String, dynamic>{'text': 'Focused plan ready.'},
                  ],
                },
              },
            ],
          }),
          200,
          headers: <String, String>{'content-type': 'application/json'},
        );
      });

      final reply = await AiService.instance.sendMessage(
        conversationHistory: const <ChatMessage>[],
        newMessage: 'Plan my day',
        languageName: 'English',
        httpClient: mockClient,
      );

      expect(reply, 'Focused plan ready.');
      expect(capturedHeader, 'user-byok-key-123');

      await AiService.instance.setUserApiKey(null);
      expect(await AiService.instance.hasUserApiKey(), isFalse);
    });

    test('pauses requests after 3 consecutive provider errors until key is updated', () async {
      await AiService.instance.setUserApiKey('bad-key');
      var calls = 0;
      final failingClient = MockClient((_) async {
        calls++;
        return http.Response('{"error":"quota"}', 429);
      });

      for (var i = 0; i < AiService.maxConsecutiveFailures; i++) {
        await AiService.instance.sendMessage(
          conversationHistory: const <ChatMessage>[],
          newMessage: 'Ping',
          languageName: 'English',
          httpClient: failingClient,
        );
      }
      expect(AiService.instance.isKeyPaused, isTrue);
      expect(calls, 3);

      // 4th call is short-circuited without hitting network
      final pausedReply = await AiService.instance.sendMessage(
        conversationHistory: const <ChatMessage>[],
        newMessage: 'Ping again',
        languageName: 'English',
        httpClient: failingClient,
      );
      expect(pausedReply, contains('paused'));
      expect(calls, 3);

      // Updating the key resets the circuit breaker
      await AiService.instance.setUserApiKey('fresh-key');
      expect(AiService.instance.isKeyPaused, isFalse);
    });
  });

  group('AuthRepository export and account deletion endpoints', () {
    test('calls export, schedule deletion, and cancel deletion endpoints', () async {
      final store = MemoryTokenStore(_tokens());
      final seenPaths = <String>[];
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) async {
          seenPaths.add('${request.method} ${request.url.path}');
          if (request.url.path.endsWith('/users/me/export')) {
            return http.Response(
              jsonEncode(<String, dynamic>{
                'exportedAt': '2026-10-12T10:00:00.000Z',
                'user': <String, dynamic>{'id': 'u-1', 'email': 'u@example.com'},
              }),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }
          if (request.method == 'POST' &&
              request.url.path.endsWith('/users/me/deletion')) {
            return http.Response(
              jsonEncode(<String, dynamic>{
                'status': 'pending_deletion',
                'deletionScheduledFor': '2026-10-26T10:00:00.000Z',
              }),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }
          if (request.method == 'DELETE' &&
              request.url.path.endsWith('/users/me/deletion')) {
            return http.Response(
              jsonEncode(<String, dynamic>{'status': 'active'}),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }
          return http.Response('', 404);
        }),
      );
      addTearDown(client.close);

      final repo = AuthRepository(api: client, tokens: store);
      final exported = await repo.exportUserData();
      expect(exported['exportedAt'], '2026-10-12T10:00:00.000Z');

      final scheduledFor = await repo.scheduleAccountDeletion();
      expect(scheduledFor, isNotNull);

      await repo.cancelAccountDeletion();

      expect(
        seenPaths,
        <String>[
          'POST /api/v1/users/me/export',
          'POST /api/v1/users/me/deletion',
          'DELETE /api/v1/users/me/deletion',
        ],
      );
    });
  });

  group('DailyPlanRepository dashboard, day plan, and global search', () {
    test('parses dashboard overview, day view, and global search results', () async {
      final store = MemoryTokenStore(_tokens());
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/dashboard')) {
            return http.Response(
              jsonEncode(<String, dynamic>{
                'overview': <String, dynamic>{
                  'date': '2026-10-12',
                  'timezone': 'Africa/Cairo',
                  'tasks': <String, dynamic>{
                    'dueToday': 3,
                    'doneToday': 2,
                    'overdue': 1,
                  },
                  'habits': <String, dynamic>{
                    'dueToday': 4,
                    'completedToday': 3,
                  },
                  'eventsToday': 2,
                  'subscriptionsDueNext7Days': <String, dynamic>{
                    'count': 1,
                    'totalMinorByCurrency': <String, dynamic>{'USD': 1500},
                  },
                  'activeSubscriptions': 5,
                  'activeTimer': null,
                },
              }),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }
          if (request.url.path.endsWith('/days/2026-10-12')) {
            return http.Response(
              jsonEncode(<String, dynamic>{
                'day': <String, dynamic>{
                  'date': '2026-10-12',
                  'timezone': 'Africa/Cairo',
                  'tasks': <Map<String, dynamic>>[
                    <String, dynamic>{
                      'id': 't-1',
                      'title': 'Ship release',
                      'status': 'todo',
                      'priority': 2,
                      'dueDate': '2026-10-12',
                      'dueTime': '14:00',
                    },
                  ],
                  'habits': <Map<String, dynamic>>[
                    <String, dynamic>{
                      'id': 'h-1',
                      'name': 'Hydrate',
                      'completedOn': true,
                      'dueOn': true,
                    },
                  ],
                  'events': <Map<String, dynamic>>[
                    <String, dynamic>{
                      'id': 'e-1',
                      'title': 'Sprint Sync',
                      'startAt': '2026-10-12T09:00:00.000Z',
                      'endAt': '2026-10-12T09:30:00.000Z',
                      'allDay': false,
                      'location': 'Room A',
                    },
                  ],
                  'subscriptionsDue': <Map<String, dynamic>>[
                    <String, dynamic>{
                      'id': 's-1',
                      'name': 'Cloud Storage',
                      'amountMinor': 999,
                      'currency': 'USD',
                      'billingUnit': 'month',
                      'nextBillingDate': '2026-10-12',
                    },
                  ],
                },
              }),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }
          if (request.url.path.endsWith('/search')) {
            expect(request.url.queryParameters['q'], 'sprint');
            return http.Response(
              jsonEncode(<String, dynamic>{
                'query': 'sprint',
                'tasks': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 't-1',
                    'title': 'Prepare sprint demo',
                    'status': 'todo',
                    'priority': 1,
                  },
                ],
                'notes': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 'n-1',
                    'title': 'Sprint retro notes',
                    'excerpt': 'Key takeaways',
                    'isPinned': true,
                  },
                ],
                'habits': <Map<String, dynamic>>[],
                'projects': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 'p-1',
                    'name': 'Q4 Sprint',
                    'description': 'Core roadmap',
                  },
                ],
                'events': <Map<String, dynamic>>[],
              }),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }
          return http.Response('', 404);
        }),
      );
      addTearDown(client.close);

      final repo = DailyPlanRepository(client);
      final overview = await repo.getDashboardOverview();
      expect(overview.tasksDueToday, 3);
      expect(overview.tasksDoneToday, 2);
      expect(overview.tasksOverdue, 1);
      expect(overview.habitsCompletedToday, 3);
      expect(overview.activeSubscriptions, 5);

      final day = await repo.getDayPlan(date: '2026-10-12');
      expect(day.tasks.single.title, 'Ship release');
      expect(day.habits.single.name, 'Hydrate');
      expect(day.events.single.title, 'Sprint Sync');
      expect(day.subscriptionsDue.single.formattedAmount, '9.99');

      final search = await repo.searchGlobal('sprint');
      expect(search.tasks.single.title, 'Prepare sprint demo');
      expect(search.notes.single.title, 'Sprint retro notes');
      expect(search.projects.single.name, 'Q4 Sprint');
    });
  });
}
