import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/recurring/data/recurring_task_model.dart';
import 'package:lifestyle_mobile/features/recurring/data/recurring_tasks_repository.dart';

final recurringTasksRepositoryProvider = Provider<RecurringTasksRepository>(
  (ref) => RecurringTasksRepository(ref.watch(apiClientProvider)),
);

final recurringTasksProvider =
    FutureProvider.autoDispose<List<RecurringTask>>((ref) async {
      final currentUserId = ref.watch(
        authProvider.select((value) => value.asData?.value?.id),
      );
      if (currentUserId == null) return const [];
      return ref.watch(recurringTasksRepositoryProvider).listRecurringTasks();
    });
