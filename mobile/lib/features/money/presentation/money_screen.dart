import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/providers.dart';
import 'widgets/budget_card.dart';
import 'widgets/subscription_card.dart';

class MoneyScreen extends ConsumerWidget {
  const MoneyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final budgetsAsync = ref.watch(budgetsProvider);
    final subscriptionsAsync = ref.watch(subscriptionsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Money & Budgets')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(budgetsProvider);
          ref.invalidate(subscriptionsProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'Monthly Budgets',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            budgetsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Text('Error loading budgets: $err'),
              data: (budgets) => budgets.isEmpty
                  ? const Card(
                      child: Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No active budgets set for this month.'),
                      ),
                    )
                  : Column(
                      children: budgets
                          .map((b) => BudgetCard(budget: b))
                          .toList(),
                    ),
            ),
            const SizedBox(height: 24),
            const Text(
              'Active Subscriptions',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            subscriptionsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Text('Error loading subscriptions: $err'),
              data: (subs) => subs.isEmpty
                  ? const Card(
                      child: Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No active subscriptions found.'),
                      ),
                    )
                  : Column(
                      children: subs
                          .map((s) => SubscriptionCard(subscription: s))
                          .toList(),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
