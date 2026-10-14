class Subscription {
  const Subscription({
    required this.id,
    required this.name,
    required this.amount,
    required this.currency,
    required this.billingUnit,
    required this.billingInterval,
    required this.nextBillingDate,
    required this.status,
    required this.monthlyEquivalent,
    required this.daysUntilNextBilling,
    required this.version,
  });

  final String id;
  final String name;
  final String amount;
  final String currency;
  final String billingUnit;
  final int billingInterval;
  final String nextBillingDate;
  final String status;
  final String monthlyEquivalent;
  final int daysUntilNextBilling;
  final int version;

  factory Subscription.fromJson(Map<String, dynamic> json) => Subscription(
        id: _string(json, 'id'),
        name: _string(json, 'name'),
        amount: _string(json, 'amount'),
        currency: _string(json, 'currency'),
        billingUnit: _string(json, 'billingUnit'),
        billingInterval: _int(json, 'billingInterval'),
        nextBillingDate: _string(json, 'nextBillingDate'),
        status: _string(json, 'status'),
        monthlyEquivalent: _string(json, 'monthlyEquivalent'),
        daysUntilNextBilling: _int(json, 'daysUntilNextBilling'),
        version: _int(json, 'version'),
      );
}

String _string(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String) throw FormatException('Missing or invalid $key.');
  return value;
}

int _int(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! int) throw FormatException('Missing or invalid $key.');
  return value;
}
