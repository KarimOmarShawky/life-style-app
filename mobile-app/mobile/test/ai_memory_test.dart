import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/core/links/external_link_opener.dart';
import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_memory_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_settings_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_assistant_screen.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_memory_screen.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/presentation/profile_screen.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

// Hybrid AI AI-3: notes the user saves for the assistant. Profile →
// Assistant memory lists, adds, edits and deletes them; "Save to memory"
// on the user's own chat messages saves one.

const _en = AppLocalizations(Locale('en'));
const _ar = AppLocalizations(Locale('ar'));

class _SignedInAuth extends AuthController {
  _SignedInAuth(this._user);

  final AppUser _user;

  @override
  Future<AppUser?> build() async => _user;
}

AppUser _user(String locale) => AppUser.fromJson({
      'id': 'user-1',
      'email': 'user@example.test',
      'displayName': 'Mona',
      'timezone': 'Africa/Cairo',
      'locale': locale,
      'defaultCurrency': 'EGP',
      'status': 'active',
      'productEventsEnabled': true,
    });

AiSettingsSnapshot _settings({
  bool available = true,
  bool memory = false,
  int? consent = 1,
}) =>
    AiSettingsSnapshot(
      consentVersion: consent,
      currentConsentVersion: 1,
      available: available,
      memoryEnabled: memory,
      explicitMemoryEnabled: memory,
    );

class _FakeSettings implements AiSettingsClient {
  _FakeSettings(this.current);

  AiSettingsSnapshot current;
  final memoryCalls = <bool>[];

  @override
  Future<AiSettingsSnapshot> fetch() async => current;

  @override
  Future<AiSettingsSnapshot> grantConsent() async => current;

  @override
  Future<AiSettingsSnapshot> withdrawConsent() async => current;

  @override
  Future<AiSettingsSnapshot> setMemoryEnabled(bool enabled) async {
    memoryCalls.add(enabled);
    return current = _settings(memory: enabled);
  }
}

class _FakeMemories implements AiMemoryClient {
  _FakeMemories(
    List<AiMemory> items, {
    this.available = true,
    this.failLoads = 0,
    this.createError,
  }) : items = [...items];

  final List<AiMemory> items;
  final bool available;
  int failLoads;
  final Object? createError;
  final created = <String>[];
  final updated = <String>[];
  final deleted = <String>[];
  int deleteAllCalls = 0;

  @override
  Future<AiMemoryList> list() async {
    if (failLoads > 0) {
      failLoads--;
      throw const ApiException(statusCode: 0, code: 'NETWORK', message: 'x');
    }
    return AiMemoryList(items: [...items], available: available);
  }

  @override
  Future<AiMemory> create({
    required AiMemoryKind kind,
    required String content,
  }) async {
    final error = createError;
    if (error != null) throw error;
    created.add('${kind.name}:$content');
    final memory =
        AiMemory(id: 'm${items.length + 1}', kind: kind, content: content);
    items.insert(0, memory);
    return memory;
  }

  @override
  Future<AiMemory> update(
    String id, {
    required AiMemoryKind kind,
    required String content,
  }) async {
    updated.add('$id:${kind.name}:$content');
    return AiMemory(id: id, kind: kind, content: content);
  }

  @override
  Future<void> delete(String id) async {
    deleted.add(id);
    items.removeWhere((item) => item.id == id);
  }

  @override
  Future<int> deleteAll() async {
    deleteAllCalls++;
    final count = items.length;
    items.clear();
    return count;
  }
}

Widget _app({
  required List<Override> overrides,
  required Widget home,
  String locale = 'en',
  double textScale = 1,
}) =>
    ProviderScope(
      key: UniqueKey(),
      overrides: overrides,
      child: MaterialApp(
        theme: AppTheme.light(),
        locale: Locale(locale),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScale),
          ),
          child: child!,
        ),
        home: home,
      ),
    );

