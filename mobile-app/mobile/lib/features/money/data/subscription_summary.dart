import 'package:lifestyle_mobile/features/money/data/subscription_model.dart';

/// Adds the server's four-place monthly equivalents exactly, per currency.
/// No currency conversion is inferred, and inactive subscriptions are excluded.
Map<String, String> monthlySubscriptionTotals(Iterable<Subscription> items) {
  final unitsByCurrency = <String, BigInt>{};
  final scale = BigInt.from(10000);
  for (final item in items) {
    if (item.status != 'active') continue;
    final value = item.monthlyEquivalent;
    if (!RegExp(r'^\d+\.\d{4}$').hasMatch(value)) {
      throw const FormatException('Invalid monthly subscription equivalent');
    }
    final parts = value.split('.');
    final units = BigInt.parse(parts[0]) * scale + BigInt.parse(parts[1]);
    unitsByCurrency.update(item.currency, (current) => current + units,
        ifAbsent: () => units);
  }
  final currencies = unitsByCurrency.keys.toList()..sort();
  return {
    for (final currency in currencies)
      currency:
          '${unitsByCurrency[currency]! ~/ scale}.${(unitsByCurrency[currency]! % scale).toString().padLeft(4, '0')}'
  };
}
