import 'dart:async';
import 'dart:convert';
import 'dart:math';

// Wire names intentionally match the product state machine.
// ignore_for_file: constant_identifier_names

enum DetoxState {
  IDLE,
  PREPARING,
  FOCUS_PENDING,
  FOCUS_ACTIVE,
  FOCUS_PARTIAL,
  FOCUS_UNENFORCED,
  BREAK_ACTIVE,
  PAUSED,
  COMPLETED,
  STOPPED,
  ERROR,
}

enum DetoxMode { strictFocus, selectedApps }

enum RestrictionStatus { off, full, partial, unavailable }

class RestrictionResult {
  const RestrictionResult(this.status, this.detail);
  final RestrictionStatus status;
  final String detail;
}

abstract class DetoxEnforcer {
  Future<RestrictionResult> apply(
    String id,
    DetoxMode mode,
    Set<String> packages,
    DateTime end,
  );
  Future<RestrictionResult> query(String id);
  Future<RestrictionResult> release(String id);

  /// Release only orphaned Detox owners, never an unrelated Focus Shield owner.
  Future<void> releaseOrphan();
}

abstract class DetoxStore {
  Future<String?> read();
  Future<void> write(String snapshot);
  Future<void> clear();
}

const focusStates = {
  DetoxState.FOCUS_ACTIVE,
  DetoxState.FOCUS_PARTIAL,
  DetoxState.FOCUS_UNENFORCED,
};
final detoxTransitions = <DetoxState, Set<DetoxState>>{
  DetoxState.IDLE: {DetoxState.PREPARING, DetoxState.ERROR},
  DetoxState.PREPARING: {
    DetoxState.FOCUS_PENDING,
    DetoxState.ERROR,
    DetoxState.STOPPED,
  },
  DetoxState.FOCUS_PENDING: {
    ...focusStates,
    DetoxState.ERROR,
    DetoxState.STOPPED,
  },
  for (final state in focusStates)
    state: {
      ...focusStates,
      DetoxState.BREAK_ACTIVE,
      DetoxState.PAUSED,
      DetoxState.STOPPED,
      DetoxState.ERROR,
    },
  DetoxState.BREAK_ACTIVE: {
    DetoxState.PREPARING,
    DetoxState.PAUSED,
    DetoxState.COMPLETED,
    DetoxState.STOPPED,
    DetoxState.ERROR,
  },
  DetoxState.PAUSED: {
    DetoxState.FOCUS_PENDING,
    DetoxState.BREAK_ACTIVE,
    DetoxState.STOPPED,
    DetoxState.ERROR,
  },
  DetoxState.COMPLETED: {DetoxState.PREPARING, DetoxState.ERROR},
  DetoxState.STOPPED: {DetoxState.PREPARING, DetoxState.ERROR},
  DetoxState.ERROR: {DetoxState.STOPPED, DetoxState.ERROR},
};

void validateDetoxTransition(DetoxState from, DetoxState to) {
  if (!(detoxTransitions[from]?.contains(to) ?? false)) {
    throw StateError(
      'Invalid Digital Detox transition: ${from.name} -> ${to.name}',
    );
  }
}

void validateDetoxDurations(int focus, int rest) {
  if (focus < 1 || focus > 180 || rest < 1 || rest > 60) {
    throw ArgumentError(
      'Focus must be 1–180 minutes; break must be 1–60 minutes.',
    );
  }
}

/// Domain engine: serial operations, timestamp truth, injected persistence and enforcement.
class DetoxSession {
  DetoxSession(this.enforcer, this.store, {DateTime Function()? now})
      : now = now ?? DateTime.now;
  final DetoxEnforcer enforcer;
  final DetoxStore store;
  final DateTime Function() now;
  DetoxState state = DetoxState.IDLE;
  DetoxMode mode = DetoxMode.strictFocus;
  RestrictionResult restriction = const RestrictionResult(
    RestrictionStatus.off,
    'No restriction',
  );
  int focusMinutes = 45;
  int breakMinutes = 15;
  String id = '';
  Set<String> packages = {};
  String phase = 'focus';
  DateTime? startedAt;
  DateTime? endAt;
  DateTime? lastTransition;
  int pausedSeconds = 0;
  bool allowUnenforced = false;
  String? error;
  Future<void> _tail = Future.value();
  bool _closed = false;
  final Stopwatch _monotonic = Stopwatch()..start();
  DateTime? _lastWall;
  int _lastMono = 0;

  bool get running =>
      focusStates.contains(state) || state == DetoxState.BREAK_ACTIVE;
  int get remainingSeconds {
    if (state == DetoxState.PAUSED) return pausedSeconds;
    if (!running || endAt == null) return 0;
    return endAt!.difference(now()).inSeconds.clamp(0, 180 * 60);
  }

  Future<void> _serial(Future<void> Function() action) {
    final next = _tail.then((_) => action());
    _tail = next.catchError((Object _) {}); // caller still receives the failure
    return next;
  }

  Future<void> _move(DetoxState next) async {
    validateDetoxTransition(state, next);
    state = next;
    lastTransition = now().toUtc();
    await _save();
  }

