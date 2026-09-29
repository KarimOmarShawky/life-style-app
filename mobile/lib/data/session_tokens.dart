import 'dart:convert';

class SessionTokens {
  const SessionTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.accessTokenExpiresAt,
    required this.refreshTokenExpiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime accessTokenExpiresAt;
  final DateTime refreshTokenExpiresAt;

  factory SessionTokens.fromJson(Map<String, dynamic> json) => SessionTokens(
        accessToken: _requiredString(json, 'accessToken'),
        refreshToken: _requiredString(json, 'refreshToken'),
        accessTokenExpiresAt: _requiredDate(json, 'accessTokenExpiresAt'),
        refreshTokenExpiresAt: _requiredDate(json, 'refreshTokenExpiresAt'),
      );

  Map<String, Object> toJson() => {
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'accessTokenExpiresAt': accessTokenExpiresAt.toUtc().toIso8601String(),
        'refreshTokenExpiresAt': refreshTokenExpiresAt.toUtc().toIso8601String(),
      };

  String encode() => jsonEncode(toJson());

  static SessionTokens decode(String value) {
    final decoded = jsonDecode(value);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Invalid secure session data.');
    }
    return SessionTokens.fromJson(decoded);
  }
}

String _requiredString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String || value.isEmpty) {
    throw FormatException('Missing or invalid $key.');
  }
  return value;
}

DateTime _requiredDate(Map<String, dynamic> json, String key) {
  final value = DateTime.tryParse(_requiredString(json, key));
  if (value == null) {
    throw FormatException('Missing or invalid $key.');
  }
  return value.toUtc();
}
