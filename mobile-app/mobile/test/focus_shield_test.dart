import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_platform.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('clarity is deterministic and bounded', () {
    expect(calculateBrainClarityScore(0), 100);
    expect(calculateBrainClarityScore(3), 70);
    expect(calculateBrainClarityScore(12), 0);
    expect(calculateBrainClarityScore(-1), 100);
  });
  test('complete / un-complete / complete never revokes or re-awards XP', () {
    var ledger = XpLedger();
    void complete(bool done, String day) {
      if (done) {
        ledger = ledger.award(XpEvent(
            type: XpType.task,
            entityId: 'task-1',
            dateKey: day,
            xp: xpFor(XpType.task)));
      }
    }

    complete(true, '2026-10-14');
    expect(ledger.totalXp, 25);
    complete(false, '2026-10-14');
    expect(ledger.totalXp, 25);
    complete(true, '2026-10-15');
    expect(ledger.totalXp, 25);
    expect(ledger.events.length, 1);
  });
  test('habit awards are once per local day, focus once per session', () {
    var ledger = XpLedger();
    for (final day in ['2026-10-14', '2026-10-14', '2026-10-15']) {
      ledger = ledger.award(XpEvent(
          type: XpType.habit,
          entityId: 'h',
          dateKey: day,
          xp: xpFor(XpType.habit)));
      ledger = ledger.award(XpEvent(
          type: XpType.focus,
          entityId: 'f',
          dateKey: day,
          xp: xpFor(XpType.focus)));
    }
    expect(ledger.totalXp, 80);
    expect(ledger.events.length, 3);
    expect(
        XpLedger(ledger.events.values.map((e) => XpEvent.fromJson(
                jsonDecode(jsonEncode(e.toJson())) as Map<String, dynamic>)))
            .totalXp,
        80);
  });
  test('XP rules reward clean completion, not distraction attempts', () {
    expect(xpFor(XpType.task), 25);
    expect(xpFor(XpType.habit), 20);
    expect(xpFor(XpType.focus), 40);
    expect(xpFor(XpType.focus, shieldCompleted: true), 55);
    expect(xpFor(XpType.focus, shieldCompleted: true, manualBypasses: 1), 40);
    expect(xpFor(XpType.morning), 30);
    expect(xpFor(XpType.shutdown), 30);
  });
  test('level and rank thresholds', () {
    for (final entry in <int, String>{
      0: 'Digital Wanderer',
      400: 'Focus Apprentice',
      800: 'Deep Work Practitioner',
      1400: 'Dopamine Master',
      1800: 'Monk Mode Legend'
    }.entries) {
      final ledger = XpLedger([
        XpEvent(type: XpType.task, entityId: 't', dateKey: '', xp: entry.key)
      ]);
      expect(ledger.level, entry.key ~/ 200 + 1);
      expect(ledger.rank, entry.value);
    }
  });
  test('badges unlock idempotently with qualifying completed sessions only',
      () {
    final ledger = XpLedger(List.generate(
        10,
        (i) =>
            XpEvent(type: XpType.task, entityId: '$i', dateKey: '', xp: 25)));
    final records = List.generate(
        3,
        (i) => FocusSessionRecord(
            id: '$i',
            endedAt: DateTime(2026, 10, 14),
            durationSeconds: 1500,
            attempts: 0,
            shieldCompleted: true,
            manualBypasses: 0,
            completed: true,
            clarityScore: 100));
    final badges = earnedBadges(ledger, records, repliedInline: true);
    expect(badges.length, 5);
    expect(
        {...badges, ...earnedBadges(ledger, records, repliedInline: true)}
            .length,
        5);
    expect(earnedBadges(XpLedger(), []), isEmpty);
  });
  test('channel contract includes schemaVersion and preserves typed failure',
      () async {
    const channel = MethodChannel(MethodChannelFocusShieldPlatform.channelName);
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(channel, (call) async {
      final arguments = call.arguments as Map<Object?, Object?>;
      expect(arguments['schemaVersion'], 1);
      expect(arguments['text'], 'keep my draft');
      return {'schemaVersion': 1, 'result': 'stale'};
    });
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
    expect(
        await MethodChannelFocusShieldPlatform()
            .sendReply('key', 'keep my draft'),
        ReplyResult.stale);
  });
  test('unknown response schemas are rejected', () async {
    const channel = MethodChannel(MethodChannelFocusShieldPlatform.channelName);
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
        channel, (_) async => {'schemaVersion': 2});
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
    await expectLater(MethodChannelFocusShieldPlatform().getShieldState(),
        throwsFormatException);
  });
  test(
      'provider is off by default, serializes concurrent awards, persists ledger',
      () async {
    SharedPreferences.setMockInitialValues({});
    final fake = FakeFocusShieldPlatform();
    final container = ProviderContainer(overrides: [
      focusAccountIdProvider.overrideWithValue('test-user'),
      focusShieldPlatformProvider.overrideWithValue(fake),
    ]);
    addTearDown(container.dispose);
    addTearDown(fake.dispose);
    expect((await container.read(focusShieldProvider.future)).enabled, isFalse);
    final controller = container.read(focusShieldProvider.notifier);
    await Future.wait(
        List.generate(5, (_) => controller.award(XpType.task, 't')));
    expect(container.read(focusShieldProvider).requireValue.ledger.totalXp, 25);
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('focus_suite.v1.test-user')!;
    expect(saved, isNot(contains('sender')));
    expect(saved, isNot(contains('inbox')));
    expect(saved, isNot(contains('draft')));
  });
  test('fake supports active session and all reply outcomes', () async {
    final fake = FakeFocusShieldPlatform();
    addTearDown(fake.dispose);
    await fake.invoke('startShield',
        {'sessionId': 's', 'taskTitle': 'Study', 'endTimestampMs': 2000});
    expect((await fake.getShieldState()).active, isTrue);
    for (final result in ReplyResult.values) {
      fake.replyResult = result;
      expect(await fake.sendReply('key', 'text'), result);
    }
    await fake.invoke('stopShield');
    expect((await fake.getShieldState()).active, isFalse);
  });
}