  Future<void> _save() => store.write(
        jsonEncode({
          'version': 1,
          'id': id,
          'state': state.name,
          'mode': mode.name,
          'focusMinutes': focusMinutes,
          'breakMinutes': breakMinutes,
          'packages': packages.toList(),
          'phase': phase,
          'startedAt': startedAt?.toIso8601String(),
          'endAt': endAt?.toIso8601String(),
          'lastTransition': lastTransition?.toIso8601String(),
          'pausedSeconds': pausedSeconds,
          'allowUnenforced': allowUnenforced,
          'restriction': restriction.status.name,
          'detail': restriction.detail,
          'error': error,
        }),
      );

  Future<void> start({
    required DetoxMode selectedMode,
    int focus = 45,
    int rest = 15,
    Set<String> selectedPackages = const {},
    bool timerOnlyAllowed = false,
  }) =>
      _serial(() async {
        if (_closed) throw StateError('Account session closed.');
        validateDetoxDurations(focus, rest);
        if (![
          DetoxState.IDLE,
          DetoxState.COMPLETED,
          DetoxState.STOPPED,
        ].contains(state)) {
          throw StateError('Stop the current session first.');
        }
        if (selectedMode == DetoxMode.selectedApps &&
            selectedPackages.isEmpty) {
          throw ArgumentError('Choose at least one application.');
        }
        mode = selectedMode;
        focusMinutes = focus;
        breakMinutes = rest;
        packages = Set.of(selectedPackages);
        allowUnenforced = timerOnlyAllowed;
        id =
            'detox:${now().microsecondsSinceEpoch}:${Random.secure().nextInt(1 << 32)}';
        startedAt = now().toUtc();
        phase = 'focus';
        error = null;
        await _move(DetoxState.PREPARING);
        await _beginFocus(focusMinutes * 60);
      });

  Future<void> _beginFocus(int seconds) async {
    if (_closed) return;
    endAt = now().toUtc().add(Duration(seconds: seconds));
    await _move(DetoxState.FOCUS_PENDING);
    try {
      restriction = await enforcer.apply(id, mode, packages, endAt!);
      if (_closed) {
        await _release();
        return;
      }
      if (restriction.status == RestrictionStatus.off ||
          restriction.status == RestrictionStatus.unavailable) {
        if (!allowUnenforced) {
          throw StateError(
            'Restrictions unavailable. Stop and explicitly choose an unenforced timer if desired.',
          );
        }
      }
      await _move(_focusState(restriction));
      _anchorClock();
    } catch (_) {
      if (allowUnenforced && await _release()) {
        restriction = const RestrictionResult(RestrictionStatus.unavailable,
            'Requested restrictions unavailable. You explicitly allowed an unenforced timer.');
        await _move(DetoxState.FOCUS_UNENFORCED);
        _anchorClock();
      } else if (state != DetoxState.ERROR) {
        await _fail(
            'Focus restriction was not confirmed. Check authorization or stop and retry.');
      }
    }
  }

  DetoxState _focusState(RestrictionResult result) => switch (result.status) {
        RestrictionStatus.full => DetoxState.FOCUS_ACTIVE,
        RestrictionStatus.partial => DetoxState.FOCUS_PARTIAL,
        _ => DetoxState.FOCUS_UNENFORCED,
      };

  Future<void> _fail(String message) async {
    error = message;
    await _move(DetoxState.ERROR);
  }

  Future<bool> _release() async {
    try {
      final result = await enforcer.release(id);
      restriction = result;
      if (result.status != RestrictionStatus.off) {
        throw StateError('Release unconfirmed');
      }
      return true;
    } catch (_) {
      await _fail(
        'Release not confirmed. Retry Stop, or disable LifeStyle accessibility in Android Settings.',
      );
      return false;
    }
  }

  void _anchorClock() {
    _lastWall = now();
    _lastMono = _monotonic.elapsedMilliseconds;
  }

  Future<void> reconcile() => _serial(_reconcile);
  Future<void> _reconcile() async {
    if (!running) return;
    if (_lastWall != null &&
        (now().difference(_lastWall!).inMilliseconds -
                    (_monotonic.elapsedMilliseconds - _lastMono))
                .abs() >
            120000) {
      if (await _release()) {
        await _fail(
          'Device time changed. Restrictions released; stop and start a new session.',
        );
      }
      return;
    }
    _anchorClock();
    if (phase == 'focus') {
      try {
        restriction = await enforcer.query(id);
        final actual = _focusState(restriction);
        if (actual != state) await _move(actual);
      } catch (_) {
        restriction = const RestrictionResult(
          RestrictionStatus.unavailable,
          'Cannot verify platform restriction',
        );
        if (state != DetoxState.FOCUS_UNENFORCED) {
          await _move(DetoxState.FOCUS_UNENFORCED);
        }
      }
    }
    if (endAt != null && !now().isBefore(endAt!)) {
      if (phase == 'focus') {
        if (!await _release()) return;
        phase = 'break';
        // Start the break only now, when release has actually been confirmed.
        endAt = now().toUtc().add(Duration(minutes: breakMinutes));
        await _move(DetoxState.BREAK_ACTIVE);
      } else {
        await _move(DetoxState.COMPLETED);
      }
    } else {
      await _save();
    }
  }

