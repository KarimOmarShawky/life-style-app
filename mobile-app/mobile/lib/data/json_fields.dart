import 'package:lifestyle_mobile/data/api_client.dart';

/// Strict readers for JSON returned by the LifeStyle API.
///
/// Missing or mistyped required fields throw, so a malformed payload is reported
/// instead of being silently shown with wrong data.

Map<String, dynamic> jsonObject(Object? value, String name) {
  if (value is Map<String, dynamic>) return value;
  throw ApiException(
    statusCode: 502,
    code: 'INVALID_API_RESPONSE',
    message: 'The server returned an invalid $name.',
  );
}

List<Map<String, dynamic>> jsonObjectList(Object? value, String name) {
  if (value is! List<dynamic>) {
    throw ApiException(
      statusCode: 502,
      code: 'INVALID_API_RESPONSE',
      message: 'The server returned an invalid $name.',
    );
  }
  return value.map((item) => jsonObject(item, name)).toList(growable: false);
}

String jsonString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String) throw FormatException('Missing or invalid $key.');
  return value;
}

String? jsonOptionalString(Map<String, dynamic> json, String key) {
  final value = json[key];
  return value is String && value.isNotEmpty ? value : null;
}

int jsonInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! int) throw FormatException('Missing or invalid $key.');
  return value;
}

int? jsonOptionalInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  return value is int ? value : null;
}

double jsonDouble(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! num) throw FormatException('Missing or invalid $key.');
  return value.toDouble();
}

bool jsonBool(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! bool) throw FormatException('Missing or invalid $key.');
  return value;
}

/// A date-only value (YYYY-MM-DD). It has no time zone and is kept as written.
DateTime? jsonOptionalDate(Map<String, dynamic> json, String key) {
  final value = json[key];
  return value is String ? DateTime.tryParse(value) : null;
}

/// A required instant (ISO-8601). It is converted to local time for display.
DateTime jsonDateTime(Map<String, dynamic> json, String key) {
  final parsed = DateTime.tryParse(jsonString(json, key));
  if (parsed == null) throw FormatException('Missing or invalid $key.');
  return parsed.toLocal();
}

/// An optional instant (ISO-8601). It is converted to local time for display.
DateTime? jsonOptionalDateTime(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String) return null;
  return DateTime.tryParse(value)?.toLocal();
}
