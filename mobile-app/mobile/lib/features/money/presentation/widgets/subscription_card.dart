import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/data/notification_service.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_model.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class SubscriptionCard extends StatelessWidget {
  const SubscriptionCard({super.key, required this.subscription});

  final Subscription subscription;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final daysLeft = subscription.daysUntilNextBilling;
    final isSoon = daysLeft <= 3 && daysLeft >= 0;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          child: const Icon(Icons.credit_card, size: 20),
        ),
        title: Row(
          children: [
            Text(
              subscription.name,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            if (isSoon) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
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
        subtitle: Text(
          '${subscription.nextBillingDate} ($daysLeft ${l10n.days})',
          style: TextStyle(fontSize: 12, color: Colors.grey[600]),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
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
          ],
        ),
      ),
    );
  }
}
