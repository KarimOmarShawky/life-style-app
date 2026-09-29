import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/money/data/budget_model.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_model.dart';

final moneyRepositoryProvider = Provider<MoneyRepository>(
  (ref) => MoneyRepository(ref.watch(apiClientProvider)),
);

final budgetsProvider = FutureProvider.autoDispose<List<Budget>>((ref) async {
  final currentUserId = ref.watch(
authProvider.select((value) => value.asData?.value?.id),  );
  if (currentUserId == null) return const [];
  return ref.watch(moneyRepositoryProvider).listBudgets();
});

final subscriptionsProvider = FutureProvider.autoDispose<List<Subscription>>((
  ref,
) async {
  final currentUserId = ref.watch(
authProvider.select((value) => value.asData?.value?.id),  );
  if (currentUserId == null) return const [];
  return ref.watch(moneyRepositoryProvider).listSubscriptions();
});
