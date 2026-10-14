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
    authProvider.select((value) => value.asData?.value?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(tasksRepositoryProvider).listTasks();
});

final tasksControllerProvider = Provider<TasksController>((ref) =>
    TasksController(ref.watch(tasksRepositoryProvider),
        () => ref.invalidate(tasksProvider)));

class TasksController {
  TasksController(this._repository, this._changed);
  final TasksRepository _repository;
  final void Function() _changed;
  Future<void> _queue = Future<void>.value();
  Future<BulkTaskDateResult> bulkUpdateDueDates(List<TaskDateChange> changes) {
    final result = _queue.then((_) => _repository.bulkUpdateDueDates(changes));
    _queue = result.then<void>((_) {
      _changed();
    }).catchError((Object _) {
      _changed();
    });
    return result;
  }
}
