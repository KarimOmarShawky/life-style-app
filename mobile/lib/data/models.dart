class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.displayName,
    required this.timezone,
    required this.locale,
    required this.defaultCurrency,
    required this.status,
  });

  final String id;
  final String email;
  final String displayName;
  final String timezone;
  final String locale;
  final String defaultCurrency;
  final String status;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
    id: _string(json, 'id'),
    email: _string(json, 'email'),
    displayName: _string(json, 'displayName'),
    timezone: _string(json, 'timezone'),
    locale: _string(json, 'locale'),
    defaultCurrency: _string(json, 'defaultCurrency'),
    status: _string(json, 'status'),
  );
}

class Task {
  const Task({
    required this.id,
    required this.title,
    required this.status,
    required this.priority,
    required this.version,
    this.dueDate,
  });

  final String id;
  final String title;
  final String status;
  final String priority;
  final int version;
  final String? dueDate;

  bool get isDone => status == 'done';

  factory Task.fromJson(Map<String, dynamic> json) => Task(
    id: _string(json, 'id'),
    title: _string(json, 'title'),
    status: _string(json, 'status'),
    priority: _string(json, 'priority'),
    version: _int(json, 'version'),
    dueDate: json['dueDate'] is String ? json['dueDate'] as String : null,
  );
}

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

class Habit {
  const Habit({
    required this.id,
    required this.name,
    this.description,
    required this.status,
    required this.currentStreak,
    required this.longestStreak,
    required this.version,
  });

  final String id;
  final String name;
  final String? description;
  final String status;
  final int currentStreak;
  final int longestStreak;
  final int version;

  factory Habit.fromJson(Map<String, dynamic> json) => Habit(
    id: _string(json, 'id'),
    name: _string(json, 'name'),
    description: json['description'] is String
        ? json['description'] as String
        : null,
    status: _string(json, 'status'),
    currentStreak: _int(json, 'currentStreak'),
    longestStreak: _int(json, 'longestStreak'),
    version: _int(json, 'version'),
  );
}

class Note {
  const Note({
    required this.id,
    required this.title,
    required this.body,
    required this.tags,
    required this.isPinned,
    required this.updatedAt,
    required this.version,
  });

  final String id;
  final String title;
  final String body;
  final List<String> tags;
  final bool isPinned;
  final String updatedAt;
  final int version;

  factory Note.fromJson(Map<String, dynamic> json) => Note(
    id: _string(json, 'id'),
    title: _string(json, 'title'),
    body: _string(json, 'body'),
    tags:
        (json['tags'] as List<dynamic>?)?.map((e) => e.toString()).toList() ??
        const [],
    isPinned: json['isPinned'] == true,
    updatedAt: _string(json, 'updatedAt'),
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
