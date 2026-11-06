import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_model.dart';

class MoneyRepository {
  const MoneyRepository(this._api);

  final ApiClient _api;

  /// Fetch all pages for display; never silently treat the first page as complete.
  Future<List<Subscription>> listSubscriptions() => _listPages(maxItems: 5000);

  /// A partial or malformed snapshot never replaces an existing reminder alarm.
  Future<List<Subscription>> listAllActiveSubscriptions() =>
      _listPages(status: 'active', maxItems: 200);

  Future<List<Subscription>> _listPages(
      {String? status, required int maxItems}) async {
    final all = <Subscription>[];
    final seenCursors = <String>{};
    final seenIds = <String>{};
    String? cursor;
    while (true) {
      final response = await _api.get('money/subscriptions', query: {
        if (status != null) 'status': status,
        'limit': '100',
        if (cursor != null) 'cursor': cursor,
      });
      if (response is! Map<String, dynamic> ||
          response['subscriptions'] is! List<dynamic> ||
          response['meta'] is! Map<String, dynamic>) {
        throw const FormatException('Invalid subscription page');
      }
      final items = response['subscriptions'] as List<dynamic>;
      for (final value in items) {
        final item = Subscription.fromJson(value as Map<String, dynamic>);
        if (!seenIds.add(item.id) ||
            !RegExp(r'^\d+\.\d{4}$').hasMatch(item.monthlyEquivalent) ||
            (status != null && item.status != status)) {
          throw const FormatException('Invalid or duplicate subscription');
        }
        all.add(item);
      }
      if (all.length > maxItems) {
        throw const FormatException('Too many subscriptions');
      }
      final meta = response['meta'] as Map<String, dynamic>;
      if (meta['hasMore'] == false) return all;
      final next = meta['nextCursor'];
      if (meta['hasMore'] != true ||
          items.isEmpty ||
          next is! String ||
          next.isEmpty ||
          !seenCursors.add(next)) {
        throw const FormatException('Invalid subscription cursor');
      }
      cursor = next;
    }
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
}
