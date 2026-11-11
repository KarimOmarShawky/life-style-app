import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/auth/data/sessions_client.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/presentation/signed_in_devices_screen.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Feature guide G6 (ADR-047): Profile → Signed-in devices.

class _Auth extends AuthController {
  _Auth(this._user);

  final AppUser _user;
  int signOuts = 0;

  @override
  Future<AppUser?> build() async => _user;

  @override
  Future<void> signOut() async {
    signOuts += 1;
    state = const AsyncData(null);
  }
}

class _FakeSessions implements SessionsClient {
  _FakeSessions(this.devices);

  List<SignedInDevice> devices;
  bool truncated = false;
  Object? listError;
  Object? revokeError;
  int listCalls = 0;
  final revoked = <String>[];
  final passwords = <String>[];

  @override
  Future<SignedInDevices> list() async {
    listCalls += 1;
    final error = listError;
    if (error != null) throw error;
    return SignedInDevices(devices: List.of(devices), truncated: truncated);
  }

  @override
  Future<bool> revoke(String sessionId, String currentPassword) async {
    final error = revokeError;
    if (error != null) throw error;
    revoked.add(sessionId);
    passwords.add(currentPassword);
    final target = devices.firstWhere((device) => device.id == sessionId);
    devices = devices.where((device) => device.id != sessionId).toList();
    return target.current;
  }
}

SignedInDevice _device(
  String id, {
  required bool current,
  String platform = 'android',
  String? name,
  String? version = '1.0.1',
}) {
  final now = DateTime(2026, 11, 11, 18);
  return SignedInDevice(
    id: id,
    platform: platform,
    deviceName: name,
    appVersion: version,
    createdAt: now.subtract(const Duration(days: 3)),
    lastUsedAt: now.subtract(const Duration(minutes: 5)),
    current: current,
  );
}

List<SignedInDevice> _threeDevices() => [
      // Older app versions sent this placeholder name for every device.
      _device('this-1', current: true, name: 'Arena Mobile Client'),
      _device('ios-1', current: false, platform: 'ios', name: 'iPad Pro'),
      _device('other-1', current: false, platform: 'unknown', version: null),
    ];

final _user = AppUser.fromJson(const {
  'id': 'user-1',
  'email': 'user@example.test',
  'displayName': 'Mona',
  'timezone': 'Africa/Cairo',
  'locale': 'en',
  'defaultCurrency': 'EGP',
  'status': 'active',
});

Future<void> _pump(
  WidgetTester tester, {
  required _FakeSessions sessions,
  required _Auth auth,
  String locale = 'en',
  double textScale = 1,
}) async {
  SharedPreferences.setMockInitialValues({'app_locale': locale});
  // A small phone: 320 x 640 logical pixels.
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(640, 1280);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      authProvider.overrideWith(() => auth),
      sessionsClientProvider.overrideWithValue(sessions),
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
      home: const SignedInDevicesScreen(),
    ),
  ));
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

Future<void> _confirmAndEnterPassword(
  WidgetTester tester,
  AppLocalizations l10n,
  String password,
) async {
  final label = l10n.signedInDevicesSignOut;
  await tester.tap(find.widgetWithText(FilledButton, label));
  await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField), password);
  await tester.tap(find.widgetWithText(FilledButton, l10n.verifyAndContinue));
  await tester.pumpAndSettle();
}

