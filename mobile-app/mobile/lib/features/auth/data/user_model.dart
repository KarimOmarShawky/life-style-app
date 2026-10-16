class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.displayName,
    required this.timezone,
    required this.locale,
    required this.defaultCurrency,
    required this.status,
    this.weekStart = 1,
    this.pushShowTitles = true,
    this.deletionScheduledFor,
  });

  final String id;
  final String email;
  final String displayName;
  final String timezone;
  final String locale;
  final String defaultCurrency;
  final String status;
  final int weekStart;
  final bool pushShowTitles;
  final DateTime? deletionScheduledFor;

  bool get isPendingDeletion => status == 'pending_deletion';

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: _string(json, 'id'),
        email: _string(json, 'email'),
        displayName: _string(json, 'displayName'),
        timezone: _string(json, 'timezone'),
        locale: _string(json, 'locale'),
        defaultCurrency: _string(json, 'defaultCurrency'),
        status: _string(json, 'status'),
        weekStart: (json['weekStart'] as num?)?.toInt() ?? 1,
        pushShowTitles: (json['pushShowTitles'] as bool?) ?? true,
        deletionScheduledFor: _optionalDateTime(json, 'deletionScheduledFor'),
      );
}

String _string(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String) throw FormatException('Missing or invalid $key.');
  return value;
}

DateTime? _optionalDateTime(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String || value.isEmpty) return null;
  return DateTime.tryParse(value)?.toLocal();
}