void _smallPhone(WidgetTester tester) {
  // 360 x 720 logical pixels.
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(720, 1440);
  addTearDown(tester.view.reset);
}

Future<void> _pumpMemory(
  WidgetTester tester, {
  required _FakeSettings settings,
  required _FakeMemories memories,
  String locale = 'en',
  double textScale = 1,
}) async {
  SharedPreferences.setMockInitialValues({
    'app_locale': locale,
    'ai_age_confirmed.v1.user-1': true,
  });
  _smallPhone(tester);
  await tester.pumpWidget(_app(
    locale: locale,
    textScale: textScale,
    overrides: [
      authProvider.overrideWith(() => _SignedInAuth(_user(locale))),
      aiSettingsClientProvider.overrideWithValue(settings),
      aiMemoryClientProvider.overrideWithValue(memories),
    ],
    home: Consumer(
      builder: (context, ref, _) {
        ref.watch(authProvider);
        return const AiMemoryScreen();
      },
    ),
  ));
  await tester.pumpAndSettle();
}

const _note = AiMemory(
  id: 'm1',
  kind: AiMemoryKind.fact,
  content: 'I work night shifts',
);

class _MemoryTokens implements TokenStore {
  SessionTokens? _stored = SessionTokens(
    accessToken: 'access',
    refreshToken: 'refresh',
    accessTokenExpiresAt: DateTime.utc(2030),
    refreshTokenExpiresAt: DateTime.utc(2030),
  );

  @override
  Future<SessionTokens?> read() async => _stored;

  @override
  Future<void> write(SessionTokens tokens) async {
    _stored = tokens;
  }

  @override
  Future<void> clear() async {
    _stored = null;
  }
}

