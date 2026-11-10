import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/app.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/presentation/auth_screen.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/onboarding/onboarding_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

const _userId = '0b7f2c1e-0000-4000-8000-000000000001';
const _en = AppLocalizations(Locale('en'));

Map<String, dynamic> _userJson({Object? onboardingCompletedAt}) => {
      'id': _userId,
      'email': 'new@example.test',
      'displayName': 'New',
      'timezone': 'Africa/Cairo',
      'locale': 'en',
      'defaultCurrency': 'EGP',
      'status': 'active',
      'productEventsEnabled': true,
      'onboardingCompletedAt': onboardingCompletedAt,
    };

class _MemoryTokenStore implements TokenStore {
  SessionTokens? tokens = SessionTokens(
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: DateTime.utc(2030),
    refreshTokenExpiresAt: DateTime.utc(2030),
  );

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

class _SignedInAuth extends AuthController {
  _SignedInAuth(this._user);

  final AppUser _user;

  @override
  Future<AppUser?> build() async => _user;
}

class _DelayedAuth extends AuthController {
  _DelayedAuth(this._restore);

  final Future<AppUser?> _restore;

  @override
  Future<AppUser?> build() => _restore;
}

http.Response _json(int status, Object body) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

/// API v1 success envelope; the client unwraps `data` only with it.
http.Response _ok(int status, Object data) =>
    _json(status, {'success': true, 'data': data});

Map<String, dynamic> _task(String id, String title, String status) => {
      'id': id,
      'title': title,
      'status': status,
      'priority': 'medium',
      'version': status == 'done' ? 2 : 1,
      'dueDate': '2026-11-10',
    };

class _FakeServer {
  _FakeServer({this.failTasks = false, this.failProfile = false});

  final bool failTasks;
  final bool failProfile;
  final List<http.Request> requests = <http.Request>[];
  int _created = 0;

  Future<http.Response> handle(http.Request request) async {
    requests.add(request);
    final path = request.url.path;
    if (request.method == 'POST' && path.endsWith('/tasks')) {
      if (failTasks) {
        return _json(400, {
          'error': {'code': 'UNAVAILABLE', 'message': 'Not now'},
        });
      }
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      _created++;
      return _ok(201, {
        'task': _task('task-$_created', body['title'] as String, 'todo'),
      });
    }
    if (request.method == 'PATCH' && path.contains('/tasks/')) {
      return _ok(200, {
        'task': _task(path.split('/').last, 'Done', 'done'),
      });
    }
    if (request.method == 'PATCH' && path.endsWith('/users/me')) {
      if (failProfile) {
        return _json(400, {
          'error': {'code': 'UNAVAILABLE', 'message': 'Not now'},
        });
      }
      return _ok(200, {
        'user': _userJson(onboardingCompletedAt: '2026-11-10T08:00:00.000Z'),
      });
    }
    if (request.method == 'POST' && path.endsWith('/product-events')) {
      return _ok(202, {'recorded': true});
    }
    return _json(404, {
      'error': {'code': 'NOT_FOUND', 'message': 'Unknown route'},
    });
  }

  List<Map<String, dynamic>> bodies(String method, String suffix) => [
        for (final request in requests)
          if (request.method == method && request.url.path.endsWith(suffix))
            jsonDecode(request.body) as Map<String, dynamic>,
      ];

