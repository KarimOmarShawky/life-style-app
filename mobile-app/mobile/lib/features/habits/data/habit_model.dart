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