void main() {
  group('AI memory clients', () {
    test('send the documented requests and read the answers', () async {
      final requests = <http.Request>[];
      final api = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: _MemoryTokens(),
        httpClient: MockClient((request) async {
          requests.add(request);
          final Object? data;
          if (request.url.path.endsWith('/ai/settings')) {
            data = {
              'settings': {
                'egressConsentVersion': 1,
                'memoryEnabled': true,
                'explicitMemoryEnabled': true,
              },
              'currentConsentVersion': 1,
              'available': true,
            };
          } else if (request.method == 'GET') {
            data = {
              'items': [
                {'id': 'm1', 'kind': 'fact', 'content': 'Night shifts'},
              ],
              'truncated': false,
              'available': true,
            };
          } else if (request.method == 'DELETE' &&
              request.url.path.endsWith('/ai/memories')) {
            data = {'deleted': 2};
          } else if (request.method == 'DELETE') {
            return http.Response('', 204);
          } else {
            data = {'id': 'm2', 'kind': 'preference', 'content': 'Short'};
          }
          return http.Response(
            jsonEncode({'success': true, 'data': data}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      );
      final memories = ApiAiMemoryClient(api);
      final listed = await memories.list();
      expect(listed.available, isTrue);
      expect(listed.items.single.content, 'Night shifts');
      final saved = await memories.create(
        kind: AiMemoryKind.preference,
        content: '  ${'x' * 600}  ',
      );
      expect(saved.kind, AiMemoryKind.preference);
      await memories.update('m2', kind: AiMemoryKind.fact, content: 'Short');
      await memories.delete('m2');
      expect(await memories.deleteAll(), 2);
      final turnedOn = await ApiAiSettingsClient(api).setMemoryEnabled(true);
      expect(turnedOn.memoryOn, isTrue);

      expect(requests.map((r) => '${r.method} ${r.url.path}'), [
        'GET /api/v1/ai/memories',
        'POST /api/v1/ai/memories',
        'PATCH /api/v1/ai/memories/m2',
        'DELETE /api/v1/ai/memories/m2',
        'DELETE /api/v1/ai/memories',
        'PATCH /api/v1/ai/settings',
      ]);
      final created = jsonDecode(requests[1].body) as Map<String, dynamic>;
      expect(created['kind'], 'preference');
      expect((created['content'] as String).length, aiMemoryMaxChars);
      expect(
          jsonDecode(requests[2].body), {'kind': 'fact', 'content': 'Short'});
      expect(jsonDecode(requests.last.body), {
        'memoryEnabled': true,
        'explicitMemoryEnabled': true,
      });
    });

    test('memory counts as on only with both switches and the table', () {
      expect(_settings(memory: true).memoryOn, isTrue);
      expect(_settings(memory: true, available: false).memoryOn, isFalse);
      expect(
        const AiSettingsSnapshot(
          consentVersion: 1,
          currentConsentVersion: 1,
          available: true,
          memoryEnabled: true,
        ).memoryOn,
        isFalse,
      );
    });
  });

  group('Memory screen', () {
    testWidgets('says when memory is not available yet', (tester) async {
      await _pumpMemory(
        tester,
        settings: _FakeSettings(_settings(available: false)),
        memories: _FakeMemories([], available: false),
      );
      expect(find.text(_en.aiMemoryUnavailable), findsOneWidget);
      expect(find.byKey(const ValueKey('ai-memory-switch')), findsNothing);
    });

    testWidgets('a failed load offers to try again', (tester) async {
      final memories = _FakeMemories([_note], failLoads: 1);
      await _pumpMemory(
        tester,
        settings: _FakeSettings(_settings(memory: true)),
        memories: memories,
      );
      expect(find.text(_en.aiMemoryLoadFailed), findsOneWidget);
      await tester.tap(find.text(_en.retry));
      await tester.pumpAndSettle();
      expect(find.text(_note.content), findsOneWidget);
    });

    testWidgets('with memory off notes stay visible and adding waits',
        (tester) async {
      final settings = _FakeSettings(_settings());
      await _pumpMemory(
        tester,
        settings: settings,
        memories: _FakeMemories([_note]),
      );
      final add = find.byKey(const ValueKey('ai-memory-add'));
      expect(tester.widget<FilledButton>(add).onPressed, isNull);
      expect(find.text(_note.content), findsOneWidget);
      expect(find.byTooltip(_en.aiMemoryDeleteTooltip), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('ai-memory-switch')));
      await tester.pumpAndSettle();
      expect(settings.memoryCalls, [true]);
      expect(tester.widget<FilledButton>(add).onPressed, isNotNull);
      final container = ProviderScope.containerOf(
        tester.element(find.byType(AiMemoryScreen)),
      );
      expect(container.read(aiSettingsRevisionProvider), 1);
    });

    testWidgets('adds a note with its kind', (tester) async {
      final memories = _FakeMemories([]);
      await _pumpMemory(
        tester,
        settings: _FakeSettings(_settings(memory: true)),
        memories: memories,
      );
      expect(find.text(_en.aiMemoryEmpty), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('ai-memory-add')));
      await tester.pumpAndSettle();
      final save = find.widgetWithText(FilledButton, _en.save);
      expect(tester.widget<FilledButton>(save).onPressed, isNull);
      await tester.tap(find.text(_en.aiMemoryKindPreference));
      await tester.enterText(
        find.byKey(const ValueKey('ai-memory-field')),
        '  Keep answers short  ',
      );
      await tester.pump();
      await tester.tap(save);
      await tester.pumpAndSettle();

      expect(memories.created, ['preference:Keep answers short']);
      expect(find.text('Keep answers short'), findsOneWidget);
      expect(find.text(_en.aiMemoryKindPreference), findsOneWidget);
      expect(find.text(_en.aiMemorySaved), findsOneWidget);
    });

    testWidgets('edits and deletes notes, and asks before deleting all',
        (tester) async {
      final memories = _FakeMemories([
        _note,
        const AiMemory(
          id: 'm2',
          kind: AiMemoryKind.preference,
          content: 'Keep answers short',
        ),
      ]);
      await _pumpMemory(
        tester,
        settings: _FakeSettings(_settings(memory: true)),
        memories: memories,
      );

      await tester.tap(find.byTooltip(_en.aiMemoryEditTitle).first);
      await tester.pumpAndSettle();
      expect(find.text(_en.aiMemoryEditTitle), findsWidgets);
      await tester.enterText(
        find.byKey(const ValueKey('ai-memory-field')),
        'I work day shifts',
      );
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, _en.save));
      await tester.pumpAndSettle();
      expect(memories.updated, ['m1:fact:I work day shifts']);
      expect(find.text('I work day shifts'), findsOneWidget);

      await tester.tap(find.byTooltip(_en.aiMemoryDeleteTooltip).first);
      await tester.pumpAndSettle();
      expect(find.text(_en.aiMemoryDeleteTitle), findsOneWidget);
      await tester.tap(find.text(_en.delete));
      await tester.pumpAndSettle();
      expect(memories.deleted, ['m1']);
      expect(find.text('I work day shifts'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('ai-memory-delete-all')));
      await tester.pumpAndSettle();
      expect(find.text(_en.aiMemoryDeleteAllTitle), findsOneWidget);
      await tester.tap(find.text(_en.cancel));
      await tester.pumpAndSettle();
      expect(memories.deleteAllCalls, 0);
      await tester.tap(find.byKey(const ValueKey('ai-memory-delete-all')));
      await tester.pumpAndSettle();
      await tester.tap(find.text(_en.delete));
      await tester.pumpAndSettle();
      expect(memories.deleteAllCalls, 1);
      expect(find.text(_en.aiMemoryEmpty), findsOneWidget);
    });

    testWidgets('says why a note was not saved', (tester) async {
      await _pumpMemory(
        tester,
        settings: _FakeSettings(_settings(memory: true)),
        memories: _FakeMemories(
          [],
          createError: const ApiException(
            statusCode: 409,
            code: 'AI_MEMORY_LIMIT',
            message: 'limit',
          ),
        ),
      );
      await tester.tap(find.byKey(const ValueKey('ai-memory-add')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('ai-memory-field')),
        'One more',
      );
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, _en.save));
      await tester.pumpAndSettle();
      expect(find.text(_en.aiMemoryLimitError), findsOneWidget);
    });

    testWidgets('G7: Arabic at 200% text', (tester) async {
      final semantics = tester.ensureSemantics();
      final memories = _FakeMemories([_note]);
      await _pumpMemory(
        tester,
        settings: _FakeSettings(_settings(memory: true)),
        memories: memories,
        locale: 'ar',
        textScale: 2,
      );
      expect(tester.takeException(), isNull);
      final toggle = find.byKey(const ValueKey('ai-memory-switch'));
      expect(Directionality.of(tester.element(toggle)), TextDirection.rtl);

      // At 200% the switch explanation alone is taller than the screen.
      final list = find.byType(Scrollable).first;
      final add = find.byKey(const ValueKey('ai-memory-add'));
      await tester.scrollUntilVisible(add, 300, scrollable: list);
      await tester.pumpAndSettle();
      expect(tester.getSize(add).height, greaterThanOrEqualTo(48));

      await tester.tap(add);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.enterText(
        find.byKey(const ValueKey('ai-memory-field')),
        'اجعل الإجابات قصيرة',
      );
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, _ar.save));
      await tester.pumpAndSettle();
      expect(memories.created, ['fact:اجعل الإجابات قصيرة']);
      expect(tester.takeException(), isNull);

      await tester.scrollUntilVisible(
        find.byTooltip(_ar.aiMemoryDeleteTooltip).first,
        300,
        scrollable: list,
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip(_ar.aiMemoryEditTitle), findsWidgets);
      expect(find.byTooltip(_ar.aiMemoryDeleteTooltip), findsWidgets);
      expect(tester.takeException(), isNull);
      semantics.dispose();
    });
  });

  group('Save to memory in the assistant', () {
    Future<_FakeMemories> pumpAssistant(
      WidgetTester tester, {
      required bool memory,
    }) async {
      SharedPreferences.setMockInitialValues({
        'app_locale': 'en',
        'ai_age_confirmed.v1.user-1': true,
        'ai.chat.history.v1': jsonEncode([
          {
            'role': 'user',
            'text': 'I work night shifts',
            'timestamp': '2026-11-12T10:00:00.000',
          },
          {
            'role': 'model',
            'text': 'Thanks, noted.',
            'timestamp': '2026-11-12T10:00:05.000',
          },
        ]),
      });
      _smallPhone(tester);
      AiService.bindGateway(_SilentGateway());
      AiService.instance.resetFailureCount();
      final memories = _FakeMemories([]);
      await tester.pumpWidget(_app(
        overrides: [
          authProvider.overrideWith(() => _SignedInAuth(_user('en'))),
          aiSettingsClientProvider.overrideWithValue(
            _FakeSettings(_settings(memory: memory)),
          ),
          aiMemoryClientProvider.overrideWithValue(memories),
        ],
        home: Consumer(
          builder: (context, ref, _) {
            ref.watch(authProvider);
            return const AiAssistantScreen();
          },
        ),
      ));
      await tester.pumpAndSettle();
      return memories;
    }

    testWidgets('saves one of your own messages as a note', (tester) async {
      final memories = await pumpAssistant(tester, memory: true);
      final action = find.byTooltip(_en.aiSaveToMemoryTooltip);
      expect(action, findsOneWidget);

      await tester.tap(action);
      await tester.pumpAndSettle();
      expect(find.text(_en.aiMemoryAdd), findsWidgets);
      await tester.tap(find.widgetWithText(FilledButton, _en.save));
      await tester.pumpAndSettle();
      expect(memories.created, ['fact:I work night shifts']);
      expect(find.text(_en.aiMemorySaved), findsOneWidget);
    });

    testWidgets('is not offered while memory is off', (tester) async {
      await pumpAssistant(tester, memory: false);
      expect(find.text('I work night shifts'), findsOneWidget);
      expect(find.byTooltip(_en.aiSaveToMemoryTooltip), findsNothing);
    });
  });

  testWidgets('Profile → Assistant memory opens the Memory screen',
      (tester) async {
    SharedPreferences.setMockInitialValues({'app_locale': 'en'});
    _smallPhone(tester);
    final user = _user('en');
    await tester.pumpWidget(_app(
      overrides: [
        authProvider.overrideWith(() => _SignedInAuth(user)),
        xpLedgerProvider.overrideWithValue(XpLedger()),
        privacyPolicyUriProvider.overrideWithValue(null),
        aiSettingsClientProvider.overrideWithValue(
          _FakeSettings(_settings(memory: true)),
        ),
        aiMemoryClientProvider.overrideWithValue(_FakeMemories([_note])),
      ],
      home: ProfileScreen(user: user),
    ));
    await tester.pumpAndSettle();
    final tile = find.byKey(const ValueKey('ai-memory-tile'));
    await tester.scrollUntilVisible(tile, 300,
        scrollable: find.byType(Scrollable).first, maxScrolls: 100);
    await tester.pumpAndSettle();
    expect(find.text(_en.aiMemoryTileSubtitle), findsOneWidget);

    await tester.tap(tile);
    await tester.pumpAndSettle();
    expect(find.byType(AiMemoryScreen), findsOneWidget);
    expect(find.text(_note.content), findsOneWidget);
  });
}

/// The assistant tests here never send a message.
class _SilentGateway implements AiBackendGateway {
  @override
  Future<Object?> post(String path, {Object? body}) async {
    throw UnimplementedError();
  }

  @override
  Stream<String> postEventStream(
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 60),
  }) {
    throw UnimplementedError();
  }
}
