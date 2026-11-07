import 'support/fake_secure_storage.dart';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/more/data/daily_plan_models.dart';

SessionTokens _tokens() => SessionTokens(
      accessToken: 'access-token',
      accessTokenExpiresAt: DateTime.utc(2026, 10, 12, 12),
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: DateTime.utc(2026, 11, 12, 12),
    );

/// Offline AI transport double for the proxy circuit-breaker tests.
class _RecordingTransport implements AiTransport {
  _RecordingTransport({this.reply, this.error});

  final String? reply;
  final AiTransportException? error;
  int calls = 0;

  @override
  Future<String> chat({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls++;
    final failure = error;
    if (failure != null) throw failure;
    return reply!;
  }

  @override
  Stream<String> chatStream({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    calls++;
    final failure = error;
    if (failure != null) throw failure;
    yield reply!;
  }
}

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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FakeSecureStorage().install();
  });

  group('AiService proxy circuit breaker', () {
    test('returns the backend reply without any on-device key', () async {
      final transport = _RecordingTransport(reply: 'Focused plan ready.');
      final service = AiService.forTesting(transport: transport);

      final reply = await service.sendMessage(
        conversationHistory: const <ChatMessage>[],
        newMessage: 'Plan my day',
        languageName: 'English',
      );

      expect(reply, 'Focused plan ready.');
      expect(transport.calls, 1);
      expect(service.isPaused, isFalse);
    });

    test('pauses after 3 consecutive failures until explicitly reset',
        () async {
      final transport = _RecordingTransport(
        error: const AiTransportException('quota_exceeded'),
      );
      final service = AiService.forTesting(transport: transport);

      for (var i = 0; i < AiService.maxConsecutiveFailures; i++) {
        final reply = await service.sendMessage(
          conversationHistory: const <ChatMessage>[],
          newMessage: 'Ping',
          languageName: 'English',
        );
        expect(reply, contains('usage limit'));
      }
      expect(service.isPaused, isTrue);
      expect(transport.calls, 3);

      // The 4th call is short-circuited without touching the transport.
      final pausedReply = await service.sendMessage(
        conversationHistory: const <ChatMessage>[],
        newMessage: 'Ping again',
        languageName: 'English',
      );
      expect(pausedReply, contains('paused'));
      expect(transport.calls, 3);

      service.resetFailureCount();
      expect(service.isPaused, isFalse);
    });
  });

  group('AuthRepository export and account deletion endpoints', () {
    test('calls export, schedule deletion, and cancel deletion endpoints',
        () async {
      final store = _MemoryTokenStore(_tokens());
      final seenPaths = <String>[];
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) async {
          seenPaths.add('${request.method} ${request.url.path}');
          if (request.url.path.endsWith('/users/me/export')) {
            expect(jsonDecode(request.body),
                {'currentPassword': 'CurrentPassword123!'});
            return http.Response(
              jsonEncode(<String, dynamic>{
                'exportedAt': '2026-10-12T10:00:00.000Z',
                'user': <String, dynamic>{
                  'id': 'u-1',
                  'email': 'u@example.com'
                },
              }),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }
          if (request.method == 'POST' &&
              request.url.path.endsWith('/users/me/deletion')) {
            expect(jsonDecode(request.body),
                {'currentPassword': 'CurrentPassword123!'});
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
      final exported = await repo.exportUserData('CurrentPassword123!');
      expect(exported['exportedAt'], '2026-10-12T10:00:00.000Z');

      final scheduledFor =
          await repo.scheduleAccountDeletion('CurrentPassword123!');
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
    test('parses dashboard overview, day view, and global search results',
        () async {
      final store = _MemoryTokenStore(_tokens());
      final client = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: MockClient((request) async {
          // Canonical routes: the /dashboard/overview and /days/:date aliases
          // were removed, so a mock that still answers them 404s the client.
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
                    'totalMinorByCurrency': <String, dynamic>{'USD': '1500'},
                  },
                  'activeSubscriptions': 5,
                  'activeTimer': null,
                },
              }),
              200,
              headers: <String, String>{'content-type': 'application/json'},
            );
          }
          if (request.url.path.endsWith('/day/2026-10-12')) {
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
                      'amountMinor': '999',
                      'currencyExponent': 2,
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
                'goals': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 'g-1',
                    'title': 'Run a sprint',
                    'status': 'active',
                  },
                ],
                'subscriptions': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 's-1',
                    'name': 'Sprint Music',
                    'status': 'active',
                    'nextBillingDate': '2026-11-01',
                  },
                ],
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
      // F-07: goals and money (subscriptions) are searchable too.
      expect(search.goals.single.title, 'Run a sprint');
      expect(search.goals.single.status, 'active');
      expect(search.subscriptions.single.name, 'Sprint Music');
      expect(search.subscriptions.single.nextBillingDate, '2026-11-01');
    });

    test('global search tolerates a payload without the newer groups', () {
      final legacy = GlobalSearchResult.fromJson(<String, dynamic>{
        'query': 'sprint',
        'tasks': <Map<String, dynamic>>[],
        'notes': <Map<String, dynamic>>[],
        'habits': <Map<String, dynamic>>[],
        'projects': <Map<String, dynamic>>[],
        'events': <Map<String, dynamic>>[],
      });
      expect(legacy.goals, isEmpty);
      expect(legacy.subscriptions, isEmpty);
    });
  });
}
