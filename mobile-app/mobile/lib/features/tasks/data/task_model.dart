class Task {
  const Task({
    required this.id,
    required this.title,
    required this.status,
    required this.priority,
    required this.version,
    this.dueDate,
    this.dueTime,
    this.recurringTaskId,
    this.completedAt,
  });

  final String id;
  final String title;
  final String status;
  final String priority;
  final int version;
  final String? dueDate;
  final String? dueTime;
  final String? recurringTaskId;
  final DateTime? completedAt;

  bool get isDone => status == 'done';

  factory Task.fromJson(Map<String, dynamic> json) => Task(
        id: _string(json, 'id'),
        title: _string(json, 'title'),
        status: _string(json, 'status'),
        priority: _string(json, 'priority'),
        version: _int(json, 'version'),
        dueDate: json['dueDate'] is String ? json['dueDate'] as String : null,
        recurringTaskId: json['recurringTaskId'] as String?,
        completedAt: json['completedAt'] is String
            ? DateTime.parse(json['completedAt'] as String)
            : null,
        dueTime: json['dueTime'] is String ? json['dueTime'] as String : null,
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
