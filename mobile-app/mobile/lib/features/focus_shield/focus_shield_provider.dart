import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'focus_shield_models.dart';
import 'focus_shield_platform.dart';

final focusAccountIdProvider = Provider<String>((ref) =>
    ref.watch(authProvider.select((value) => value.asData?.value?.id)) ??
    'guest');

final focusShieldPlatformProvider =
    Provider<FocusShieldPlatform>((ref) => MethodChannelFocusShieldPlatform());
final focusShieldProvider =
    AsyncNotifierProvider<FocusShieldController, FocusData>(
        FocusShieldController.new);

class FocusData {
  FocusData(
      {XpLedger? ledger,
      this.history = const [],
      this.badges = const {},
      this.enabled = false,
      Set<String>? blockedPackages,
      this.shield = const ShieldState(),
      this.inbox = const {},
      this.lastInterceptPackage,
      this.platformError})
      : ledger = ledger ?? XpLedger(),
        blockedPackages = blockedPackages ?? defaultBlockedPackages;
  final XpLedger ledger;
  final List<FocusSessionRecord> history;
  final Set<FocusBadge> badges;
  final bool enabled;
  final Set<String> blockedPackages;
  final ShieldState shield;
  final Map<String, FocusInboxMessage> inbox;
  final String? lastInterceptPackage;
  final String? platformError;

  FocusData copyWith(
          {XpLedger? ledger,
          List<FocusSessionRecord>? history,
          Set<FocusBadge>? badges,
          bool? enabled,
          Set<String>? blockedPackages,
          ShieldState? shield,
          Map<String, FocusInboxMessage>? inbox,
          String? lastInterceptPackage,
          String? platformError}) =>
      FocusData(
          ledger: ledger ?? this.ledger,
          history: history ?? this.history,
          badges: badges ?? this.badges,
          enabled: enabled ?? this.enabled,
          blockedPackages: blockedPackages ?? this.blockedPackages,
          shield: shield ?? this.shield,
          inbox: inbox ?? this.inbox,
          lastInterceptPackage:
              lastInterceptPackage ?? this.lastInterceptPackage,
          platformError: platformError);
}

class FocusShieldController extends AsyncNotifier<FocusData> {
  late SharedPreferences _prefs;
  late String _storageKey;
  Future<void> _queue = Future<void>.value();
  String? _timerId;
  String? _taskId;
  String? _backendSessionId;
  String? _morningDate;
  DateTime? _startedAt;
  int _plannedSeconds = 0;
  bool _startedWithShield = false;
  bool _shieldEndedEarly = false;
  int _manualBypasses = 0;
  Timer? _completion;

  @override
  Future<FocusData> build() async {
    final userId = ref.watch(focusAccountIdProvider);
    _storageKey = 'focus_suite.v1.$userId';
    _timerId = null;
    _taskId = null;
    _startedAt = null;
    _completion?.cancel();
    _prefs = await SharedPreferences.getInstance();
    var data = FocusData();
    final raw = _prefs.getString(_storageKey);
    if (raw != null) {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      data = FocusData(
        ledger: XpLedger((json['ledger'] as List<dynamic>)
            .map((e) => XpEvent.fromJson(e as Map<String, dynamic>))),
        history: (json['history'] as List<dynamic>)
            .map((e) => FocusSessionRecord.fromJson(e as Map<String, dynamic>))
            .toList(),
        badges: (json['badges'] as List<dynamic>)
            .map((e) => FocusBadge.values.byName(e as String))
            .toSet(),
        enabled: json['enabled'] as bool,
        blockedPackages:
            (json['blockedPackages'] as List<dynamic>).cast<String>().toSet(),
      );
      final pending = json['pending'];
      if (pending is Map<String, dynamic>) {
        _timerId = pending['id'] as String;
        _taskId = pending['taskId'] as String?;
        _backendSessionId = pending['backendSessionId'] as String?;
        _morningDate = pending['morningDate'] as String?;
        _startedAt = DateTime.parse(pending['startedAt'] as String);
        _plannedSeconds = pending['seconds'] as int;
        _startedWithShield = pending['shield'] as bool;
        _shieldEndedEarly = pending['endedEarly'] as bool;
        _manualBypasses = pending['bypasses'] as int;
      }
    }
    try {
      data = data.copyWith(
          shield: await ref.read(focusShieldPlatformProvider).getShieldState());
    } catch (_) {
      /* Other productivity features work without Android services. */
    }
    final buffered = <Map<String, dynamic>>[];
    var ready = false;
    final subscription =
        ref.read(focusShieldPlatformProvider).events.listen((event) {
      if (ready) {
        _onEvent(event);
      } else {
        if (buffered.length == 100) {
          buffered.removeAt(0);
        }
        buffered.add(event);
      }
    }, onError: (Object _) {
      /* Native support is optional; explicit actions show failures. */
    });
    final timer = Timer(Duration.zero, () {
      ready = true;
      for (final event in buffered) {
        _onEvent(event);
      }
      buffered.clear();
    });
    ref.onDispose(() {
      timer.cancel();
      subscription.cancel();
      _completion?.cancel();
    });
    return data;
  }

