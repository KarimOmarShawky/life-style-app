class BudgetUsage {
  const BudgetUsage({
    required this.periodStart,
    required this.periodEnd,
    required this.spent,
    required this.remaining,
    required this.percentUsed,
    required this.overspent,
  });

  final String periodStart;
  final String periodEnd;
  final String spent;
  final String remaining;
  final double percentUsed;
  final bool overspent;

  factory BudgetUsage.fromJson(Map<String, dynamic> json) => BudgetUsage(
    periodStart: _string(json, 'periodStart'),
    periodEnd: _string(json, 'periodEnd'),
    spent: _string(json, 'spent'),
    remaining: _string(json, 'remaining'),
    percentUsed: (json['percentUsed'] as num).toDouble(),
    overspent: json['overspent'] == true,
  );
}

class Budget {
  const Budget({
    required this.id,
    this.categoryId,
    required this.amountLimit,
    required this.currency,
    required this.period,
    required this.usage,
    required this.version,
  });

  final String id;
  final String? categoryId;
  final String amountLimit;
  final String currency;
  final String period;
  final BudgetUsage usage;
  final int version;

  factory Budget.fromJson(Map<String, dynamic> json) => Budget(
    id: _string(json, 'id'),
    categoryId: json['categoryId'] is String
        ? json['categoryId'] as String
        : null,
    amountLimit: _string(json, 'amountLimit'),
    currency: _string(json, 'currency'),
    period: _string(json, 'period'),
    usage: BudgetUsage.fromJson(json['usage'] as Map<String, dynamic>),
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
