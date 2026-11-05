import 'package:lifestyle_mobile/features/digital_detox/detox_platform.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_platform.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_ingest_token.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_reminders.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    api: ref.watch(apiClientProvider),
    tokens: ref.watch(tokenStoreProvider),
  ),
);

// Kept injectable so sign-out ordering can be tested without a platform key.
final walletCredentialStoreProvider = Provider<WalletCredentialStore>(
  (ref) => PlatformWalletCredentialStore(),
);

// Production uses the shared service; tests can isolate async storage state.
final signOutAiServiceProvider = Provider<AiService>(
  (ref) => AiService.instance,
);

final authProvider = AsyncNotifierProvider<AuthController, AppUser?>(
  AuthController.new,
);

class AuthController extends AsyncNotifier<AppUser?> {
  bool _signingOut = false;
  int _authGeneration = 0;
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

  // Wallet issuance must stop as soon as sign-out starts, even before logout I/O.
  String? get walletAccount => _signingOut ? null : state.asData?.value?.id;

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
    return _serializeAuth(() async {
      if (generation != _authGeneration) return;
      state = const AsyncLoading();
      final result = await AsyncValue.guard(operation);
      // A sign-out that started during the request owns the next transition.
      if (generation != _authGeneration) return;
      _signingOut = false;
      state = result;
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

  Future<void> updateCurrency(String newCurrency) async {
    final updated = await ref.read(authRepositoryProvider).updateProfile(
          defaultCurrency: newCurrency,
        );
    state = AsyncData(updated);
  }

  Future<Map<String, dynamic>> exportUserData(String currentPassword) =>
      ref.read(authRepositoryProvider).exportUserData(currentPassword);

  Future<void> scheduleAccountDeletion(String currentPassword) async {
    final repo = ref.read(authRepositoryProvider);
    await repo.scheduleAccountDeletion(currentPassword);
    final refreshed = await repo.getProfile();
    state = AsyncData(refreshed);
  }

  Future<void> cancelAccountDeletion() async {
    final repo = ref.read(authRepositoryProvider);
    await repo.cancelAccountDeletion();
    final refreshed = await repo.getProfile();
    state = AsyncData(refreshed);
  }

  Future<void> signOut() async {
    _signingOut = true;
    _authGeneration++;
    ref.read(authRepositoryProvider).invalidateSessionRetries();
    WalletIngestToken.invalidatePending();
    final account = state.asData?.value?.id;
    // Schedule local cleanup now rather than waiting for network logout and
    // unrelated native cleanup. The native operation is asynchronous: this is
    // not an atomic fence with the SMS receiver, and may fail or stall.
    Object? walletCleanupError;
    StackTrace? walletCleanupStack;
    final walletCleanup = WalletIngestToken.clearLocal(
      credentials: ref.read(walletCredentialStoreProvider),
    ).then<void>((_) {}, onError: (Object error, StackTrace stack) {
      walletCleanupError = error;
      walletCleanupStack = stack;
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
        // Signing out revokes the session, so both the SMS receiver's ingest token
        // and any user-specific BYOK Gemini key are cleared from local storage.
        try {
          if (account != null) await SecureDetoxStore(account).clear();
        } finally {
          try {
            await walletCleanup;
            if (walletCleanupError != null) {
              Error.throwWithStackTrace(
                  walletCleanupError!, walletCleanupStack!);
            }
          } finally {
            await ref.read(signOutAiServiceProvider).setUserApiKey(null);
          }
        }
      }
    });
  }

  Future<void> retryRestore() {
    final generation = _authGeneration;
    return _serializeAuth(() async {
      if (generation != _authGeneration) return;
      state = const AsyncLoading();
      final result = await AsyncValue.guard(
        ref.read(authRepositoryProvider).restoreSession,
      );
      if (generation != _authGeneration) return;
      _signingOut = false;
      state = result;
    });
  }
}
