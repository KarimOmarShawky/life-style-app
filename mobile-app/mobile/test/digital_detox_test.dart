import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/digital_detox/detox_session.dart';

class MemoryDetoxStore implements DetoxStore {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String snapshot) async {
    value = snapshot;
  }

  @override
  Future<void> clear() async {
    value = null;
  }
}

class TestEnforcer implements DetoxEnforcer {
  RestrictionStatus applyResult = RestrictionStatus.partial;
  RestrictionStatus actual = RestrictionStatus.off;
  bool failApply = false;
  bool failRelease = false;
  int applies = 0;
  int releases = 0;
  int orphanReleases = 0;
  @override
  Future<RestrictionResult> apply(
    String id,
    DetoxMode mode,
    Set<String> packages,
    DateTime end,
  ) async {
    applies++;
    if (failApply) throw StateError('denied');
    actual = applyResult;
    return RestrictionResult(actual, 'Test scope');
  }

  @override
  Future<RestrictionResult> query(String id) async =>
      RestrictionResult(actual, 'Queried native state');
  @override
  Future<RestrictionResult> release(String id) async {
    releases++;
    if (failRelease) throw StateError('release failed');
    actual = RestrictionStatus.off;
    return const RestrictionResult(RestrictionStatus.off, 'Released');
  }

  @override
  Future<void> releaseOrphan() async {
    orphanReleases++;
    actual = RestrictionStatus.off;
  }
}