  Future<void> _mutate(Future<void> Function() operation) {
    final result = _queue.then((_) async {
      await future;
      await operation();
    });
    _queue = result.catchError((Object _) {});
    return result;
  }

  Future<void> _save(FocusData data, {bool persistPending = true}) async {
    final before = state.asData?.value;
    final storageKey = _storageKey;
    // Allowlisted persistence only. Never notification content, sender or draft.
    final saved = await _prefs.setString(
        _storageKey,
        jsonEncode({
          'ledger': data.ledger.events.values.map((e) => e.toJson()).toList(),
          'history': data.history.map((e) => e.toJson()).toList(),
          'badges': data.badges.map((e) => e.name).toList(),
          'enabled': data.enabled,
          'blockedPackages': data.blockedPackages.toList(),
          if (persistPending && _timerId != null)
            'pending': {
              'id': _timerId,
              'taskId': _taskId,
              'backendSessionId': _backendSessionId,
              'morningDate': _morningDate,
              'startedAt': _startedAt!.toIso8601String(),
              'seconds': _plannedSeconds,
              'shield': _startedWithShield,
              'endedEarly': _shieldEndedEarly,
              'bypasses': _manualBypasses,
            },
        }));
    if (!saved) {
      throw StateError('Could not save productivity data.');
    }
    if (_storageKey != storageKey) return;
    final after = state.asData?.value;
    // Disk I/O must not overwrite an intercept, a new Inbox message or a native
    // stop that arrived while an unrelated XP/settings write was in flight.
    if (before != null &&
        after != null &&
        identical(data.shield, before.shield)) {
      data = data.copyWith(
          shield: after.shield,
          inbox: identical(data.inbox, before.inbox) ? after.inbox : data.inbox,
          lastInterceptPackage: after.lastInterceptPackage);
    }
    state = AsyncData(data);
  }

  Future<void> award(XpType type, String entityId, {String? dateKey}) =>
      _mutate(() async {
        final data = state.requireValue;
        final ledger = data.ledger.award(XpEvent(
            type: type,
            entityId: entityId,
            dateKey: dateKey ?? localDateKey(DateTime.now()),
            xp: xpFor(type)));
        await _save(data.copyWith(
            ledger: ledger,
            badges: {...data.badges, ...earnedBadges(ledger, data.history)}));
      });
  Future<void> taskCompleted(String taskId) async {
    await award(XpType.task, taskId);
    if (_taskId == taskId) {
      await finishTimer(completed: false);
    }
  }

