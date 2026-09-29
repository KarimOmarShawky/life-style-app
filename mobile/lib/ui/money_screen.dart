import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models.dart';
import '../state/providers.dart';

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
                          .map((b) => _BudgetCard(budget: b))
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
                          .map((s) => _SubscriptionCard(subscription: s))
                          .toList(),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BudgetCard extends StatelessWidget {
  const _BudgetCard({required this.budget});

  final Budget budget;

  @override
  Widget build(BuildContext context) {
    final usage = budget.usage;
    final progress = (usage.percentUsed / 100.0).clamp(0.0, 1.0);
    final isOver = usage.overspent;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  budget.categoryId == null
                      ? 'Overall Budget'
                      : 'Category Budget',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
                Text(
                  '${usage.spent} / ${budget.amountLimit} ${budget.currency}',
                  style: TextStyle(
                    color: isOver ? Colors.red : Colors.green[800],
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: progress,
              color: isOver ? Colors.red : const Color(0xFF315C4C),
              backgroundColor: Colors.grey[200],
              minHeight: 8,
            ),
            const SizedBox(height: 6),
            Text(
              isOver
                  ? 'Overspent by ${usage.spent}!'
                  : 'Remaining: ${usage.remaining} ${budget.currency} (${usage.percentUsed.toStringAsFixed(1)}% used)',
              style: TextStyle(fontSize: 12, color: Colors.grey[600]),
            ),
          ],
        ),
      ),
    );
  }
}

class _SubscriptionCard extends ConsumerWidget {
  const _SubscriptionCard({required this.subscription});

  final Subscription subscription;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: ListTile(
        title: Text(
          subscription.name,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          'Next bill: ${subscription.nextBillingDate} (${subscription.daysUntilNextBilling} days left)',
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '${subscription.amount} ${subscription.currency}',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
            ),
            Text(
              '/${subscription.billingUnit}',
              style: TextStyle(fontSize: 11, color: Colors.grey[600]),
            ),
          ],
        ),
      ),
    );
  }
}
