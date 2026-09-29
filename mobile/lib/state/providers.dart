import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_config.dart';
import '../data/api_client.dart';
import '../data/auth_repository.dart';
import '../data/models.dart';
import '../data/tasks_repository.dart';
import '../data/token_store.dart';

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    baseUri: AppConfig.apiBaseUri,
    tokenStore: ref.watch(tokenStoreProvider),
  );
  ref.onDispose(client.close);
  return client;
});

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    api: ref.watch(apiClientProvider),
    tokens: ref.watch(tokenStoreProvider),
  ),
);

final tasksRepositoryProvider = Provider<TasksRepository>(
  (ref) => TasksRepository(ref.watch(apiClientProvider)),
);

final authProvider = AsyncNotifierProvider<AuthController, AppUser?>(AuthController.new);

class AuthController extends AsyncNotifier<AppUser?> {
  @override
  Future<AppUser?> build() => ref.read(authRepositoryProvider).restoreSession();

  Future<void> signIn({required String email, required String password}) =>
      _authenticate(() => ref.read(authRepositoryProvider).login(email: email, password: password));

  Future<void> register({
    required String email,
    required String password,
    required String displayName,
  }) =>
      _authenticate(
        () => ref.read(authRepositoryProvider).register(
              email: email,
              password: password,
              displayName: displayName,
            ),
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
      ref.read(authRepositoryProvider).resetPassword(
            email: email,
            code: code,
            newPassword: newPassword,
          );

  Future<void> signOut() async {
    try {
      await ref.read(authRepositoryProvider).logout();
    } finally {
      state = const AsyncData(null);
    }
  }

  Future<void> retryRestore() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(ref.read(authRepositoryProvider).restoreSession);
  }
}

final tasksProvider = FutureProvider.autoDispose<List<Task>>((ref) async {
  final currentUserId = ref.watch(authProvider.select((value) => value.valueOrNull?.id));
  if (currentUserId == null) return const [];
  return ref.watch(tasksRepositoryProvider).listTasks();
});
