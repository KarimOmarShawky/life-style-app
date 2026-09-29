import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/tasks/data/tasks_repository.dart';

final tasksRepositoryProvider = Provider<TasksRepository>(
  (ref) => TasksRepository(ref.watch(apiClientProvider)),
);

final tasksProvider = FutureProvider.autoDispose<List<Task>>((ref) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.valueOrNull?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(tasksRepositoryProvider).listTasks();
});