  Future<void> setEnabled(bool enabled) => _mutate(() async {
        if (!enabled) {
          await _stopNative();
          _shieldEndedEarly = true;
        }
        await _save(state.requireValue.copyWith(
            enabled: enabled,
            shield: enabled ? null : const ShieldState(),
            inbox: enabled ? null : const {}));
      });
  Future<void> setBlocked(String packageName, bool blocked) =>
      _mutate(() async {
        if (!RegExp(r'^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$')
            .hasMatch(packageName)) {
          throw const FormatException('Enter a valid Android package name.');
        }
        final data = state.requireValue;
        if (data.shield.active) {
          throw StateError('End the shield before editing the blocked list.');
        }
        final packages = {...data.blockedPackages};
        if (blocked) {
          packages.add(packageName);
        } else {
          packages.remove(packageName);
        }
        await _save(data.copyWith(blockedPackages: packages));
      });
  Future<void> beginTimer(
          {required String id,
          required String taskTitle,
          required int seconds,
          String? taskId,
          String? morningDate}) =>
      _mutate(() async {
        if (_timerId != null) {
          await _finish(completed: false);
        }
        _timerId = id;
        _backendSessionId = null;
        _taskId = taskId;
        _morningDate = morningDate;
        _startedAt = DateTime.now();
        _plannedSeconds = seconds;
        _manualBypasses = 0;
        _startedWithShield = false;
        _shieldEndedEarly = false;
        final data = state.requireValue;
        await _save(data);
        if (data.enabled) {
          try {
            final platform = ref.read(focusShieldPlatformProvider);
            final permissions = await platform.invoke('getPermissionStatus');
            if (permissions['accessibility'] != true) {
              throw StateError('Accessibility access is off.');
            }
            final result = await platform.invoke('startShield', {
              'sessionId': id,
              'taskTitle': taskTitle,
              'endTimestampMs':
                  _startedAt!.millisecondsSinceEpoch + seconds * 1000,
              'blockedPackages': data.blockedPackages.toList(),
            });
            final shield = ShieldState.fromJson(result);
            _startedWithShield = shield.active;
            await _save(state.requireValue.copyWith(shield: shield));
          } catch (_) {
            state = AsyncData(data.copyWith(
                platformError:
                    'Shield could not start. The focus timer still works. Check permissions.'));
          }
        }
        _armCompletion(seconds);
      });
  Future<void> attachBackendSession(String localId, String backendId) =>
      _mutate(() async {
        final data = state.requireValue;
        if (_timerId == localId) {
          _backendSessionId = backendId;
        }
        await _save(data.copyWith(history: [
          for (final session in data.history)
            session.id == localId ? session.withBackendId(backendId) : session
        ]));
      });

  void _armCompletion(int seconds) {
    _completion?.cancel();
    _completion = Timer(Duration(seconds: seconds < 0 ? 0 : seconds), () {
      finishTimer(completed: true)
          .catchError((Object _) {/* Pending record is retained for retry. */});
    });
  }

  Future<void> finishTimer({required bool completed}) =>
      _mutate(() => _finish(completed: completed));
  Future<void> _finish({required bool completed}) async {
    final id = _timerId;
    final started = _startedAt;
    if (id == null || started == null) return;
    final native = _startedWithShield
        ? await _stopNative(reason: completed ? 'completed' : 'cancelled')
        : const ShieldState();
    if (_startedWithShield && native.sessionId == id) {
      _manualBypasses = native.manualBypassesCount;
      if (native.endReason != 'expired' && native.endReason != 'completed') {
        _shieldEndedEarly = true;
      }
    }
    final data = state.requireValue;
    final shieldCompleted =
        _startedWithShield && !_shieldEndedEarly && completed;
    final record = FocusSessionRecord(
        id: id,
        endedAt: completed
            ? started.add(Duration(seconds: _plannedSeconds))
            : DateTime.now(),
        durationSeconds: completed
            ? _plannedSeconds
            : DateTime.now().difference(started).inSeconds,
        attempts: native.blockedAttemptsCount,
        backendSessionId: _backendSessionId,
        shieldCompleted: shieldCompleted,
        manualBypasses: _manualBypasses,
        completed: completed,
        clarityScore: calculateBrainClarityScore(native.blockedAttemptsCount));
    final history = data.history.any((s) => s.id == id)
        ? data.history
        : [...data.history, record];
    var ledger = completed
        ? data.ledger.award(XpEvent(
            type: XpType.focus,
            entityId: id,
            dateKey: localDateKey(record.endedAt),
            xp: xpFor(XpType.focus,
                shieldCompleted: shieldCompleted,
                manualBypasses: _manualBypasses)))
        : data.ledger;
    if (completed && shieldCompleted && _morningDate != null) {
      ledger = ledger.award(XpEvent(
          type: XpType.morning,
          entityId: 'morning',
          dateKey: _morningDate!,
          xp: 30));
    }
    await _save(
        data.copyWith(
            ledger: ledger,
            history: history,
            badges: {...data.badges, ...earnedBadges(ledger, history)},
            shield: const ShieldState(),
            inbox: const {}),
        persistPending: false);
    _completion?.cancel();
    _timerId = null;
    _startedAt = null;
    _taskId = null;
  }

