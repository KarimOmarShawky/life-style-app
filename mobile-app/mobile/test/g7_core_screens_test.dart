import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_platform.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/features/home/presentation/home_shell.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/tasks/presentation/tasks_screen.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/features/timer/presentation/focus_timer_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// G7 widening (A2): the home tab bar, the tasks list and the focus timer in
/// Arabic at 200 % text on a 320 x 640 phone, plus a normal-size sanity pass.

class _SignedInAuth extends AuthController {
  _SignedInAuth(this._user);

  final AppUser _user;

  @override
  Future<AppUser?> build() async => _user;
}

/// The focus timer reads the timer-sessions repository at start; a client
/// with a dummy address keeps the test off the network and off API_BASE_URL.
class _NoTokenStore implements TokenStore {
  @override
  Future<void> clear() async {}

  @override
  Future<SessionTokens?> read() async => null;

  @override
  Future<void> write(SessionTokens tokens) async {}
}

const _longTitle = 'مراجعة تقرير المشروع الأسبوعي مع الفريق';

String _dateKey(DateTime day) {
  final month = day.month.toString().padLeft(2, '0');
  final date = day.day.toString().padLeft(2, '0');
  return '${day.year}-$month-$date';
}

List<Task> _tasks() {
  final today = _dateKey(DateTime.now());
  return [
    Task.fromJson({
      'id': 'task-1',
      'title': _longTitle,
      'status': 'todo',
      'priority': 'high',
      'version': 1,
      'dueDate': today,
      'dueTime': '09:30',
    }),
    Task.fromJson({
      'id': 'task-2',
      'title': 'الاتصال بالعميل',
      'status': 'done',
      'priority': 'none',
      'version': 1,
      'dueDate': today,
    }),
  ];
}

