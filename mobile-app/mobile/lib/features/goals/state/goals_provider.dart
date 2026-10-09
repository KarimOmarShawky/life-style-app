import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/goals/data/goal_model.dart';
import 'package:lifestyle_mobile/features/goals/data/goals_repository.dart';

final goalsRepositoryProvider = Provider<GoalsRepository>(
  (ref) => GoalsRepository(ref.watch(apiClientProvider)),
);

final goalsProvider = FutureProvider.autoDispose<List<Goal>>((ref) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.asData?.value?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(goalsRepositoryProvider).listGoals();
});

final goalDetailProvider = FutureProvider.autoDispose.family<Goal, String>((
  ref,
  goalId,
) {
  return ref.watch(goalsRepositoryProvider).getGoal(goalId);
});