void main() {
  const en = AppLocalizations(Locale('en'));
  const ar = AppLocalizations(Locale('ar'));

  testWidgets('Lists devices in Arabic at 200% on a narrow screen (G7)',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      sessions: _FakeSessions(_threeDevices()),
      auth: _Auth(_user),
      locale: 'ar',
      textScale: 2,
    );
    final marker = find.text(ar.signedInDevicesThisDevice);
    expect(marker, findsOneWidget);
    expect(Directionality.of(tester.element(marker)), TextDirection.rtl);
    // The placeholder name is replaced by the platform.
    expect(find.text(ar.signedInDevicesPlatformAndroid), findsOneWidget);
    expect(find.text('Arena Mobile Client'), findsNothing);
    expect(find.text('iPad Pro'), findsOneWidget);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));

    await tester.scrollUntilVisible(
      find.text(ar.signedInDevicesPlatformUnknown),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    semantics.dispose();
  });

  testWidgets('Signs out another device after confirmation and the password',
      (tester) async {
    final sessions = _FakeSessions(_threeDevices());
    final auth = _Auth(_user);
    await _pump(tester, sessions: sessions, auth: auth);

    final ipad = find.byTooltip(en.signedInDevicesSignOutDevice('iPad Pro'));
    await tester.tap(ipad);
    await tester.pumpAndSettle();
    final question = en.signedInDevicesConfirmOther('iPad Pro');
    expect(find.text(question), findsOneWidget);
    await _confirmAndEnterPassword(tester, en, 'Correct horse 1!');

    expect(sessions.revoked, ['ios-1']);
    expect(sessions.passwords, ['Correct horse 1!']);
    final done = en.signedInDevicesSignedOutOther('iPad Pro');
    expect(find.text(done), findsOneWidget);
    expect(sessions.listCalls, 2);
    expect(ipad, findsNothing);
    expect(auth.signOuts, 0);
  });

  testWidgets('Cancelling either dialog signs nothing out', (tester) async {
    final sessions = _FakeSessions(_threeDevices());
    await _pump(tester, sessions: sessions, auth: _Auth(_user));

    final ipad = find.byTooltip(en.signedInDevicesSignOutDevice('iPad Pro'));
    final label = en.signedInDevicesSignOut;
    final confirm = find.widgetWithText(FilledButton, label);
    await tester.tap(ipad);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, en.cancel));
    await tester.pumpAndSettle();
    await tester.tap(ipad);
    await tester.pumpAndSettle();
    await tester.tap(confirm);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, en.cancel));
    await tester.pumpAndSettle();
    expect(sessions.revoked, isEmpty);
  });

  testWidgets('Signing out this device signs out of the app', (tester) async {
    final sessions = _FakeSessions(_threeDevices());
    final auth = _Auth(_user);
    await _pump(tester, sessions: sessions, auth: auth);

    final thisDevice = en.signedInDevicesPlatformAndroid;
    final button = find.byTooltip(en.signedInDevicesSignOutDevice(thisDevice));
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.text(en.signedInDevicesConfirmCurrent), findsOneWidget);
    await _confirmAndEnterPassword(tester, en, 'Correct horse 1!');

    expect(sessions.revoked, ['this-1']);
    expect(auth.signOuts, 1);
  });

  testWidgets('A wrong password or too many attempts keep the device',
      (tester) async {
    final sessions = _FakeSessions(_threeDevices())
      ..revokeError = const ApiException(
        statusCode: 403,
        code: 'REAUTHENTICATION_FAILED',
        message: 'Current password verification failed',
      );
    final auth = _Auth(_user);
    await _pump(tester, sessions: sessions, auth: auth);
    final button = find.byTooltip(en.signedInDevicesSignOutDevice('iPad Pro'));

    await tester.tap(button);
    await tester.pumpAndSettle();
    await _confirmAndEnterPassword(tester, en, 'wrong');
    expect(find.text(en.signedInDevicesWrongPassword), findsOneWidget);
    expect(button, findsOneWidget);

    sessions.revokeError = const ApiException(
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    );
    ScaffoldMessenger.of(tester.element(button)).clearSnackBars();
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
    await _confirmAndEnterPassword(tester, en, 'wrong again');
    expect(find.text(en.signedInDevicesTooManyAttempts), findsOneWidget);
    expect(sessions.revoked, isEmpty);
    expect(auth.signOuts, 0);
  });

  testWidgets('Shows the empty, truncated and error states', (tester) async {
    final sessions = _FakeSessions([_device('this-1', current: true)])
      ..truncated = true;
    await _pump(tester, sessions: sessions, auth: _Auth(_user));
    expect(find.text(en.signedInDevicesEmpty), findsOneWidget);
    expect(find.text(en.signedInDevicesMore), findsOneWidget);

    final failing = _FakeSessions(_threeDevices())
      ..listError = Exception('offline');
    await _pump(tester, sessions: failing, auth: _Auth(_user));
    expect(find.text(en.signedInDevicesLoadFailed), findsOneWidget);
    failing.listError = null;
    await tester.tap(find.widgetWithText(FilledButton, en.retry));
    await tester.pumpAndSettle();
    expect(find.text('iPad Pro'), findsOneWidget);
  });

  test('parses metadata and names devices without a real name', () {
    final device = SignedInDevice.fromJson(const {
      'id': 'abc',
      'devicePlatform': 'ios',
      'deviceName': null,
      'appVersion': '1.0.1',
      'createdAt': '2026-11-01T08:00:00.000Z',
      'lastUsedAt': '2026-11-11T09:30:00.000Z',
      'current': true,
    });
    expect(device.id, 'abc');
    expect(device.current, isTrue);
    expect(device.lastUsedAt.toUtc(), DateTime.utc(2026, 11, 11, 9, 30));
    expect(deviceLabel(en, device), en.signedInDevicesPlatformIos);
    expect(
      deviceLabel(en, _device('x', current: false, name: 'Pixel 8')),
      'Pixel 8',
    );
    final legacy = _device('y', current: false, name: 'Arena Mobile Client');
    expect(deviceLabel(en, legacy), en.signedInDevicesPlatformAndroid);
  });
}
