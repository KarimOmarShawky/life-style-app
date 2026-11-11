import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';

/// One signed-in device (feature guide G6, ADR-047). Metadata only: the API
/// never returns IP addresses or tokens.
class SignedInDevice {
  const SignedInDevice({
    required this.id,
    required this.platform,
    required this.deviceName,
    required this.appVersion,
    required this.createdAt,
    required this.lastUsedAt,
    required this.current,
  });

  factory SignedInDevice.fromJson(Map<Object?, Object?> json) {
    return SignedInDevice(
      id: json['id'] as String,
      platform: json['devicePlatform'] as String? ?? 'unknown',
      deviceName: json['deviceName'] as String?,
      appVersion: json['appVersion'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
      lastUsedAt: DateTime.parse(json['lastUsedAt'] as String).toLocal(),
      current: json['current'] == true,
    );
  }

  final String id;
  final String platform;
  final String? deviceName;
  final String? appVersion;
  final DateTime createdAt;
  final DateTime lastUsedAt;

  /// The session this app is using.
  final bool current;
}

class SignedInDevices {
  const SignedInDevices({required this.devices, required this.truncated});

  final List<SignedInDevice> devices;

  /// More active sessions exist than the server listed.
  final bool truncated;
}

/// `GET /sessions` and `POST /sessions/{id}/revoke`.
abstract class SessionsClient {
  Future<SignedInDevices> list();

  /// Signs one device out after the password check. True when it was this
  /// device.
  Future<bool> revoke(String sessionId, String currentPassword);
}

class ApiSessionsClient implements SessionsClient {
  ApiSessionsClient(this._api);

  final ApiClient _api;

  @override
  Future<SignedInDevices> list() async {
    final data = await _api.get('sessions');
    if (data is! Map<Object?, Object?>) {
      throw const FormatException('Unexpected sessions response');
    }
    final devices = <SignedInDevice>[];
    final items = data['sessions'];
    if (items is List<Object?>) {
      for (final item in items) {
        if (item is Map<Object?, Object?>) {
          devices.add(SignedInDevice.fromJson(item));
        }
      }
    }
    return SignedInDevices(
      devices: devices,
      truncated: data['truncated'] == true,
    );
  }

  @override
  Future<bool> revoke(String sessionId, String currentPassword) async {
    final data = await _api.post(
      'sessions/${Uri.encodeComponent(sessionId)}/revoke',
      body: {'currentPassword': currentPassword},
    );
    return data is Map<Object?, Object?> && data['current'] == true;
  }
}

final sessionsClientProvider = Provider<SessionsClient>(
  (ref) => ApiSessionsClient(ref.watch(apiClientProvider)),
);
