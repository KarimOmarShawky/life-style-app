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