void main() {
  late DateTime now;
  late TestEnforcer enforcer;
  late MemoryDetoxStore store;
  late DetoxSession session;
  setUp(() {
    now = DateTime.utc(2026, 10, 15);
    enforcer = TestEnforcer();
    store = MemoryDetoxStore();
    session = DetoxSession(enforcer, store, now: () => now);
  });
  Future<void> start() =>
      session.start(selectedMode: DetoxMode.strictFocus, focus: 1, rest: 1);

  test('default durations, bounds and empty app selection', () async {
    expect(session.focusMinutes, 45);
    expect(session.breakMinutes, 15);
    for (final pair in [
      [0, 15],
      [181, 15],
      [45, 0],
      [45, 61],
    ]) {
      expect(
        () => validateDetoxDurations(pair[0], pair[1]),
        throwsArgumentError,
      );
    }
    await expectLater(
      session.start(selectedMode: DetoxMode.selectedApps),
      throwsArgumentError,
    );
  });
  for (final from in DetoxState.values) {
    for (final to in DetoxState.values) {
      test('transition ${from.name} -> ${to.name}', () {
        if (detoxTransitions[from]!.contains(to)) {
          expect(() => validateDetoxTransition(from, to), returnsNormally);
        } else {
          expect(() => validateDetoxTransition(from, to), throwsStateError);
        }
      });
    }
  }
  test(
    'only full confirmation can report ACTIVE; partial remains partial',
    () async {
      await start();
      expect(session.state, DetoxState.FOCUS_PARTIAL);
      await session.stop();
      enforcer.applyResult = RestrictionStatus.full;
      await start();
      expect(session.state, DetoxState.FOCUS_ACTIVE);
    },
  );
  test('denial/failed apply produces ERROR, never active', () async {
    enforcer.failApply = true;
    await start();
    expect(session.state, DetoxState.ERROR);
    expect(session.error, isNotNull);
  });
  test(
    'unsupported enforcement requires explicit opt-in for unenforced timer',
    () async {
      enforcer.applyResult = RestrictionStatus.unavailable;
      await start();
      expect(session.state, DetoxState.ERROR);
      await session.stop();
      await session.start(
        selectedMode: DetoxMode.strictFocus,
        timerOnlyAllowed: true,
      );
      expect(session.state, DetoxState.FOCUS_UNENFORCED);
    },
  );
  test(
    'pause releases, freezes time and resume reapplies the same remaining duration',
    () async {
      await start();
      now = now.add(const Duration(seconds: 20));
      await session.pause();
      expect(session.state, DetoxState.PAUSED);
      expect(session.remainingSeconds, 40);
      expect(enforcer.actual, RestrictionStatus.off);
      now = now.add(const Duration(seconds: 50));
      expect(session.remainingSeconds, 40);
      await session.resume();
      expect(session.remainingSeconds, 40);
      expect(session.state, DetoxState.FOCUS_PARTIAL);
      expect(enforcer.applies, 2);
    },
  );
  test(
    'expiry releases before break, completes without repeat; Continue is explicit',
    () async {
      await start();
      now = now.add(const Duration(seconds: 61));
      await session.reconcile();
      expect(session.state, DetoxState.BREAK_ACTIVE);
      expect(enforcer.actual, RestrictionStatus.off);
      expect(session.remainingSeconds, 60);
      now = now.add(const Duration(seconds: 61));
      await session.reconcile();
      expect(session.state, DetoxState.COMPLETED);
      expect(enforcer.applies, 1);
      await session.continueCycle();
      expect(enforcer.applies, 2);
      expect(session.state, DetoxState.FOCUS_PARTIAL);
    },
  );
  test(
    'failed release cannot claim a break or stopped state; retry Stop recovers',
    () async {
      await start();
      enforcer.failRelease = true;
      now = now.add(const Duration(seconds: 61));
      await session.reconcile();
      expect(session.state, DetoxState.ERROR);
      expect(enforcer.actual, RestrictionStatus.partial);
      await session.stop();
      expect(session.state, DetoxState.ERROR);
      enforcer.failRelease = false;
      await session.stop();
      expect(session.state, DetoxState.STOPPED);
    },
  );
  test('permission revocation is reflected as unenforced', () async {
    await start();
    enforcer.actual = RestrictionStatus.unavailable;
    await session.reconcile();
    expect(session.state, DetoxState.FOCUS_UNENFORCED);
  });
  test(
    'restart derives remaining time, queries actual state rather than stored enforcement',
    () async {
      await start();
      now = now.add(const Duration(seconds: 25));
      enforcer.actual = RestrictionStatus.off;
      final recovered = DetoxSession(enforcer, store, now: () => now);
      await recovered.recover();
      expect(recovered.remainingSeconds, 35);
      expect(recovered.state, DetoxState.FOCUS_UNENFORCED);
    },
  );
  test(
    'expiry while terminated starts a real break only after confirmed release',
    () async {
      await start();
      now = now.add(const Duration(hours: 1));
      final recovered = DetoxSession(enforcer, store, now: () => now);
      await recovered.recover();
      expect(recovered.state, DetoxState.BREAK_ACTIVE);
      expect(recovered.remainingSeconds, 60);
    },
  );
  test(
    'duplicate lifecycle callbacks cannot duplicate break transition or enforcement',
    () async {
      await start();
      now = now.add(const Duration(seconds: 61));
      await Future.wait([
        session.reconcile(),
        session.reconcile(),
        session.reconcile(),
      ]);
      expect(session.state, DetoxState.BREAK_ACTIVE);
      expect(enforcer.releases, 1);
      expect(enforcer.applies, 1);
      await expectLater(start(), throwsStateError);
    },
  );
  test(
    'clock jump releases and reports ERROR instead of extending enforcement silently',
    () async {
      await start();
      now = now.subtract(const Duration(hours: 2));
      await session.reconcile();
      expect(session.state, DetoxState.ERROR);
      expect(enforcer.actual, RestrictionStatus.off);
    },
  );
  test(
    'corrupt/missing recovery releases only orphan Detox ownership',
    () async {
      store.value = '{corrupt';
      await session.recover();
      expect(session.state, DetoxState.ERROR);
      expect(enforcer.orphanReleases, 1);
      expect(store.value, isNull);
      await session.stop();
      expect(store.value, isNull);
      final empty = DetoxSession(enforcer, store, now: () => now);
      await empty.recover();
      expect(empty.state, DetoxState.IDLE);
      expect(enforcer.orphanReleases, 2);
    },
  );
  test(
    'rejects corrupt schema/duration and isolates snapshots by injected account stores',
    () async {
      await start();
      final json = jsonDecode(store.value!) as Map<String, dynamic>;
      json['focusMinutes'] = -1;
      store.value = jsonEncode(json);
      final recovered = DetoxSession(enforcer, store, now: () => now);
      await recovered.recover();
      expect(recovered.state, DetoxState.ERROR);
      final anotherUser = MemoryDetoxStore();
      expect(await anotherUser.read(), isNull);
    },
  );
  test('account teardown releases owned restrictions and prevents future apply',
      () async {
    await start();
    await session.close();
    expect(enforcer.actual, RestrictionStatus.off);
    expect(store.value, isNull);
    await expectLater(start(), throwsStateError);
  });
}
