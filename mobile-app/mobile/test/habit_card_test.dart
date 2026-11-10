import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/features/habits/data/habit_model.dart';
import 'package:lifestyle_mobile/features/habits/data/habits_repository.dart';
import 'package:lifestyle_mobile/features/habits/presentation/widgets/habit_card.dart';
import 'package:lifestyle_mobile/features/habits/state/habits_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

const _en = AppLocalizations(Locale('en'));

Habit _habit({
  int current = 0,
  int best = 0,
  String name = 'Read ten pages',
  String? description,
}) {
  return Habit(
    id: 'habit-1',
    name: name,
    description: description,
    status: 'active',
    currentStreak: current,
    longestStreak: best,
    version: 1,
  );
}

class _FailingHabitsRepository extends Fake implements HabitsRepository {
  @override
  Future<void> checkinHabit(
    String habitId,
    String date, {
    String status = 'done',
  }) async {
    throw Exception('offline');
  }
}

Future<void> _pump(
  WidgetTester tester,
  Habit habit, {
  Locale locale = const Locale('en'),
  double textScale = 1,
  List<Override> overrides = const [],
}) async {
  // A small phone: 360 x 720 logical pixels.
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(720, 1440);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: overrides,
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
      home: Scaffold(
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [HabitCard(habit: habit)],
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a zero streak invites a start instead of showing a loss (G4)',
      (tester) async {
    await _pump(tester, _habit());
    expect(find.text(_en.habitStartToday), findsOneWidget);
    expect(find.text(_en.habitStreakDays(0)), findsNothing);

    await _pump(tester, _habit(best: 5));
    expect(find.text(_en.habitFreshStart), findsOneWidget);
    expect(find.text(_en.habitBestStreak(5)), findsOneWidget);
    expect(find.text(_en.habitStreakDays(0)), findsNothing);
  });

  testWidgets('the best streak shows only when it is above the current one',
      (tester) async {
    await _pump(tester, _habit(current: 3, best: 7));
    expect(find.text(_en.habitStreakDays(3)), findsOneWidget);
    expect(find.text(_en.habitBestStreak(7)), findsOneWidget);

    await _pump(tester, _habit(current: 7, best: 7));
    expect(find.text(_en.habitStreakDays(7)), findsOneWidget);
    expect(find.text(_en.habitBestStreak(7)), findsNothing);
  });

  test('streak copy uses no guilt words in any language (G4)', () {
    final guilt = RegExp(
      r'\b(broke|broken|lost|lose|fail|failed|missed)\b|verloren|verpasst|'
      r'perdu|raté|manqué|perdiste|fallaste|kaybett|kaçırd|'
      r'خسرت|فشلت|فاتك|كسرت',
      caseSensitive: false,
    );
    for (final locale in AppLocalizations.supportedLocales) {
      final l10n = AppLocalizations(locale);
      final copy = [
        l10n.habitStreakDays(0),
        l10n.habitBestStreak(3),
        l10n.habitStartToday,
        l10n.habitFreshStart,
        l10n.habitCheckInTooltip,
        l10n.habitCheckInFailed,
      ];
      for (final text in copy) {
        expect(guilt.hasMatch(text), isFalse, reason: '$locale: $text');
      }
    }
  });

  testWidgets('check-in is labelled, large enough and readable (G7)',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      _habit(current: 2, best: 9, description: 'After dinner'),
    );
    expect(find.byTooltip(_en.habitCheckInTooltip), findsOneWidget);
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    semantics.dispose();
  });

  testWidgets('Arabic at 200% text: right-to-left with no overflow (G7)',
      (tester) async {
    final semantics = tester.ensureSemantics();
    const ar = AppLocalizations(Locale('ar'));
    await _pump(
      tester,
      _habit(
        current: 12,
        best: 30,
        name: 'قراءة عشر صفحات من كتاب جديد كل يوم قبل النوم',
        description: 'بعد العشاء مباشرة، بعيد عن الموبايل',
      ),
      locale: const Locale('ar'),
      textScale: 2,
    );
    expect(tester.takeException(), isNull);
    expect(find.text(ar.habitStreakDays(12)), findsOneWidget);
    expect(find.text(ar.habitBestStreak(30)), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text(ar.habitStreakDays(12)))),
      TextDirection.rtl,
    );
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    semantics.dispose();
  });

  testWidgets('English at 200% text with long words does not overflow (G7)',
      (tester) async {
    await _pump(
      tester,
      _habit(
        best: 4,
        name: 'Supercalifragilisticexpialidocious morning stretching',
        description: 'Pneumonoultramicroscopicsilicovolcanoconiosis awareness',
      ),
      textScale: 2,
    );
    expect(tester.takeException(), isNull);
    expect(find.text(_en.habitFreshStart), findsOneWidget);
  });

  testWidgets('a failed check-in says so kindly and keeps the button usable',
      (tester) async {
    await _pump(
      tester,
      _habit(current: 4, best: 4),
      overrides: [
        habitsRepositoryProvider.overrideWithValue(_FailingHabitsRepository()),
      ],
    );
    await tester.tap(find.byTooltip(_en.habitCheckInTooltip));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text(_en.habitCheckInFailed), findsOneWidget);
    final button = tester.widget<IconButton>(find.byType(IconButton));
    expect(button.onPressed, isNotNull);
  });
}