String _weekday(AppLocalizations l10n, int weekday) {
  final names = [
    l10n.weekdayShort1,
    l10n.weekdayShort2,
    l10n.weekdayShort3,
    l10n.weekdayShort4,
    l10n.weekdayShort5,
    l10n.weekdayShort6,
    l10n.weekdayShort7,
  ];
  return names[weekday - 1];
}

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  String locale = 'ar',
  double textScale = 2,
}) async {
  SharedPreferences.setMockInitialValues({'app_locale': locale});
  // A small phone: 320 x 640 logical pixels.
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(640, 1280);
  addTearDown(tester.view.reset);
  final user = AppUser.fromJson({
    'id': 'user-1',
    'email': 'user@example.test',
    'displayName': 'Mona',
    'timezone': 'Africa/Cairo',
    'locale': locale,
    'defaultCurrency': 'EGP',
    'status': 'active',
  });
  await tester.pumpWidget(ProviderScope(
    key: ValueKey<String>('g7-$locale-$textScale'),
    overrides: [
      authProvider.overrideWith(() => _SignedInAuth(user)),
      focusShieldPlatformProvider.overrideWithValue(FakeFocusShieldPlatform()),
      tasksProvider.overrideWith((ref) async => _tasks()),
      apiClientProvider.overrideWithValue(
        ApiClient(
          baseUri: Uri.parse('https://api.example.test/api/v1/'),
          tokenStore: _NoTokenStore(),
        ),
      ),
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
      home: home,
    ),
  ));
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

bool _isVerticalList(Widget widget) =>
    widget is Scrollable && widget.axisDirection == AxisDirection.down;

bool _hasCustomActions(Widget widget) =>
    widget is Semantics && widget.properties.customSemanticsActions != null;

Future<void> _meetsG7Guidelines(WidgetTester tester) async {
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  await expectLater(tester, meetsGuideline(textContrastGuideline));
}

void main() {
  const ar = AppLocalizations(Locale('ar'));

  testWidgets('Home tab bar: Arabic at 200% on a narrow screen (G7)',
      (tester) async {
    final semantics = tester.ensureSemantics();
    final selected = <int>[];
    await _pump(
      tester,
      Scaffold(
        body: const SizedBox.shrink(),
        bottomNavigationBar: HomeNavigationBar(
          selectedIndex: 0,
          onDestinationSelected: selected.add,
        ),
      ),
    );
    final bar = find.byType(NavigationBar);
    expect(Directionality.of(tester.element(bar)), TextDirection.rtl);
    for (final label in [
      ar.tasks,
      ar.habits,
      ar.aiAssistant,
      ar.notes,
      ar.tr('focus'),
      ar.moreTitle,
    ]) {
      expect(find.byTooltip(label), findsOneWidget, reason: label);
    }
    await tester.tap(find.byTooltip(ar.habits));
    await tester.pumpAndSettle();
    expect(selected, [1]);
    await _meetsG7Guidelines(tester);
    semantics.dispose();
  });

  testWidgets('Tasks: Arabic at 200% on a narrow screen (G7)', (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester, const TasksScreen());
    expect(find.text(_longTitle), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text(_longTitle))),
      TextDirection.rtl,
    );

    // Day cells are buttons; weekday names and subtitles use the catalog.
    await tester.ensureVisible(find.text(ar.today));
    await tester.pumpAndSettle();
    final todayCell = find.ancestor(
      of: find.text(ar.today),
      matching: find.byType(InkWell),
    );
    expect(
      tester.getSemantics(todayCell.first),
      containsSemantics(isButton: true, hasTapAction: true),
    );
    final tomorrow = DateTime.now().add(const Duration(days: 1)).weekday;
    expect(find.text(_weekday(ar, tomorrow)), findsWidgets);
    expect(find.textContaining(ar.statusTodo), findsWidgets);
    expect(find.textContaining(ar.priorityHigh), findsWidgets);
    expect(find.textContaining('Due '), findsNothing);
    expect(find.textContaining('todo'), findsNothing);
    await _meetsG7Guidelines(tester);

    // Swipe-to-delete has a spoken alternative.
    final deleteAction = find.byWidgetPredicate(_hasCustomActions);
    expect(deleteAction, findsWidgets);
    expect(
      tester.getSemantics(deleteAction.first),
      containsSemantics(
        customActions: [CustomSemanticsAction(label: ar.delete)],
      ),
    );

    // The briefing scrolls with the list; bring the first task into view.
    await tester.scrollUntilVisible(
      find.text(_longTitle),
      120,
      scrollable: find.byWidgetPredicate(_isVerticalList),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    // In Arabic the swipe goes left to right and reveals the bin on the left.
    final tile = find.byType(Dismissible).first;
    final gesture = await tester.startGesture(tester.getCenter(tile));
    await gesture.moveBy(const Offset(30, 0));
    await gesture.moveBy(const Offset(70, 0));
    await tester.pump();
    final bin = find.byIcon(Icons.delete_outline);
    expect(bin, findsOneWidget);
    expect(tester.getCenter(bin).dx, lessThan(160));
    await gesture.moveBy(const Offset(-100, 0));
    await gesture.up();
    await tester.pumpAndSettle();
    expect(find.byType(Dismissible), findsNWidgets(2));
    semantics.dispose();
  });

  testWidgets('Focus timer: Arabic at 200% on a narrow screen (G7)',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester, const FocusTimerScreen());
    final time = find.text('25:00');
    expect(time, findsOneWidget);
    expect(Directionality.of(tester.element(time)), TextDirection.rtl);

    // The dial grows with the text but stays inside the 272 px content width,
    // and the countdown fits inside the ring.
    final ring = tester.getRect(find.byType(CircularProgressIndicator));
    expect(ring.width, greaterThan(240));
    expect(ring.width, lessThanOrEqualTo(272));
    final digits = tester.getRect(time);
    expect(ring.contains(digits.topLeft), isTrue);
    expect(ring.contains(digits.bottomRight), isTrue);
    await _meetsG7Guidelines(tester);

    // The controls are reachable by scrolling instead of being cut off.
    await tester.scrollUntilVisible(
      find.text(ar.start),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    semantics.dispose();
  });

  testWidgets('Normal size: English timer and German weekday names',
      (tester) async {
    await _pump(
      tester,
      const FocusTimerScreen(),
      locale: 'en',
      textScale: 1,
    );
    const en = AppLocalizations(Locale('en'));
    expect(find.text(en.start), findsOneWidget);
    expect(
      tester.getSize(find.byType(CircularProgressIndicator)).width,
      240,
    );

    await _pump(tester, const TasksScreen(), locale: 'de', textScale: 1);
    const de = AppLocalizations(Locale('de'));
    final tomorrow = DateTime.now().add(const Duration(days: 1)).weekday;
    expect(find.text(_weekday(de, tomorrow)), findsWidgets);
    expect(find.textContaining(de.statusTodo), findsWidgets);
  });
}
