import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/timer/data/timer_session_model.dart';
import 'package:lifestyle_mobile/features/timer/data/timer_sessions_repository.dart';

final timerSessionsRepositoryProvider = Provider<TimerSessionsRepository>(
  (ref) => TimerSessionsRepository(ref.watch(apiClientProvider)),
);

final timerSessionsProvider = FutureProvider.autoDispose<List<TimerSession>>((
  ref,
) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.asData?.value?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(timerSessionsRepositoryProvider).listSessions();
});
