import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/money/data/budget_model.dart';
import 'package:lifestyle_mobile/features/money/presentation/subscriptions_screen.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

import 'widgets/budget_card.dart';

class MoneyScreen extends ConsumerWidget {
  const MoneyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final budgetsAsync = ref.watch(budgetsProvider);
    final subscriptionsAsync = ref.watch(subscriptionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.moneyBudgets),
        actions: [
          IconButton(
            tooltip: l10n.exportReportTooltip,
            icon: const Icon(Icons.share_outlined),
            onPressed: () => _exportFinancialReport(context, ref, l10n),
          ),
          IconButton(
            tooltip: l10n.subscriptionsTitle,
            icon: const Icon(Icons.credit_card),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const SubscriptionsScreen(),
                ),
              );
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(budgetsProvider);
          ref.invalidate(subscriptionsProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Dedicated Subscriptions Banner Card
            InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const SubscriptionsScreen(),
                  ),
                );
              },
              child: Card(
                elevation: 3,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                color: Theme.of(context).colorScheme.primaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 24,
                        backgroundColor:
                            Theme.of(context).colorScheme.primary,
                        child: const Icon(Icons.subscriptions,
                            color: Colors.white, size: 24),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              l10n.subscriptionsTitle,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 2),
                            subscriptionsAsync.when(
                              loading: () => const Text('...'),
                              error: (_, __) => Text(l10n.subscriptionsTitle),
                              data: (subs) => Text(
                                '${subs.length} ${l10n.activeSubscriptions}',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: Theme.of(context)
                                      .colorScheme
                                      .onPrimaryContainer
                                      .withAlpha(200),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.arrow_forward_ios, size: 16),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Financial Overview Card
            budgetsAsync.when(
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
              data: (budgets) => _buildOverviewCard(context, l10n, budgets),
            ),
            const SizedBox(height: 16),

            // Monthly Budgets Header with Add Button
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  l10n.monthlyBudgets,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                TextButton.icon(
                  onPressed: () => _showAddBudget(context, ref),
                  icon: const Icon(Icons.add, size: 18),
                  label: Text(l10n.addBudget),
                ),
              ],
            ),
            const SizedBox(height: 8),
            budgetsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Text('${l10n.errorTitle}: $err'),
              data: (budgets) => budgets.isEmpty
                  ? Card(
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          children: [
                            Text(
                              l10n.noBudgets,
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 12),
                            FilledButton.tonalIcon(
                              onPressed: () => _showAddBudget(context, ref),
                              icon: const Icon(Icons.add),
                              label: Text(l10n.addBudget),
                            ),
                          ],
                        ),
                      ),
                    )
                  : Column(
                      children:
                          budgets.map((b) => BudgetCard(budget: b)).toList(),
                    ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddTransaction(context, ref),
        icon: const Icon(Icons.add),
        label: Text(l10n.addTransaction),
      ),
    );
  }

  Widget _buildOverviewCard(
    BuildContext context,
    AppLocalizations l10n,
    List<Budget> budgets,
  ) {
    if (budgets.isEmpty) return const SizedBox.shrink();

    double totalLimit = 0;
    double totalSpent = 0;
    String currency = 'EGP';

    for (final b in budgets) {
      final lim = double.tryParse(b.amountLimit) ?? 0;
      final spent = double.tryParse(b.usage.spent) ?? 0;
      totalLimit += lim;
      totalSpent += spent;
      currency = b.currency;
    }

    final double remaining = totalLimit - totalSpent;
    final double percent =
        totalLimit > 0 ? (totalSpent / totalLimit).clamp(0.0, 1.0) : 0;
    final isOver = totalSpent > totalLimit;
    final isWarning = percent > 0.8 && !isOver;

    final colorScheme = Theme.of(context).colorScheme;

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  l10n.financialOverview,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Icon(
                  Icons.pie_chart_outline,
                  color: colorScheme.primary,
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.totalSpent,
                        style: TextStyle(
                          fontSize: 12,
                          color: colorScheme.outline,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${totalSpent.toStringAsFixed(2)} $currency',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: isOver ? Colors.red : Colors.deepOrange,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  width: 1,
                  height: 36,
                  color: colorScheme.outlineVariant,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.remaining,
                        style: TextStyle(
                          fontSize: 12,
                          color: colorScheme.outline,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${remaining.toStringAsFixed(2)} $currency',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: isOver
                              ? Colors.red
                              : const Color(0xFF315C4C),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: LinearProgressIndicator(
                value: percent,
                minHeight: 10,
                color: isOver
                    ? Colors.red
                    : isWarning
                        ? Colors.amber[700]
                        : const Color(0xFF315C4C),
                backgroundColor: colorScheme.surfaceContainerHighest,
              ),
            ),
            if (isOver || isWarning) ...[
              const SizedBox(height: 8),
              Text(
                isOver ? l10n.budgetExceeded : l10n.budgetWarning,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: isOver ? Colors.red : Colors.amber[800],
                ),
              ),
            ],
            // Visual Category Analytics Breakdown
            const SizedBox(height: 16),
            const Divider(height: 1),
            const SizedBox(height: 12),
            Text(
              l10n.budgetBreakdownTitle,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: colorScheme.outline,
              ),
            ),
            const SizedBox(height: 8),
            ...budgets.map((b) {
              final lim = double.tryParse(b.amountLimit) ?? 1;
              final sp = double.tryParse(b.usage.spent) ?? 0;
              final p = lim > 0 ? (sp / lim).clamp(0.0, 1.0) : 0.0;
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          b.categoryId ?? l10n.generalBudget,
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                        ),
                        Text(
                          '${sp.toStringAsFixed(0)} / ${lim.toStringAsFixed(0)} ${b.currency}',
                          style: TextStyle(fontSize: 11, color: colorScheme.outline),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: p,
                        minHeight: 5,
                        color: p > 1.0 ? Colors.red : colorScheme.primary,
                        backgroundColor: colorScheme.surfaceContainerHighest,
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  void _exportFinancialReport(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) {
    final budgets = ref.read(budgetsProvider).valueOrNull ?? [];
    final subs = ref.read(subscriptionsProvider).valueOrNull ?? [];

    double totalLimit = 0;
    double totalSpent = 0;
    String currency = 'EGP';

    for (final b in budgets) {
      totalLimit += double.tryParse(b.amountLimit) ?? 0;
      totalSpent += double.tryParse(b.usage.spent) ?? 0;
      currency = b.currency;
    }

    final double remaining = totalLimit - totalSpent;

    double subsTotal = 0;
    for (final s in subs) {
      subsTotal += double.tryParse(s.amount) ?? 0;
    }

    final nowStr =
        '${DateTime.now().year}-${DateTime.now().month.toString().padLeft(2, '0')}-${DateTime.now().day.toString().padLeft(2, '0')}';

    final report = '''
================================
 ${l10n.reportHeader} 
================================
${l10n.reportDateLabel} $nowStr

${l10n.reportTotalBudgetLabel} ${totalLimit.toStringAsFixed(2)} $currency
${l10n.reportTotalSpentLabel} ${totalSpent.toStringAsFixed(2)} $currency
${l10n.reportRemainingLabel} ${remaining.toStringAsFixed(2)} $currency
${l10n.reportUtilizationLabel} ${totalLimit > 0 ? ((totalSpent / totalLimit) * 100).toStringAsFixed(1) : 0}%

${l10n.reportActiveSubsLabel} ${subs.length}
${l10n.reportTotalSubsLabel} ${subsTotal.toStringAsFixed(2)} $currency ${l10n.reportMonthlySuffix}

${l10n.reportFooter}
================================
''';

    Clipboard.setData(ClipboardData(text: report.trim()));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(l10n.reportCopied),
        backgroundColor: Colors.green,
        duration: const Duration(seconds: 4),
      ),
    );
  }
}