  Future<ShieldState> _stopNative({String reason = 'manual'}) async {
    try {
      return ShieldState.fromJson(await ref
          .read(focusShieldPlatformProvider)
          .invoke('stopShield', {'reason': reason}));
    } catch (_) {
      if (_startedWithShield || (state.asData?.value.shield.active ?? false)) {
        rethrow;
      }
      return const ShieldState();
    }
  }

  Future<void> endShieldNow() async {
    // Do not queue the safety exit behind disk I/O or a pending award.
    final native =
        await ref.read(focusShieldPlatformProvider).invoke('stopShield');
    _shieldEndedEarly = true;
    await _mutate(() => _save(state.requireValue
        .copyWith(shield: ShieldState.fromJson(native), inbox: const {})));
  }

  Future<void> refreshNative() => _mutate(() async {
        try {
          final native =
              await ref.read(focusShieldPlatformProvider).getShieldState();
          if (_timerId != null && native.sessionId == _timerId) {
            _startedWithShield = true;
            _manualBypasses = native.manualBypassesCount;
            if (!native.active &&
                native.endReason != 'expired' &&
                native.endReason != 'completed') {
              _shieldEndedEarly = true;
            }
          }
          final data = state.requireValue;
          state = AsyncData(data.copyWith(
              shield: native, inbox: native.active ? data.inbox : const {}));
        } catch (_) {
          state = AsyncData(state.requireValue
              .copyWith(platformError: 'Native Focus Shield is unavailable.'));
        }
        if (_timerId != null && _startedAt != null) {
          final seconds = _startedAt!
              .add(Duration(seconds: _plannedSeconds))
              .difference(DateTime.now())
              .inSeconds;
          if (seconds <= 0) {
            await _finish(completed: true);
          } else {
            _armCompletion(seconds);
          }
        }
      });
  Future<ReplyResult> reply(String key, String text) async {
    await future;
    ReplyResult result;
    try {
      result = await ref.read(focusShieldPlatformProvider).sendReply(key, text);
    } catch (_) {
      result = ReplyResult.failed;
    }
    if (result == ReplyResult.sent) {
      await _mutate(() => _save(state.requireValue.copyWith(badges: {
            ...state.requireValue.badges,
            FocusBadge.inboxZeroDistraction
          })));
    }
    return result;
  }

  Future<void> grantTemporaryBypass(String packageName) => _mutate(() async {
        final result = await ref
            .read(focusShieldPlatformProvider)
            .invoke('grantTemporaryBypass', {'packageName': packageName});
        _manualBypasses =
            result['manualBypassesCount'] as int? ?? (_manualBypasses + 1);
        await _save(state.requireValue);
      });
  void _onEvent(Map<String, dynamic> event) {
    final data = state.asData?.value;
    if (data == null) return;
    if (event['sessionId'] != null &&
        data.shield.sessionId.isNotEmpty &&
        event['sessionId'] != data.shield.sessionId) {
      return;
    }
    if (event['type'] == 'intercept') {
      state = AsyncData(data.copyWith(
          lastInterceptPackage: event['packageName'] as String,
          shield: ShieldState.fromJson(event)));
    } else if (event['type'] == 'inbox') {
      if (event['sessionId'] != data.shield.sessionId || !data.shield.active) {
        return;
      }
      final key = event['key'] as String;
      final inbox = {...data.inbox}..remove(key);
      inbox[key] = FocusInboxMessage(
          key: key,
          packageName: event['packageName'] as String,
          sender: event['sender'] as String? ?? '',
          text: event['text'] as String? ?? '');
      while (inbox.length > 100) {
        inbox.remove(inbox.keys.first);
      }
      state = AsyncData(data.copyWith(inbox: inbox));
    } else if (event['type'] == 'removed') {
      state = AsyncData(
          data.copyWith(inbox: {...data.inbox}..remove(event['key'])));
    } else if (event['type'] == 'stopped') {
      if (event['reason'] != 'expired' && event['reason'] != 'completed') {
        _shieldEndedEarly = true;
      }
      state = AsyncData(
          data.copyWith(shield: ShieldState.fromJson(event), inbox: const {}));
    }
  }
}
