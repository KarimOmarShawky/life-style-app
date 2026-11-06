import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_model.dart';
import 'package:lifestyle_mobile/features/money/data/subscription_summary.dart';

Subscription _item(String id, String currency, String monthly,
        {String status = 'active'}) =>
    Subscription(
      id: id,
      name: id,
      amount: '1.00',
      currency: currency,
      billingUnit: 'month',
      billingInterval: 3,
      anchorDate: '2026-01-01',
      nextBillingDate: '2026-01-01',
      status: status,
      monthlyEquivalent: monthly,
      daysUntilNextBilling: 0,
      version: 1,
    );

void main() {
  test('totals exact monthly equivalents by currency for active subscriptions',
      () {
    final totals = monthlySubscriptionTotals([
      _item('a', 'USD', '900719925474099.1234'),
      _item('b', 'USD', '0.0006'),
      _item('c', 'EGP', '10.0000'),
      _item('d', 'USD', '200.0000', status: 'paused'),
      _item('e', 'USD', '500.0000', status: 'cancelled'),
    ]);
    expect(totals, {'EGP': '10.0000', 'USD': '900719925474099.1240'});
  });
  test('rejects malformed monthly amounts instead of displaying a false zero',
      () {
    expect(() => monthlySubscriptionTotals([_item('a', 'USD', 'NaN')]),
        throwsFormatException);
  });
}
