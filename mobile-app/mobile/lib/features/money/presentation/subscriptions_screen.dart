import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/notification_service.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_model.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class SubscriptionsScreen extends ConsumerWidget {
  const SubscriptionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final subsAsync = ref.watch(subscriptionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.subscriptionsTitle),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(subscriptionsProvider);
        },
        child: subsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => Center(child: Text('${l10n.errorTitle}: $err')),
          data: (subs) {
            double monthlyTotal = 0;
            String currency = 'EGP';
            for (final s in subs) {
              final amt = double.tryParse(s.amount) ?? 0;
              currency = s.currency;
              if (s.billingUnit == 'year') {
                monthlyTotal += (amt / 12);
              } else if (s.billingUnit == 'week') {
                monthlyTotal += (amt * 4.33);
              } else {
                monthlyTotal += amt;
              }
            }

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Summary Card
                Card(
                  elevation: 2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 26,
                          backgroundColor:
                              Theme.of(context).colorScheme.primaryContainer,
                          child: const Icon(Icons.subscriptions_outlined,
                              size: 28),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                l10n.totalMonthlySubscriptions,
                                style: TextStyle(
                                  fontSize: 13,
                                  color: Theme.of(context).colorScheme.outline,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '${monthlyTotal.toStringAsFixed(2)} $currency',
                                style: const TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.deepOrange,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            '${subs.length}',
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // Subscriptions List
                if (subs.isEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        children: [
                          Icon(
                            Icons.credit_card_off_outlined,
                            size: 48,
                            color: Theme.of(context).colorScheme.outline,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            l10n.noSubscriptions,
                            style: const TextStyle(fontSize: 16),
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  )
                else
                  ...subs.map((s) => _SubscriptionTile(subscription: s)),
              ],
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddSubscription(context, ref),
        icon: const Icon(Icons.add),
        label: Text(l10n.addSubscription),
      ),
    );
  }
}

class _SubscriptionTile extends ConsumerWidget {
  const _SubscriptionTile({required this.subscription});

  final Subscription subscription;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final daysLeft = subscription.daysUntilNextBilling;
    final isSoon = daysLeft <= 3 && daysLeft >= 0;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              child: const Icon(Icons.payment, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        subscription.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      if (isSoon) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.amber.withAlpha(50),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            l10n.renewalSoon,
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: Colors.deepOrange,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${subscription.nextBillingDate} ($daysLeft ${l10n.days})',
                    style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '${subscription.amount} ${subscription.currency}',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                  ),
                ),
                Text(
                  l10n.billingUnitLabel(subscription.billingUnit),
                  style: TextStyle(fontSize: 11, color: Colors.grey[600]),
                ),
              ],
            ),
            const SizedBox(width: 4),
            IconButton(
              tooltip: l10n.remindSubscription,
              icon: const Icon(Icons.alarm_on_outlined, size: 20),
              onPressed: () async {
                final notifId = subscription.id.hashCode;
                await NotificationService.instance.showInstantNotification(
                  id: notifId,
                  title: subscription.name,
                  body:
                      '${l10n.remindSubscription}: ${subscription.amount} ${subscription.currency}',
                );
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(l10n.subscriptionReminderSet)),
                  );
                }
              },
            ),
            IconButton(
              tooltip: l10n.deleteSubscription,
              icon: Icon(Icons.delete_outline,
                  size: 20, color: Theme.of(context).colorScheme.error),
              onPressed: () async {
                final confirm = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: Text(l10n.deleteSubscription),
                    content: Text(l10n.deleteConfirm),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.of(ctx).pop(false),
                        child: Text(l10n.cancel),
                      ),
                      FilledButton(
                        onPressed: () => Navigator.of(ctx).pop(true),
                        child: Text(l10n.delete),
                      ),
                    ],
                  ),
                );
                if (confirm == true) {
                  await ref
                      .read(moneyRepositoryProvider)
                      .deleteSubscription(subscription.id);
                  ref.invalidate(subscriptionsProvider);
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _showAddSubscription(BuildContext context, WidgetRef ref) async {
  final l10n = AppLocalizations.of(context);
  final user = ref.read(authProvider).asData?.value;
  final defaultCurr = user?.defaultCurrency ?? 'EGP';

  final nameController = TextEditingController();
  final amountController = TextEditingController();
  final formKey = GlobalKey<FormState>();

  String currency = defaultCurr;
  String billingUnit = 'month';
  DateTime selectedDate = DateTime.now().add(const Duration(days: 30));
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
        Future<void> pickDate() async {
          final now = DateTime.now();
          final picked = await showDatePicker(
            context: context,
            initialDate: selectedDate,
            firstDate: now,
            lastDate: now.add(const Duration(days: 3650)),
          );
          if (picked != null) {
            setDialogState(() => selectedDate = picked);
          }
        }

        Future<void> submit() async {
          if (!formKey.currentState!.validate()) return;
          setDialogState(() {
            busy = true;
            error = null;
          });
          try {
            final y = selectedDate.year.toString().padLeft(4, '0');
            final m = selectedDate.month.toString().padLeft(2, '0');
            final d = selectedDate.day.toString().padLeft(2, '0');
            final anchorDate = '$y-$m-$d';

            await ref.read(moneyRepositoryProvider).createSubscription(
                  name: nameController.text.trim(),
                  amount: amountController.text.trim(),
                  currency: currency,
                  billingUnit: billingUnit,
                  anchorDate: anchorDate,
                  reminderDaysBefore: 2,
                );

            ref.invalidate(subscriptionsProvider);

            if (dialogContext.mounted) {
              Navigator.of(dialogContext).pop();
            }
            if (context.mounted) {
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
          title: Text(l10n.addSubscription),
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: nameController,
                    autofocus: true,
                    decoration: InputDecoration(
                      labelText: l10n.subscriptionName,
                      hintText: l10n.subscriptionNameHint,
                    ),
                    validator: (v) => v == null || v.trim().isEmpty
                        ? l10n.subscriptionName
                        : null,
                  ),
                  const SizedBox(height: 12),
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
                              .map((c) => DropdownMenuItem(
                                    value: c,
                                    child: Text(c),
                                  ))
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
                  const SizedBox(height: 16),
                  Text(
                    l10n.billingCycle,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    segments: [
                      ButtonSegment(
                        value: 'month',
                        label: Text(l10n.monthly),
                      ),
                      ButtonSegment(
                        value: 'year',
                        label: Text(l10n.yearly),
                      ),
                      ButtonSegment(
                        value: 'week',
                        label: Text(l10n.weekly),
                      ),
                    ],
                    selected: {billingUnit},
                    onSelectionChanged: (set) =>
                        setDialogState(() => billingUnit = set.first),
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: pickDate,
                    icon: const Icon(Icons.calendar_today, size: 16),
                    label: Text(
                      '${l10n.firstBillingDate}: ${selectedDate.year}-${selectedDate.month.toString().padLeft(2, '0')}-${selectedDate.day.toString().padLeft(2, '0')}',
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

  nameController.dispose();
  amountController.dispose();
}
