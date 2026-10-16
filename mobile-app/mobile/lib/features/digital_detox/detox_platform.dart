import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../focus_shield/focus_shield_platform.dart';
import 'detox_session.dart';

class SecureDetoxStore implements DetoxStore {
  SecureDetoxStore(String accountId) : key = 'lifestyle.detox.v1.$accountId';
  final String key;
  static const storage = FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );
  @override
  Future<String?> read() => storage.read(key: key);
  @override
  Future<void> write(String snapshot) =>
      storage.write(key: key, value: snapshot);
  @override
  Future<void> clear() => storage.delete(key: key);
}

class AndroidDetoxEnforcer implements DetoxEnforcer {
  AndroidDetoxEnforcer(this.platform);
  final FocusShieldPlatform platform;
  bool get supported => Platform.isAndroid;
  static const unsupported = RestrictionResult(
    RestrictionStatus.unavailable,
    'Application restriction is unavailable on this platform. No device lock is provided.',
  );
  RestrictionResult _result(Map<String, dynamic> json) => RestrictionResult(
        RestrictionStatus.values.byName(json['status'] as String),
        json['detail'] as String,
      );
  @override
  Future<RestrictionResult> apply(
    String id,
    DetoxMode mode,
    Set<String> packages,
    DateTime end,
  ) async {
    if (!supported) return unsupported;
    return _result(
      await platform.invoke('startDetox', {
        'sessionId': id,
        'mode': mode.name,
        'packages': packages.toList(),
        'endTimestampMs': end.millisecondsSinceEpoch,
      }),
    );
  }

  @override
  Future<RestrictionResult> query(String id) async {
    if (!supported) return unsupported;
    return _result(await platform.invoke('detoxStatus', {'sessionId': id}));
  }

  @override
  Future<RestrictionResult> release(String id) async {
    if (!supported)
      return const RestrictionResult(
        RestrictionStatus.off,
        'No native restriction was applied',
      );
    return _result(await platform.invoke('stopDetox', {'sessionId': id}));
  }

  @override
  Future<void> releaseOrphan() async {
    if (supported) await platform.invoke('clearOrphanDetox');
  }

  Future<List<Map<String, String>>> apps() async {
    if (!supported)
      throw UnsupportedError('No system application selection is available.');
    final result = await platform.invoke('getDetoxApps');
    return (result['apps'] as List)
        .map((app) => Map<String, String>.from(app as Map))
        .toList();
  }
}
