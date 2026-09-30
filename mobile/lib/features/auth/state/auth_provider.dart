import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';

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
  }) => _authenticate(
    () => ref
        .read(authRepositoryProvider)
        .register(email: email, password: password, displayName: displayName),
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
  }) => ref
      .read(authRepositoryProvider)
      .resetPassword(email: email, code: code, newPassword: newPassword);

  Future<void> updateCurrency(String newCurrency) async {
    final updated = await ref.read(authRepositoryProvider).updateProfile(
      defaultCurrency: newCurrency,
    );
    state = AsyncData(updated);
  }

  Future<void> signOut() async {
    try {
      await ref.read(authRepositoryProvider).logout();
    } finally {
      state = const AsyncData(null);
    }
  }

  Future<void> retryRestore() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      ref.read(authRepositoryProvider).restoreSession,
    );
  }
}
