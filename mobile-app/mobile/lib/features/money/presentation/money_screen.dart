import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';

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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddTransaction(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Transaction'),
      ),
    );
  }
}

Future<void> _showAddTransaction(BuildContext context, WidgetRef ref) async {
  final user = ref.read(authProvider).asData?.value;
  final defaultCurr = user?.defaultCurrency ?? 'EGP';

  final amountController = TextEditingController();
  final descController = TextEditingController();
  final merchantController = TextEditingController();
  final formKey = GlobalKey<FormState>();

  String kind = 'expense';
  String currency = defaultCurr;
  var busy = false;
  String? error;

  final currencies = [
    'EGP',
    'USD',
    'EUR',
    'SAR',
    'AED',
    'KWD',
    'QAR',
    'GBP',
    'BHD',
    'OMR',
    'JOD',
  ];

  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) {
        Future<void> submit() async {
          if (!formKey.currentState!.validate()) return;
          setDialogState(() {
            busy = true;
            error = null;
          });
          try {
            final now = DateTime.now();
            final today =
                '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
            final idempotencyKey = _generateUuidV4();

            await ref.read(moneyRepositoryProvider).createTransaction(
              kind: kind,
              amount: amountController.text.trim(),
              currency: currency,
              occurredOn: today,
              idempotencyKey: idempotencyKey,
              description: descController.text.trim().isEmpty
                  ? null
                  : descController.text,
              merchant: merchantController.text.trim().isEmpty
                  ? null
                  : merchantController.text,
            );

            ref.invalidate(budgetsProvider);
            ref.invalidate(subscriptionsProvider);

            if (dialogContext.mounted) {
              Navigator.of(dialogContext).pop();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Transaction saved successfully!'),
                ),
              );
            }
          } catch (e) {
            if (dialogContext.mounted) {
              setDialogState(() => error = e.toString());
            }
          } finally {
            if (dialogContext.mounted) setDialogState(() => busy = false);
          }
        }

        return AlertDialog(
          title: const Text('Add Transaction'),
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'expense',
                        label: Text('Expense'),
                        icon: Icon(Icons.arrow_downward),
                      ),
                      ButtonSegment(
                        value: 'income',
                        label: Text('Income'),
                        icon: Icon(Icons.arrow_upward),
                      ),
                    ],
                    selected: {kind},
                    onSelectionChanged: (set) {
                      setDialogState(() => kind = set.first);
                    },
                  ),
                  const SizedBox(height: 16),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        flex: 3,
                        child: TextFormField(
                          controller: amountController,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: const InputDecoration(
                            labelText: 'Amount',
                            hintText: '0.00',
                          ),
                          validator: (v) {
                            if (v == null || v.trim().isEmpty) {
                              return 'Enter amount';
                            }
                            final n = double.tryParse(v.trim());
                            if (n == null || n <= 0) {
                              return 'Must be > 0';
                            }
                            return null;
                          },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 2,
                        child: DropdownButtonFormField<String>(
                          initialValue: currencies.contains(currency)
                              ? currency
                              : currencies.first,
                          decoration: const InputDecoration(
                            labelText: 'Currency',
                          ),
                          items: currencies
                              .map(
                                (c) => DropdownMenuItem(
                                  value: c,
                                  child: Text(c),
                                ),
                              )
                              .toList(),
                          onChanged: (val) {
                            if (val != null) {
                              setDialogState(() => currency = val);
                            }
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: descController,
                    decoration: const InputDecoration(
                      labelText: 'Description',
                      hintText: 'e.g. Groceries, Coffee',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: merchantController,
                    decoration: const InputDecoration(
                      labelText: 'Merchant (optional)',
                      hintText: 'e.g. Carrefour, Starbucks',
                    ),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: busy ? null : submit,
              child: busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Save'),
            ),
          ],
        );
      },
    ),
  );

  amountController.dispose();
  descController.dispose();
  merchantController.dispose();
}

String _generateUuidV4() {
  final random = Random.secure();
  final values = List<int>.generate(16, (i) => random.nextInt(256));
  values[6] = (values[6] & 0x0f) | 0x40;
  values[8] = (values[8] & 0x3f) | 0x80;
  String hex(List<int> bytes) =>
      bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex(values.sublist(0, 4))}-${hex(values.sublist(4, 6))}-${hex(values.sublist(6, 8))}-${hex(values.sublist(8, 10))}-${hex(values.sublist(10, 16))}';
}
