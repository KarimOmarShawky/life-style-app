import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/notification_policy.dart';
import 'package:lifestyle_mobile/data/notification_preferences.dart';
import 'package:lifestyle_mobile/data/notification_scheduler.dart';
import 'package:lifestyle_mobile/features/notifications/notification_settings_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class _FakeClient implements NotificationPreferencesClient {
  _FakeClient(this.settings);

  NotificationSettings settings;
  Object? saveError;
  final List<NotificationPreferences> saved = [];

  @override
  Future<NotificationSettings> fetch() async => settings;

  @override
  Future<NotificationSettings> save(NotificationPreferences preferences) async {
    final error = saveError;
    if (error != null) throw error;
    saved.add(preferences);
    settings = settings.withPreferences(preferences);
    return settings;
  }
}

class _NoopSink implements NotificationSink {
  @override
  Future<void> showReminderAt({
    required int id,
    required ReminderKind kind,
    required String title,
    required String body,
    required DateTime at,
  }) async {}

  @override
  Future<void> showAlarmAt({
    required int id,
    required String title,
    required String body,
    required DateTime at,
  }) async {}

  @override
  Future<void> showSummaryAt({
    required int id,
    required int count,
    required DateTime at,
  }) async {}

  @override
  Future<void> cancelNotification(int id) async {}
}

NotificationSettings _settings({
  NotificationPreferences preferences = NotificationPreferences.defaults,
  bool available = true,
}) {
  return NotificationSettings(
    preferences: preferences,
    timeZone: 'Africa/Cairo',
    available: available,
  );
}

Widget _app(
  _FakeClient client, {
  Locale locale = const Locale('en'),
  double textScale = 1,
}) {
  return ProviderScope(
    overrides: [
      notificationPreferencesClientProvider.overrideWithValue(client),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
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
      home: const NotificationSettingsScreen(),
    ),
  );
}

/// Feature guide G2 (ADR-046) settings screen, with the G7 accessibility
/// gate for new UI.
void main() {
  setUpAll(tzdata.initializeTimeZones);

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    NotificationScheduler.instance = NotificationScheduler(sink: _NoopSink());
  });

  const en = AppLocalizations(Locale('en'));

  testWidgets('quiet hours start at the suggested 22:00-07:00 when turned on',
      (tester) async {
    final client = _FakeClient(_settings());
    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();
    expect(find.text(en.quietHoursStart), findsNothing);

    await tester.tap(find.text(en.quietHoursTitle));
    await tester.pumpAndSettle();
    expect(client.saved.single.quietStartMinute, 22 * 60);
    expect(client.saved.single.quietEndMinute, 7 * 60);
    expect(find.text(en.quietHoursStart), findsOneWidget);
    expect(find.text(en.quietHoursEnd), findsOneWidget);
    expect(find.text(en.alarmsBreakQuietTitle), findsOneWidget);
  });

  testWidgets('choosing a daily limit saves it; the time zone is shown',
      (tester) async {
    final client = _FakeClient(_settings());
    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();

    final five = find.text(en.dailyLimitPerDay(5));
    await tester.scrollUntilVisible(five, 100,
        scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    await tester.tap(five);
    await tester.pumpAndSettle();
    expect(client.saved.single.dailyCap, 5);
    expect(
      find.text(en.notificationTimeZoneNote('Africa/Cairo')),
      findsOneWidget,
    );
  });

  testWidgets('a failed save keeps the previous settings and says why',
      (tester) async {
    final client = _FakeClient(_settings());
    client.saveError = const ApiException(
      statusCode: 503,
      code: 'NOTIFICATION_PREFERENCES_UNAVAILABLE',
      message: 'Notification settings cannot be saved yet',
    );
    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();

    await tester.tap(find.text(en.notificationsMasterSwitch));
    await tester.pumpAndSettle();
    expect(find.text(en.notificationSettingsUnavailable), findsOneWidget);
    final master = tester.widget<SwitchListTile>(
      find.ancestor(
        of: find.text(en.notificationsMasterSwitch),
        matching: find.byType(SwitchListTile),
      ),
    );
    expect(master.value, isTrue);
  });

  testWidgets('before the server is ready the controls are disabled',
      (tester) async {
    final client = _FakeClient(_settings(available: false));
    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();

    expect(find.text(en.notificationSettingsUnavailable), findsOneWidget);
    await tester.tap(find.text(en.quietHoursTitle));
    await tester.pumpAndSettle();
    expect(client.saved, isEmpty);
  });

  testWidgets('Arabic at 200% text: no overflow, RTL, labelled targets (G7)',
      (tester) async {
    tester.view.devicePixelRatio = 2;
    tester.view.physicalSize = const Size(720, 1440);
    addTearDown(tester.view.reset);
    final semantics = tester.ensureSemantics();
    const ar = AppLocalizations(Locale('ar'));
    final client = _FakeClient(
      _settings(
        preferences: const NotificationPreferences(
          quietStartMinute: 22 * 60,
          quietEndMinute: 7 * 60,
          dailyCap: 5,
        ),
      ),
    );
    await tester.pumpWidget(
      _app(client, locale: const Locale('ar'), textScale: 2),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final master = find.text(ar.notificationsMasterSwitch);
    expect(Directionality.of(tester.element(master)), TextDirection.rtl);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));

    final note = find.text(ar.notificationTimeZoneNote('Africa/Cairo'));
    await tester.scrollUntilVisible(note, 200,
        scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    semantics.dispose();
  });
}