  List<String> get events => [
        for (final body in bodies('POST', '/product-events'))
          body['event'] as String,
      ];
}

Future<_FakeServer> _pump(
  WidgetTester tester, {
  _FakeServer? server,
  Locale locale = const Locale('en'),
  double textScale = 1,
  Future<void> Function()? onPermission,
}) async {
  final fake = server ?? _FakeServer();
  final tokens = _MemoryTokenStore();
  final api = ApiClient(
    baseUri: Uri.parse('https://api.example.test/api/v1/'),
    tokenStore: tokens,
    httpClient: MockClient(fake.handle),
  );
  final user = AppUser.fromJson(_userJson());
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(api),
      tokenStoreProvider.overrideWithValue(tokens),
      authProvider.overrideWith(() => _SignedInAuth(user)),
    ],
    child: MaterialApp(
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Consumer(builder: (context, ref, _) {
        final current = ref.watch(authProvider).valueOrNull;
        if (current == null) return const SizedBox.shrink();
        if (!current.onboardingPending) {
          return const Scaffold(body: Text('home'));
        }
        return OnboardingScreen(
          user: current,
          requestReminderPermission: onPermission,
        );
      }),
    ),
  ));
  await tester.pumpAndSettle();
  return fake;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('first win without typing, then reminders, then the app',
      (tester) async {
    var permissionRequests = 0;
    final server = await _pump(tester, onPermission: () async {
      permissionRequests++;
    });
    expect(find.text(_en.onboardingTitle), findsOneWidget);
    expect(permissionRequests, 0, reason: 'never asked before the first win');

    await tester.tap(find.text(_en.onboardingAreaStudy));
    await tester.pumpAndSettle();
    final created = server.bodies('POST', '/tasks');
    expect(created.map((body) => body['title']), [
      _en.starterClearDesk,
      _en.starterPickLesson,
      _en.starterFocusSession,
    ]);
    expect(created.every((body) => body['dueDate'] is String), isTrue);
    expect(find.text(_en.onboardingFirstWinTitle), findsOneWidget);

    await tester.tap(find.byType(Checkbox).first);
    await tester.pumpAndSettle();
    expect(server.bodies('PATCH', '/tasks/task-1').single['status'], 'done');
    expect(find.text(_en.onboardingCelebrateTitle), findsOneWidget);
    expect(permissionRequests, 0);

    await tester.tap(find.text(_en.onboardingEnableReminders));
    await tester.pumpAndSettle();
    expect(permissionRequests, 1);
    expect(find.text('home'), findsOneWidget);
    expect(server.bodies('PATCH', '/users/me').single,
        {'onboardingCompleted': true});
    expect(server.events,
        ['onboarding_started', 'task_completed', 'onboarding_completed']);
    for (final body in server.bodies('POST', '/product-events')) {
      expect(body.keys.toSet(), {'event', 'platform', 'appVersion'});
    }
  });

  testWidgets('skip finishes at once and creates nothing', (tester) async {
    final server = await _pump(tester);
    await tester.tap(find.text(_en.onboardingSkip));
    await tester.pumpAndSettle();
    expect(find.text('home'), findsOneWidget);
    expect(server.bodies('POST', '/tasks'), isEmpty);
    expect(server.events, ['onboarding_started', 'onboarding_skipped']);
  });

  testWidgets('offline: a friendly error, and skip still gets into the app',
      (tester) async {
    final server = await _pump(
      tester,
      server: _FakeServer(failTasks: true, failProfile: true),
    );
    await tester.tap(find.text(_en.onboardingAreaRoutine));
    await tester.pumpAndSettle();
    expect(find.text(_en.onboardingAddFailed), findsOneWidget);

    await tester.tap(find.text(_en.onboardingSkip));
    await tester.pumpAndSettle();
    expect(find.text('home'), findsOneWidget,
        reason: 'a server that cannot save the flag never traps the user');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('onboarding.done.v1.$_userId'), isTrue);
    expect(server.bodies('PATCH', '/users/me'), hasLength(1));
  });

  testWidgets('finished offline earlier: only the server flag is retried',
      (tester) async {
    SharedPreferences.setMockInitialValues(
        {'onboarding.done.v1.$_userId': true});
    final server = await _pump(tester);
    expect(find.text('home'), findsOneWidget);
    expect(server.bodies('PATCH', '/users/me'), hasLength(1));
    expect(server.events, isEmpty);
  });

  testWidgets('Arabic at 200% text: right-to-left, no overflow, labelled taps',
      (tester) async {
    final semantics = tester.ensureSemantics();
    const ar = AppLocalizations(Locale('ar'));
    await _pump(tester, locale: const Locale('ar'), textScale: 2);
    expect(tester.takeException(), isNull);
    expect(find.text(ar.onboardingTitle), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text(ar.onboardingTitle))),
      TextDirection.rtl,
    );
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));

    await tester.scrollUntilVisible(find.text(ar.onboardingAreaWork), 120);
    await tester.tap(find.text(ar.onboardingAreaWork));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text(ar.starterTopPriority), findsOneWidget);
    final firstTask = tester.getRect(find.text(ar.starterTopPriority));
    final screenHeight =
        tester.view.physicalSize.height / tester.view.devicePixelRatio;
    expect(firstTask.top, greaterThanOrEqualTo(0));
    expect(firstTask.bottom, lessThanOrEqualTo(screenHeight),
        reason: 'the next step starts at the top, not where step one was');
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    semantics.dispose();
  });

  testWidgets('a cold-start link waits for the session restore (G3)',
      (tester) async {
    tester.binding.platformDispatcher.defaultRouteNameTestValue =
        'lifestyle://daily-plan';
    addTearDown(
        tester.binding.platformDispatcher.clearDefaultRouteNameTestValue);
    final restore = Completer<AppUser?>();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        authProvider.overrideWith(() => _DelayedAuth(restore.future)),
      ],
      child: const LifeStyleApp(initialLocation: 'lifestyle://daily-plan'),
    ));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    restore.complete(null);
    await tester.pumpAndSettle();
    expect(find.byType(AuthScreen), findsOneWidget,
        reason: 'the linked page follows the restored session');
  });
}