  Future<void> pause() => _serial(() async {
        await _reconcile();
        if (!running) throw StateError('No running session to pause.');
        final remaining = remainingSeconds;
        if (!await _release()) return;
        pausedSeconds = remaining;
        await _move(DetoxState.PAUSED);
      });

  Future<void> resume() => _serial(() async {
        if (state != DetoxState.PAUSED) {
          throw StateError('Session is not paused.');
        }
        if (phase == 'focus') {
          await _beginFocus(pausedSeconds);
        } else {
          if (!await _release()) return;
          endAt = now().toUtc().add(Duration(seconds: pausedSeconds));
          await _move(DetoxState.BREAK_ACTIVE);
        }
        _anchorClock();
      });

  Future<void> stop() => _serial(() async {
        if ([
          DetoxState.IDLE,
          DetoxState.STOPPED,
          DetoxState.COMPLETED,
        ].contains(state)) {
          return;
        }
        if (await _release()) {
          await _move(DetoxState.STOPPED);
          if (id.isEmpty) await store.clear();
        }
      });

  Future<void> continueCycle() => _serial(() async {
        if (![DetoxState.BREAK_ACTIVE, DetoxState.COMPLETED].contains(state)) {
          throw StateError('Continue is only available after focus.');
        }
        if (state == DetoxState.BREAK_ACTIVE && remainingSeconds > 0) {
          throw StateError('Wait for the break to finish.');
        }
        phase = 'focus';
        await _move(DetoxState.PREPARING);
        await _beginFocus(focusMinutes * 60);
      });

  /// Account/container shutdown cancels future application before draining pending work.
  Future<void> close() {
    _closed = true;
    return _serial(() async {
      if (id.isEmpty || await _release()) await store.clear();
    });
  }

  Future<void> recover() => _serial(() async {
        if (_closed) return;
        try {
          final encoded = await store.read();
          if (_closed) return;
          if (encoded == null) {
            await enforcer.releaseOrphan();
            return;
          }
          final json = jsonDecode(encoded) as Map<String, dynamic>;
          if (json['version'] != 1) {
            throw const FormatException('Unknown schema');
          }
          final recoveredState =
              DetoxState.values.byName(json['state'] as String);
          final focus = json['focusMinutes'] as int;
          final rest = json['breakMinutes'] as int;
          validateDetoxDurations(focus, rest);
          final owner = json['id'] as String;
          if (!owner.startsWith('detox:')) {
            throw const FormatException('Invalid owner');
          }
          final selected = (json['packages'] as List).cast<String>().toSet();
          if (selected.length > 1000 ||
              selected.any(
                (p) => !RegExp(r'^[a-zA-Z][\w]*(\.[\w]+)+$').hasMatch(p),
              )) {
            throw const FormatException('Invalid selection');
          }
          final savedPhase = json['phase'] as String;
          if (!['focus', 'break'].contains(savedPhase)) {
            throw const FormatException('Invalid phase');
          }
          final pause = json['pausedSeconds'] as int;
          if (pause < 0 || pause > 10800) {
            throw const FormatException('Invalid pause');
          }
          id = owner;
          state = recoveredState;
          focusMinutes = focus;
          breakMinutes = rest;
          mode = DetoxMode.values.byName(json['mode'] as String);
          packages = selected;
          phase = savedPhase;
          pausedSeconds = pause;
          allowUnenforced = json['allowUnenforced'] as bool;
          startedAt = DateTime.parse(json['startedAt'] as String);
          endAt = DateTime.parse(json['endAt'] as String);
          lastTransition = DateTime.parse(json['lastTransition'] as String);
          restriction = const RestrictionResult(
            RestrictionStatus.unavailable,
            'Rechecking native state',
          );
          error = json['error'] as String?;
          if (endAt!.isAfter(now().add(const Duration(hours: 4))) ||
              lastTransition!.isAfter(now().add(const Duration(minutes: 2)))) {
            if (await _release()) {
              await _fail(
                'Clock or stored deadline inconsistent. Stop and start again.',
              );
            }
          } else if ([
            DetoxState.PREPARING,
            DetoxState.FOCUS_PENDING,
          ].contains(state)) {
            if (await _release()) {
              await _fail(
                'Session interrupted while preparing. Stop and start again.',
              );
            }
          } else if (running) {
            // Never infer native restriction from the stored enum.
            if (phase == 'break' && !await _release()) return;
            await _reconcile();
          } else {
            await _release();
          }
          _anchorClock();
        } catch (_) {
          if (_closed) return;
          await enforcer.releaseOrphan();
          state = DetoxState.ERROR;
          error =
              'Session data could not be restored. Owned restrictions released; Stop to reset.';
          restriction = const RestrictionResult(
            RestrictionStatus.off,
            'Recovered without restoring a timer',
          );
          await store.clear();
        }
      });
}
