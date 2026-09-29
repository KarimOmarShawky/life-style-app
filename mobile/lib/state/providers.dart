import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/config/app_config.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/models.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/habits/data/habits_repository.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';
import 'package:lifestyle_mobile/features/notes/data/notes_repository.dart';
import 'package:lifestyle_mobile/features/tasks/data/tasks_repository.dart';

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

final moneyRepositoryProvider = Provider<MoneyRepository>(
  (ref) => MoneyRepository(ref.watch(apiClientProvider)),
);

final habitsRepositoryProvider = Provider<HabitsRepository>(
  (ref) => HabitsRepository(ref.watch(apiClientProvider)),
);

final notesRepositoryProvider = Provider<NotesRepository>(
  (ref) => NotesRepository(ref.watch(apiClientProvider)),
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

final tasksProvider = FutureProvider.autoDispose<List<Task>>((ref) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.valueOrNull?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(tasksRepositoryProvider).listTasks();
});

final budgetsProvider = FutureProvider.autoDispose<List<Budget>>((ref) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.valueOrNull?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(moneyRepositoryProvider).listBudgets();
});

final subscriptionsProvider = FutureProvider.autoDispose<List<Subscription>>((
  ref,
) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.valueOrNull?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(moneyRepositoryProvider).listSubscriptions();
});

final habitsProvider = FutureProvider.autoDispose<List<Habit>>((ref) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.valueOrNull?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(habitsRepositoryProvider).listHabits();
});

final notesProvider = FutureProvider.autoDispose<List<Note>>((ref) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.valueOrNull?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(notesRepositoryProvider).listNotes();
});
