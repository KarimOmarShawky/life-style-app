import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/money/data/budget_model.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_model.dart';

class MoneyRepository {
  const MoneyRepository(this._api);

  final ApiClient _api;

  Future<WeeklySpending> weeklySpending(
      String from, String to, String currency) async {
    final response = await _api.get('money/reports/summary',
        query: {'from': from, 'to': to, 'currency': currency});
    if (response is! Map<String, dynamic> ||
        response['totals'] is! Map<String, dynamic>) {
      throw const FormatException('Invalid money summary');
    }
    final totals = response['totals'] as Map<String, dynamic>;
    return WeeklySpending(
        response['currency'] as String, -double.parse(totals['net'] as String));
  }

  Future<List<Budget>> listBudgets() async {
    final response = await _api.get('money/budgets');
    if (response is! Map<String, dynamic> ||
        response['budgets'] is! List<dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid budgets list.',
      );
    }
    return (response['budgets'] as List<dynamic>)
        .map((item) => Budget.fromJson(item as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<List<Subscription>> listSubscriptions() async {
    final response = await _api.get('money/subscriptions');
    if (response is! Map<String, dynamic> ||
        response['subscriptions'] is! List<dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid subscriptions list.',
      );
    }
    return (response['subscriptions'] as List<dynamic>)
        .map((item) => Subscription.fromJson(item as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<void> paySubscription(String id, String idempotencyKey) async {
    await _api.post(
      'money/subscriptions/$id/pay',
      headers: {'Idempotency-Key': idempotencyKey},
      body: {},
    );
  }

  Future<void> createSubscription({
    required String name,
    required String amount,
    required String currency,
    required String billingUnit,
    required String anchorDate,
    int? reminderDaysBefore,
  }) async {
    await _api.post(
      'money/subscriptions',
      body: {
        'name': name.trim(),
        'amount': amount.trim(),
        'currency': currency,
        'billingUnit': billingUnit,
        'anchorDate': anchorDate,
        if (reminderDaysBefore != null)
          'reminderDaysBefore': reminderDaysBefore,
      },
    );
  }

  Future<void> deleteSubscription(String id) async {
    await _api.delete('money/subscriptions/$id');
  }

  Future<void> createBudget({
    required String amountLimit,
    required String currency,
  }) async {
    await _api.post(
      'money/budgets',
      body: {
        'amountLimit': amountLimit.trim(),
        'currency': currency,
      },
    );
  }

  Future<void> createTransaction({
    required String kind,
    required String amount,
    required String currency,
    required String occurredOn,
    required String idempotencyKey,
    String? categoryId,
    String? description,
    String? merchant,
  }) async {
    await _api.post(
      'money/transactions',
      headers: {'Idempotency-Key': idempotencyKey},
      body: {
        'kind': kind,
        'amount': amount,
        'currency': currency,
        'occurredOn': occurredOn,
        if (categoryId != null) 'categoryId': categoryId,
        if (description != null) 'description': description.trim(),
        if (merchant != null) 'merchant': merchant.trim(),
      },
    );
  }
}

class WeeklySpending {
  const WeeklySpending(this.currency, this.netSpending);
  final String currency;
  final double netSpending;
}
