import 'package:flutter/services.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';

/// One Android alarm represents the next renewal across a complete account snapshot.
/// It displays a generic reminder and never performs or records a payment.
class SubscriptionReminders {
  static const _channel =
      MethodChannel('com.example.lifestyle_mobile/native_voice');
  static int _generation = 0;

  static Future<void> sync({
    required String account,
    required MoneyRepository repository,
    required String? Function() currentAccount,
    String? requiredSubscriptionId,
  }) async {
    final generation = ++_generation;
    final subscriptions = await repository.listAllActiveSubscriptions();
    if (requiredSubscriptionId != null &&
        !subscriptions.any((item) => item.id == requiredSubscriptionId)) {
      throw StateError('Subscription is no longer active');
    }
    if (generation != _generation || currentAccount() != account) {
      throw StateError('Reminder sync superseded');
    }
    await _channel.invokeMethod<void>('replaceSubscriptionReminders', {
      'account': account,
      'schedules': [
        for (final item in subscriptions)
          {
            'id': item.id,
            'anchorDate': item.anchorDate,
            'nextBillingDate': item.nextBillingDate,
            'billingUnit': item.billingUnit,
            'billingInterval': item.billingInterval,
          },
      ],
    });
  }

  static Future<void> remove(String account, String id) async {
    ++_generation;
    await _channel.invokeMethod<void>('removeSubscriptionReminder', {
      'account': account,
      'id': id,
    });
  }

  static Future<void> clear() async {
    ++_generation;
    await _channel.invokeMethod<void>('clearSubscriptionReminders');
  }
}
