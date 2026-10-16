import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../auth/state/auth_provider.dart';
import '../focus_shield/focus_shield_platform.dart';
import 'detox_platform.dart';
import 'detox_session.dart';

final detoxProvider = ChangeNotifierProvider<DetoxController>((ref) {
  final account = ref.watch(
    authProvider.select((value) => value.asData?.value?.id),
  );
  final controller = DetoxController(account);
  return controller;
});

class DetoxController extends ChangeNotifier with WidgetsBindingObserver {
  DetoxController(String? account) {
    if (account == null) return;
    session = DetoxSession(enforcer, SecureDetoxStore(account));
    WidgetsBinding.instance.addObserver(this);
    unawaited(run(() => session!.recover()));
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!busy && (session?.running ?? false)) {
        // Only reconcile/persist every five seconds; UI countdown is derived.
        if (++_ticks % 5 == 0) {
          unawaited(run(() => session!.reconcile()));
        } else {
          notifyListeners();
        }
      }
    });
  }
  final enforcer = AndroidDetoxEnforcer(MethodChannelFocusShieldPlatform());
  DetoxSession? session;
  Timer? _ticker;
  int _ticks = 0;
  bool busy = false;
  String? operationError;
  bool _disposed = false;
  Future<void> run(Future<void> Function() operation) async {
    if (busy || _disposed) return;
    busy = true;
    operationError = null;
    notifyListeners();
    try {
      await operation();
    } catch (_) {
      operationError =
          'Action could not be confirmed. Check storage and Android permissions. Retry Stop if a restriction may still be active.';
    } finally {
      busy = false;
      if (!_disposed) notifyListeners();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && session != null) {
      unawaited(run(() => session!.reconcile()));
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _ticker?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    // App-level provider survives navigation. Account/provider teardown drains owned work.
    final current = session;
    if (current != null) {
      unawaited(current.close().catchError((Object _) {
        FlutterError.reportError(FlutterErrorDetails(
            exception: StateError(
                'Digital Detox account cleanup unconfirmed. Native expiry is the safety fallback.')));
      }));
    }
    super.dispose();
  }
}
