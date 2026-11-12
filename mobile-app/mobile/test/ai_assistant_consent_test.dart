import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_settings_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_assistant_screen.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_markdown.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

// Hybrid AI AI-2c: the assistant keeps the AI consent on the server, offers
// "Use my app data" (off by default) and explains the server's denials.

const _en = AppLocalizations(Locale('en'));
const _ar = AppLocalizations(Locale('ar'));
const _contextKey = 'ai_context_enabled.v1.user-1';
Finder get _chip => find.byKey(const ValueKey('ai-context-chip'));

class _SignedInAuth extends AuthController {
  _SignedInAuth(this._user);

  final AppUser _user;

  @override
  Future<AppUser?> build() async => _user;
}

AiSettingsSnapshot _snapshot({int? version, bool available = true}) =>
    AiSettingsSnapshot(
      consentVersion: version,
      currentConsentVersion: 1,
      available: available,
    );

class _FakeSettings implements AiSettingsClient {
  _FakeSettings(this.current, {this.offline = false});

  AiSettingsSnapshot current;
  final bool offline;
  int grants = 0;

  @override
  Future<AiSettingsSnapshot> fetch() async {
    if (offline) throw Exception('offline');
    return current;
  }

  @override
  Future<AiSettingsSnapshot> grantConsent() async {
    grants++;
    return current = _snapshot(version: aiEgressConsentVersion);
  }

  @override
  Future<AiSettingsSnapshot> withdrawConsent() async {
    return current = _snapshot();
  }
}

/// Answers each assistant request with the next scripted list of events.
class _Gateway implements AiBackendGateway {
  _Gateway(this.script);

  final List<List<String>> script;
  final paths = <String>[];
  final bodies = <Map<String, Object?>>[];

  @override
  Future<Object?> post(String path, {Object? body}) async {
    throw UnimplementedError();
  }

  @override
  Stream<String> postEventStream(
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    paths.add(path);
    bodies.add(body! as Map<String, Object?>);
    for (final event in script.removeAt(0)) {
      yield event;
    }
  }
}

