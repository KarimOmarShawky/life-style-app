import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/habits/data/habit_model.dart';
import 'package:lifestyle_mobile/features/habits/data/habits_repository.dart';

final habitsRepositoryProvider = Provider<HabitsRepository>(
  (ref) => HabitsRepository(ref.watch(apiClientProvider)),
);

final habitsProvider = FutureProvider.autoDispose<List<Habit>>((ref) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.asData?.value?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(habitsRepositoryProvider).listHabits();
});
