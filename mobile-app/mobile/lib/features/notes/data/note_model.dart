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