Future<void> _pump(
  WidgetTester tester, {
  required _FakeSettings settings,
  required _Gateway gateway,
  bool useAppData = false,
  String locale = 'en',
  double textScale = 1,
}) async {
  SharedPreferences.setMockInitialValues({
    'app_locale': locale,
    'ai_age_confirmed.v1.user-1': true,
    if (useAppData) _contextKey: true,
  });
  // A small phone: 360 x 720 logical pixels.
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(720, 1440);
  addTearDown(tester.view.reset);
  AiService.bindGateway(gateway);
  AiService.instance.resetFailureCount();
  final user = AppUser.fromJson({
    'id': 'user-1',
    'email': 'user@example.test',
    'displayName': 'Mona',
    'timezone': 'Africa/Cairo',
    'locale': locale,
    'defaultCurrency': 'EGP',
    'status': 'active',
    'productEventsEnabled': true,
  });
  await tester.pumpWidget(ProviderScope(
    key: UniqueKey(),
    overrides: [
      authProvider.overrideWith(() => _SignedInAuth(user)),
      aiSettingsClientProvider.overrideWithValue(settings),
    ],
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
      // The app shell keeps the signed-in user watched, as here.
      home: Consumer(
        builder: (context, ref, _) {
          ref.watch(authProvider);
          return const AiAssistantScreen();
        },
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

Future<void> _send(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.tap(find.byIcon(Icons.send_rounded));
  await tester.pumpAndSettle();
}

/// Lets a snack bar time out so it no longer covers the input row.
Future<void> _dismissSnackBar(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 5));
  await tester.pumpAndSettle();
}

String _denial(String reason) =>
    '{"type":"unsupported_or_denied","reason":"$reason"}';

void main() {
  testWidgets('a consent stored on the server is not asked again',
      (tester) async {
    final gateway = _Gateway([
      ['{"text":"Three tasks left."}', '[DONE]'],
    ]);
    final settings = _FakeSettings(_snapshot(version: 1));
    await _pump(tester, settings: settings, gateway: gateway);

    await _send(tester, 'What is left today?');

    expect(find.text(_en.aiEgressTitle), findsNothing);
    expect(find.text('Three tasks left.'), findsOneWidget);
    expect(gateway.paths, ['ai/assistant/turn/stream']);
    expect(gateway.bodies.single['message'], 'What is left today?');
    expect(gateway.bodies.single['clientLocale'], 'en');
    expect(gateway.bodies.single.containsKey('contextScopes'), isFalse);
    expect(settings.grants, 0);
  });

  testWidgets('the consent is asked once and stored on the server',
      (tester) async {
    final gateway = _Gateway([
      ['{"text":"Hello!"}', '[DONE]'],
      ['{"text":"Again."}', '[DONE]'],
    ]);
    final settings = _FakeSettings(_snapshot());
    await _pump(tester, settings: settings, gateway: gateway);

    await _send(tester, 'Hi');
    expect(find.text(_en.aiEgressTitle), findsOneWidget);
    expect(gateway.paths, isEmpty);
    await tester.tap(find.text(_en.aiEgressAgree));
    await tester.pumpAndSettle();
    expect(settings.grants, 1);
    expect(find.text('Hello!'), findsOneWidget);

    await _send(tester, 'Hi again');
    expect(find.text(_en.aiEgressTitle), findsNothing);
    expect(find.text('Again.'), findsOneWidget);
    expect(settings.grants, 1);
  });

  testWidgets('cancelling the consent sends nothing', (tester) async {
    final gateway = _Gateway([]);
    final settings = _FakeSettings(_snapshot());
    await _pump(tester, settings: settings, gateway: gateway);

    await _send(tester, 'Hi');
    await tester.tap(find.text(_en.cancel));
    await tester.pumpAndSettle();

    expect(gateway.paths, isEmpty);
    expect(settings.grants, 0);
  });

  for (final offline in [false, true]) {
    final when = offline ? 'cannot be reached' : 'cannot store it yet';
    testWidgets('when the server $when, the consent counts for this visit',
        (tester) async {
      final gateway = _Gateway([
        ['{"text":"Hello!"}', '[DONE]'],
        ['{"text":"Again."}', '[DONE]'],
      ]);
      final settings = _FakeSettings(
        _snapshot(available: false),
        offline: offline,
      );
      await _pump(
        tester,
        settings: settings,
        gateway: gateway,
        useAppData: true,
      );
      // App data needs the stored consent, so it is not offered.
      expect(_chip, findsNothing);

      await _send(tester, 'Hi');
      await tester.tap(find.text(_en.aiEgressAgree));
      await tester.pumpAndSettle();
      expect(find.text('Hello!'), findsOneWidget);
      expect(settings.grants, 0);

      await _send(tester, 'Hi again');
      expect(find.text(_en.aiEgressTitle), findsNothing);
      for (final body in gateway.bodies) {
        expect(body.containsKey('contextScopes'), isFalse);
      }
    });
  }

  testWidgets('a server needing a newer consent text hides app data',
      (tester) async {
    final gateway = _Gateway([
      ['{"text":"Hello!"}', '[DONE]'],
    ]);
    final settings = _FakeSettings(
      const AiSettingsSnapshot(
        consentVersion: 1,
        currentConsentVersion: aiEgressConsentVersion + 1,
        available: true,
      ),
    );
    await _pump(
      tester,
      settings: settings,
      gateway: gateway,
      useAppData: true,
    );
    expect(_chip, findsNothing);

    await _send(tester, 'Hi');
    await tester.tap(find.text(_en.aiEgressAgree));
    await tester.pumpAndSettle();
    expect(settings.grants, 0);
    expect(gateway.bodies.single.containsKey('contextScopes'), isFalse);
  });

  testWidgets('"Use my app data" is off by default and explained first',
      (tester) async {
    final gateway = _Gateway([
      ['{"text":"You have 3 tasks."}', '[DONE]'],
    ]);
    await _pump(
      tester,
      settings: _FakeSettings(_snapshot(version: 1)),
      gateway: gateway,
    );
    expect(tester.widget<FilterChip>(_chip).selected, isFalse);

    await tester.tap(_chip);
    await tester.pumpAndSettle();
    expect(find.text(_en.aiContextDialogTitle), findsOneWidget);
    expect(find.text(_en.aiContextDialogBody), findsOneWidget);
    await tester.tap(find.text(_en.cancel));
    await tester.pumpAndSettle();
    expect(tester.widget<FilterChip>(_chip).selected, isFalse);

    await tester.tap(_chip);
    await tester.pumpAndSettle();
    await tester.tap(find.text(_en.aiContextDialogConfirm));
    await tester.pumpAndSettle();
    expect(tester.widget<FilterChip>(_chip).selected, isTrue);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool(_contextKey), isTrue);

    await _send(tester, 'What is left today?');
    expect(gateway.bodies.single['contextScopes'], [
      'today',
      'tasks',
      'habits',
      'goals',
      'calendar',
    ]);
    expect(find.text('You have 3 tasks.'), findsOneWidget);
  });

  testWidgets('the switch is remembered and turns off without a question',
      (tester) async {
    await _pump(
      tester,
      settings: _FakeSettings(_snapshot(version: 1)),
      gateway: _Gateway([]),
      useAppData: true,
    );
    expect(tester.widget<FilterChip>(_chip).selected, isTrue);

    await tester.tap(_chip);
    await tester.pumpAndSettle();
    expect(find.text(_en.aiContextDialogTitle), findsNothing);
    expect(tester.widget<FilterChip>(_chip).selected, isFalse);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool(_contextKey), isFalse);
  });

  testWidgets('a consent the server no longer has is asked for again',
      (tester) async {
    final gateway = _Gateway([
      [_denial('consent_required'), '[DONE]'],
      ['{"text":"Here is your day."}', '[DONE]'],
    ]);
    final settings = _FakeSettings(_snapshot(version: 1));
    await _pump(
      tester,
      settings: settings,
      gateway: gateway,
      useAppData: true,
    );
    // Withdrawn on another phone after this screen opened.
    settings.current = _snapshot();

    await _send(tester, 'Plan my day');
    expect(find.text(_en.aiConsentRequiredMessage), findsOneWidget);
    expect(find.byType(AiMarkdownText), findsOneWidget);
    await _dismissSnackBar(tester);

    await _send(tester, 'Plan my day');
    expect(find.text(_en.aiEgressTitle), findsOneWidget);
    await tester.tap(find.text(_en.aiEgressAgree));
    await tester.pumpAndSettle();
    expect(settings.grants, 1);
    expect(find.text('Here is your day.'), findsOneWidget);
    expect(gateway.bodies.last['contextScopes'], isNotEmpty);
  });

  testWidgets('a consent withdrawn in Profile is asked for again',
      (tester) async {
    final gateway = _Gateway([
      ['{"text":"First."}', '[DONE]'],
      ['{"text":"Second."}', '[DONE]'],
    ]);
    final settings = _FakeSettings(_snapshot(version: 1));
    await _pump(tester, settings: settings, gateway: gateway);
    await _send(tester, 'Hi');
    expect(find.text('First.'), findsOneWidget);

    // Profile withdraws the consent and tells the open assistant.
    await settings.withdrawConsent();
    ProviderScope.containerOf(tester.element(find.byType(AiAssistantScreen)))
        .read(aiConsentRevisionProvider.notifier)
        .bump();
    await tester.pumpAndSettle();

    await _send(tester, 'Hi again');
    expect(find.text(_en.aiEgressTitle), findsOneWidget);
    await tester.tap(find.text(_en.aiEgressAgree));
    await tester.pumpAndSettle();
    expect(find.text('Second.'), findsOneWidget);
    expect(settings.grants, 1);
  });

  final denials = <String, String>{
    'scope_unavailable': _en.aiContextUnavailableMessage,
    'unsupported': _en.aiUnsupportedMessage,
  };
  for (final denial in denials.entries) {
    testWidgets('the ${denial.key} answer is explained without a reply',
        (tester) async {
      final gateway = _Gateway([
        [_denial(denial.key), '[DONE]'],
      ]);
      await _pump(
        tester,
        settings: _FakeSettings(_snapshot(version: 1)),
        gateway: gateway,
        useAppData: true,
      );

      await _send(tester, 'Plan my day');

      expect(find.text(denial.value), findsOneWidget);
      // Only the greeting is a model bubble; no empty reply is left.
      expect(find.byType(AiMarkdownText), findsOneWidget);
      expect(AiService.instance.isPaused, isFalse);
    });
  }

  testWidgets('a reply that fails halfway is not kept', (tester) async {
    final gateway = _Gateway([
      ['{"text":"Half of a"}', '{"error":"stream_failed"}', '[DONE]'],
    ]);
    await _pump(
      tester,
      settings: _FakeSettings(_snapshot(version: 1)),
      gateway: gateway,
    );

    await _send(tester, 'Plan my day');

    expect(find.text(_en.aiErrorMessage), findsOneWidget);
    expect(find.textContaining('Half of a'), findsNothing);
    expect(find.byType(AiMarkdownText), findsOneWidget);
  });

  testWidgets('G7: app data switch in Arabic at 200% text', (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      settings: _FakeSettings(_snapshot(version: 1)),
      gateway: _Gateway([]),
      locale: 'ar',
      textScale: 2,
    );
    expect(tester.takeException(), isNull);

    expect(_chip, findsOneWidget);
    expect(Directionality.of(tester.element(_chip)), TextDirection.rtl);
    final size = tester.getSize(_chip);
    expect(size.height, greaterThanOrEqualTo(48));
    expect(size.width, greaterThanOrEqualTo(48));
    expect(
      tester.getSemantics(_chip),
      isSemantics(label: _ar.aiContextChip, hasTapAction: true),
    );
    expect(find.byTooltip(_ar.aiSendTooltip), findsOneWidget);

    await tester.tap(_chip);
    await tester.pumpAndSettle();
    expect(find.text(_ar.aiContextDialogTitle), findsOneWidget);
    await tester.tap(find.text(_ar.aiContextDialogConfirm));
    await tester.pumpAndSettle();
    expect(tester.widget<FilterChip>(_chip).selected, isTrue);
    expect(tester.takeException(), isNull);
    semantics.dispose();
  });
}
