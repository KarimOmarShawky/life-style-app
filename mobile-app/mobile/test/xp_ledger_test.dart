import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';

XpEvent _win(XpType type, String id, String day, [int xp = 20]) =>
    XpEvent(type: type, entityId: id, dateKey: day, xp: xp);

void main() {
  test('an empty ledger is level 1 with a full level to go', () {
    final ledger = XpLedger();
    expect(ledger.totalXp, 0);
    expect(ledger.level, 1);
    expect(ledger.xpToNextLevel, XpLedger.xpPerLevel);
    expect(ledger.levelProgress, 0);
    expect(ledger.longestDayStreak, 0);
    expect(ledger.hasWin(XpType.task), isFalse);
  });

  test('level progress restarts at each level boundary', () {
    final ledger = XpLedger([
      for (var i = 0; i < 8; i++) _win(XpType.task, 't$i', '2026-11-01', 25),
      _win(XpType.focus, 'f1', '2026-11-01', 55),
    ]);
    expect(ledger.totalXp, 255);
    expect(ledger.level, 2);
    expect(ledger.xpToNextLevel, 145);
    expect(ledger.levelProgress, closeTo(0.275, 1e-9));
    expect(ledger.hasWin(XpType.task), isTrue);
    expect(ledger.hasWin(XpType.focus), isTrue);
    expect(ledger.hasWin(XpType.habit), isFalse);
  });

  test('the longest streak counts days in a row across a month end', () {
    const days = [
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ];
    final ledger = XpLedger([
      for (final day in days) _win(XpType.habit, 'h1', day),
      // A second win on the same day does not lengthen the run.
      _win(XpType.task, 't1', '2026-11-03'),
      // A later, shorter run does not replace the longest one.
      _win(XpType.focus, 'f1', '2026-11-10'),
    ]);
    expect(ledger.longestDayStreak, 7);
  });

  test('a missing day breaks the streak', () {
    final ledger = XpLedger([
      for (final day in ['2026-03-27', '2026-03-28', '2026-03-30'])
        _win(XpType.morning, 'm', day),
    ]);
    expect(ledger.longestDayStreak, 2);
  });
}