Future<void> _showAddBudget(BuildContext context, WidgetRef ref) async {
  final l10n = AppLocalizations.of(context);
  final user = ref.read(authProvider).asData?.value;
  final defaultCurr = user?.defaultCurrency ?? 'EGP';
  final amountController = TextEditingController();
  final formKey = GlobalKey<FormState>();
  var busy = false;
  String? error;

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
            await ref.read(moneyRepositoryProvider).createBudget(
                  amountLimit: amountController.text.trim(),
                  currency: defaultCurr,
                );
            ref.invalidate(budgetsProvider);
            if (dialogContext.mounted) {
              Navigator.of(dialogContext).pop();
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(l10n.transactionSaved)),
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
          title: Text(l10n.addBudget),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: amountController,
                  autofocus: true,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: InputDecoration(
                    labelText: '${l10n.budgetLimit} ($defaultCurr)',
                    hintText: '5000.00',
                  ),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) {
                      return l10n.enterAmount;
                    }
                    final n = double.tryParse(v.trim());
                    if (n == null || n <= 0) {
                      return l10n.amountMustBePositive;
                    }
                    return null;
                  },
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
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.of(dialogContext).pop(),
              child: Text(l10n.cancel),
            ),
            FilledButton(
              onPressed: busy ? null : submit,
              child: busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.save),
            ),
          ],
        );
      },
    ),
  );
  amountController.dispose();
}

Future<void> _showAddTransaction(BuildContext context, WidgetRef ref) async {
  final l10n = AppLocalizations.of(context);
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
                SnackBar(
                  content: Text(l10n.transactionSaved),
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
          title: Text(l10n.addTransaction),
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SegmentedButton<String>(
                    segments: [
                      ButtonSegment(
                        value: 'expense',
                        label: Text(l10n.expense),
                        icon: const Icon(Icons.arrow_downward),
                      ),
                      ButtonSegment(
                        value: 'income',
                        label: Text(l10n.income),
                        icon: const Icon(Icons.arrow_upward),
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
                          decoration: InputDecoration(
                            labelText: l10n.amount,
                            hintText: '0.00',
                          ),
                          validator: (v) {
                            if (v == null || v.trim().isEmpty) {
                              return l10n.enterAmount;
                            }
                            final n = double.tryParse(v.trim());
                            if (n == null || n <= 0) {
                              return l10n.amountMustBePositive;
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
                          decoration: InputDecoration(
                            labelText: l10n.currency,
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
                    decoration: InputDecoration(
                      labelText: l10n.description,
                      hintText: l10n.descHint,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: merchantController,
                    decoration: InputDecoration(
                      labelText: l10n.merchant,
                      hintText: l10n.merchantHint,
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
              child: Text(l10n.cancel),
            ),
            FilledButton(
              onPressed: busy ? null : submit,
              child: busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.save),
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
