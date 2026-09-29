import 'api_client.dart';
import 'models.dart';

class MoneyRepository {
  const MoneyRepository(this._api);

  final ApiClient _api;

  Future<List<Budget>> listBudgets() async {
    final response = await _api.get('money/budgets');
    if (response is! Map<String, dynamic> || response['budgets'] is! List<dynamic>) {
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
    if (response is! Map<String, dynamic> || response['subscriptions'] is! List<dynamic>) {
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

  Future<void> createTransaction({
    required String kind,
    required String amount,
    required String currency,
    required String occurredOn,
    String? description,
    required String idempotencyKey,
  }) async {
    await _api.post(
      'money/transactions',
      headers: {'Idempotency-Key': idempotencyKey},
      body: {
        'kind': kind,
        'amount': amount,
        'currency': currency,
        'occurredOn': occurredOn,
        if (description != null) 'description': description,
      },
    );
  }
}
