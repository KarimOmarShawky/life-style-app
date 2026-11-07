import 'package:lifestyle_mobile/features/digital_detox/detox_platform.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_platform.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/data/retired_wallet_cleanup.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_reminders.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    api: ref.watch(apiClientProvider),
    tokens: ref.watch(tokenStoreProvider),
  ),
);

// Injectable so cleanup ordering and failures can be tested independently.
final retiredDataCleanupProvider = Provider<Future<void> Function()>((ref) {
  return () async {
    if (!await RetiredWalletCleanup.run()) {
      throw StateError('Retired data cleanup incomplete');
    }
  };
});

// Production uses the shared service; tests can isolate async storage state.
final signOutAiServiceProvider = Provider<AiService>(
  (ref) => AiService.instance,
);

final authProvider = AsyncNotifierProvider<AuthController, AppUser?>(
  AuthController.new,
);

// A content-free UI invalidation signal; this is not an ownership credential.
final authTransitionSignalProvider = StateProvider<int>((ref) => 0);

class AuthController extends AsyncNotifier<AppUser?> {
  bool _signingOut = false;
  int _authGeneration = 0;
  int _sessionGeneration = 0;
  int _pendingAuthTransitions = 0;
  Future<void> _authTail = Future<void>.value();

  // One controller serializes session-changing operations. This is not a
  // cross-engine or native-receiver lock, and a stalled operation can delay
  // the next transition.
  Future<T> _serializeAuth<T>(Future<T> Function() action) {
    final result = _authTail.then((_) => action());
    _authTail =
        result.then<void>((_) {}, onError: (Object _, StackTrace __) {});
    return result;
  }

  // Profile work is invalidated as soon as an identity transition starts.
  // This is not a cross-engine or durable ownership boundary.
  String? get activeAccount {
    if (_signingOut || _pendingAuthTransitions > 0) return null;
    return state.asData?.value?.id;
  }

  int get sessionGeneration => _sessionGeneration;

  bool sessionIsCurrent(String account, int generation) =>
      generation == _sessionGeneration && activeAccount == account;

  void _beginSessionTransition() {
    _sessionGeneration++;
    _pendingAuthTransitions++;
    ref.read(authTransitionSignalProvider.notifier).state++;
  }

  @override
  Future<AppUser?> build() =>
      _serializeAuth(() => ref.read(authRepositoryProvider).restoreSession());

  Future<void> signIn({required String email, required String password}) =>
      _authenticate(
        () => ref
            .read(authRepositoryProvider)
            .login(email: email, password: password),
      );

  Future<void> register({
    required String email,
    required String password,
    required String displayName,
  }) =>
      _authenticate(
        () => ref.read(authRepositoryProvider).register(
            email: email, password: password, displayName: displayName),
      );

  Future<void> _authenticate(Future<AppUser> Function() operation) {
    final generation = _authGeneration;
    _beginSessionTransition();
    return _serializeAuth(() async {
      if (generation != _authGeneration) return;
      state = const AsyncLoading();
      final result = await AsyncValue.guard(operation);
      // A sign-out that started during the request owns the next transition.
      if (generation != _authGeneration) return;
      _signingOut = false;
      state = result;
    }).whenComplete(() {
      _pendingAuthTransitions--;
    });
  }

  Future<void> requestPasswordReset(String email) =>
      ref.read(authRepositoryProvider).requestPasswordReset(email);

  Future<void> resetPassword({
    required String email,
    required String code,
    required String newPassword,
  }) =>
      ref
          .read(authRepositoryProvider)
          .resetPassword(email: email, code: code, newPassword: newPassword);

  String _activeAccountForProfileWork() {
    final account = activeAccount;
    if (account == null) throw StateError('Authentication session changed');
    return account;
  }

  void _checkProfileWork(String account, int generation, [AppUser? user]) {
    if (!sessionIsCurrent(account, generation) ||
        (user != null && user.id != account)) {
      throw StateError('Authentication session changed');
    }
  }

  Future<void> updateCurrency(String newCurrency) async {
    final account = _activeAccountForProfileWork();
    final generation = _sessionGeneration;
    final updated = await ref.read(authRepositoryProvider).updateProfile(
          defaultCurrency: newCurrency,
        );
    _checkProfileWork(account, generation, updated);
    state = AsyncData(updated);
  }

  Future<Map<String, dynamic>> exportUserData(String currentPassword) =>
      ref.read(authRepositoryProvider).exportUserData(currentPassword);

  Future<void> scheduleAccountDeletion(String currentPassword) async {
    final account = _activeAccountForProfileWork();
    final generation = _sessionGeneration;
    final repo = ref.read(authRepositoryProvider);
    await repo.scheduleAccountDeletion(currentPassword);
    _checkProfileWork(account, generation);
    final refreshed = await repo.getProfile();
    _checkProfileWork(account, generation, refreshed);
    state = AsyncData(refreshed);
  }

  Future<void> cancelAccountDeletion() async {
    final account = _activeAccountForProfileWork();
    final generation = _sessionGeneration;
    final repo = ref.read(authRepositoryProvider);
    await repo.cancelAccountDeletion();
    _checkProfileWork(account, generation);
    final refreshed = await repo.getProfile();
    _checkProfileWork(account, generation, refreshed);
    state = AsyncData(refreshed);
  }

  Future<void> signOut() async {
    _signingOut = true;
    _authGeneration++;
    _sessionGeneration++;
    ref.read(authTransitionSignalProvider.notifier).state++;
    ref.read(authRepositoryProvider).invalidateSessionRetries();
    final account = state.asData?.value?.id;
    // Schedule cleanup without waiting for network logout.
    Object? cleanupError;
    StackTrace? cleanupStack;
    final cleanup = ref.read(retiredDataCleanupProvider)().then<void>((_) {},
        onError: (Object error, StackTrace stack) {
      cleanupError = error;
      cleanupStack = stack;
    });
    await _serializeAuth(() async {
      try {
        await ref.read(authRepositoryProvider).logout();
      } finally {
        // Revoke account-driven widget sync before clearing its native snapshot.
        state = const AsyncData(null);
        try {
          await MethodChannelFocusShieldPlatform().invoke('stopShield');
        } catch (_) {/* Native support is optional. */}
        try {
          await MethodChannelFocusShieldPlatform().invoke('updateHomeWidget', {
            'clarityScore': null,
            'level': 1,
            'xp': 0,
            'pendingTasksCount': 0,
            'topTaskTitle': '',
          });
        } catch (_) {/* Native support is optional. */}
        try {
          await SubscriptionReminders.clear();
        } catch (_) {
          /* Sign-out must still clear credentials if native cleanup fails. */
        }
        // Also clear account-specific focus data. The AI assistant keeps no
        // per-account key on the device (server proxy); only its failure
        // circuit breaker is reset for the next session.
        try {
          if (account != null) await SecureDetoxStore(account).clear();
        } finally {
          try {
            await cleanup;
            if (cleanupError != null) {
              Error.throwWithStackTrace(cleanupError!, cleanupStack!);
            }
          } finally {
            ref.read(signOutAiServiceProvider).resetFailureCount();
          }
        }
      }
    });
  }

  Future<void> retryRestore() {
    final generation = _authGeneration;
    _beginSessionTransition();
    return _serializeAuth(() async {
      if (generation != _authGeneration) return;
      state = const AsyncLoading();
      final result = await AsyncValue.guard(
        ref.read(authRepositoryProvider).restoreSession,
      );
      if (generation != _authGeneration) return;
      _signingOut = false;
      state = result;
    }).whenComplete(() {
      _pendingAuthTransitions--;
    });
  }
}
