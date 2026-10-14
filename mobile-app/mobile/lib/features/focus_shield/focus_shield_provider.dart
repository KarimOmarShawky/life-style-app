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
  StreamSubscription<Map<String, dynamic>>? _subscription;
  Future<void> _queue = Future<void>.value();
  String? _timerId;
  DateTime? _startedAt;
  int _plannedSeconds = 0;
  int _manualBypasses = 0;
  bool _startedWithShield = false;
  bool _shieldEndedEarly = false;

  @override
  Future<FocusData> build() async {
    final userId = ref.watch(focusAccountIdProvider);
    _storageKey = 'focus_suite.v1.$userId';
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
    }
    await _subscription?.cancel();
    _subscription = ref
        .read(focusShieldPlatformProvider)
        .events
        .listen(_onEvent, onError: (Object error) {
      final current = state.asData?.value;
      if (current != null) {
        state = AsyncData(current.copyWith(
            platformError: 'Focus Shield is unavailable on this device.'));
      }
    });
    final subscription = _subscription;
    ref.onDispose(() {
      subscription?.cancel();
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

  Future<void> _save(FocusData data) async {
    // Explicit whitelist: no notification content, sender, RemoteInput or draft.
    final saved = await _prefs.setString(
        _storageKey,
        jsonEncode({
          'ledger': data.ledger.events.values.map((e) => e.toJson()).toList(),
          'history': data.history.map((e) => e.toJson()).toList(),
          'badges': data.badges.map((e) => e.name).toList(),
          'enabled': data.enabled,
          'blockedPackages': data.blockedPackages.toList(),
        }));
    if (!saved) throw StateError('Could not save productivity data.');
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
          required int seconds}) =>
      _mutate(() async {
        _timerId = id;
        _startedAt = DateTime.now();
        _plannedSeconds = seconds;
        _manualBypasses = 0;
        _startedWithShield = false;
        _shieldEndedEarly = false;
        final data = state.requireValue;
        if (!data.enabled) return;
        try {
          final platform = ref.read(focusShieldPlatformProvider);
          final permissions = await platform.invoke('getPermissionStatus');
          if (permissions['accessibility'] != true) {
            throw StateError(
                'Enable LifeStyle accessibility in Android settings first.');
          }
          final result = await platform.invoke('startShield', {
            'sessionId': id,
            'taskTitle': taskTitle,
            'endTimestampMs':
                DateTime.now().millisecondsSinceEpoch + seconds * 1000,
            'blockedPackages': data.blockedPackages.toList(),
          });
          final shield = ShieldState.fromJson(result);
          _startedWithShield = shield.active;
          state = AsyncData(data.copyWith(shield: shield));
        } catch (_) {
          state = AsyncData(data.copyWith(
              platformError:
                  'Shield could not start. The focus timer still works. Check permissions.'));
        }
      });

  Future<void> finishTimer({required bool completed}) => _mutate(() async {
        final id = _timerId;
        final started = _startedAt;
        if (id == null || started == null) return;
        final data = state.requireValue;
        // Read native's final attempts once; Flutter does not increment this count.
        final native = _startedWithShield
            ? await _stopNative(reason: completed ? 'completed' : 'cancelled')
            : const ShieldState();
        final shieldCompleted =
            _startedWithShield && !_shieldEndedEarly && completed;
        final record = FocusSessionRecord(
            id: id,
            endedAt: DateTime.now(),
            durationSeconds: completed
                ? _plannedSeconds
                : DateTime.now().difference(started).inSeconds,
            attempts: native.blockedAttemptsCount,
            shieldCompleted: shieldCompleted,
            manualBypasses: _manualBypasses,
            completed: completed,
            clarityScore:
                calculateBrainClarityScore(native.blockedAttemptsCount));
        final history = data.history.any((s) => s.id == id)
            ? data.history
            : [...data.history, record];
        final ledger = completed
            ? data.ledger.award(XpEvent(
                type: XpType.focus,
                entityId: id,
                dateKey: localDateKey(record.endedAt),
                xp: xpFor(XpType.focus,
                    shieldCompleted: shieldCompleted,
                    manualBypasses: _manualBypasses)))
            : data.ledger;
        await _save(data.copyWith(
            ledger: ledger,
            history: history,
            badges: {...data.badges, ...earnedBadges(ledger, history)},
            shield: const ShieldState(),
            inbox: const {}));
        _timerId = null;
        _startedAt = null;
      });

  Future<ShieldState> _stopNative({String reason = 'manual'}) async {
    try {
      return ShieldState.fromJson(await ref
          .read(focusShieldPlatformProvider)
          .invoke('stopShield', {'reason': reason}));
    } catch (_) {
      if (state.asData?.value.shield.active ?? false) rethrow;
      return const ShieldState();
    }
  }

  Future<void> endShieldNow() => _mutate(() async {
        final native = await _stopNative();
        _manualBypasses++;
        _shieldEndedEarly = true;
        state = AsyncData(
            state.requireValue.copyWith(shield: native, inbox: const {}));
      });

  Future<void> refreshNative() => _mutate(() async {
        try {
          final native =
              await ref.read(focusShieldPlatformProvider).getShieldState();
          final data = state.requireValue;
          if (data.shield.active &&
              !native.active &&
              DateTime.now().millisecondsSinceEpoch <
                  data.shield.endTimestampMs) {
            _manualBypasses++;
            _shieldEndedEarly = true;
          }
          state = AsyncData(data.copyWith(
              shield: native, inbox: native.active ? data.inbox : const {}));
        } catch (_) {
          state = AsyncData(state.requireValue
              .copyWith(platformError: 'Native Focus Shield is unavailable.'));
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
        await ref
            .read(focusShieldPlatformProvider)
            .invoke('grantTemporaryBypass', {'packageName': packageName});
        _manualBypasses++;
      });

  void _onEvent(Map<String, dynamic> event) {
    final data = state.asData?.value;
    if (data == null) return;
    if (event['type'] == 'intercept') {
      state = AsyncData(data.copyWith(
          lastInterceptPackage: event['packageName'] as String,
          shield: ShieldState.fromJson(event)));
    } else if (event['type'] == 'inbox' && data.shield.active) {
      final key = event['key'] as String;
      final inbox = {...data.inbox};
      inbox.remove(key);
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
      final inbox = {...data.inbox}..remove(event['key']);
      state = AsyncData(data.copyWith(inbox: inbox));
    } else if (event['type'] == 'stopped') {
      if (event['reason'] != 'expired' && event['reason'] != 'completed') {
        _manualBypasses++;
        _shieldEndedEarly = true;
      }
      state = AsyncData(
          data.copyWith(shield: ShieldState.fromJson(event), inbox: const {}));
    }
  }
}
