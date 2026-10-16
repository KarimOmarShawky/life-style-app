import 'package:lifestyle_mobile/features/digital_detox/detox_platform.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_platform.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_ingest_token.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    api: ref.watch(apiClientProvider),
    tokens: ref.watch(tokenStoreProvider),
  ),
);

final authProvider = AsyncNotifierProvider<AuthController, AppUser?>(
  AuthController.new,
);

class AuthController extends AsyncNotifier<AppUser?> {
  @override
  Future<AppUser?> build() => ref.read(authRepositoryProvider).restoreSession();

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

  Future<void> _authenticate(Future<AppUser> Function() operation) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(operation);
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

  Future<void> updatePushShowTitles(bool showTitles) async {
    final updated = await ref.read(authRepositoryProvider).updateProfile(
          pushShowTitles: showTitles,
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
    final account = state.asData?.value?.id;
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
      // Signing out revokes the session, so both the SMS receiver's ingest token
      // and any user-specific BYOK Gemini key are cleared from local storage.
      try {
        if (account != null) await SecureDetoxStore(account).clear();
      } finally {
        try {
          await WalletIngestToken.clearLocal();
        } finally {
          await AiService.instance.setUserApiKey(null);
        }
      }
    }
  }

  Future<void> retryRestore() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      ref.read(authRepositoryProvider).restoreSession,
    );
  }
}
