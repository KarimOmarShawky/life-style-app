import 'dart:async';
import 'package:flutter/services.dart';
import 'focus_shield_models.dart';

abstract class FocusShieldPlatform {
  Stream<Map<String, dynamic>> get events;
  Future<Map<String, dynamic>> invoke(String method,
      [Map<String, Object?> arguments = const {}]);
  Future<ShieldState> getShieldState() async =>
      ShieldState.fromJson(await invoke('getShieldState'));
  Future<ReplyResult> sendReply(String key, String text) async {
    final result = await invoke('sendReply', {'key': key, 'text': text});
    return ReplyResult.values.byName(result['result'] as String);
  }
}

class MethodChannelFocusShieldPlatform extends FocusShieldPlatform {
  static const channelName = 'com.example.lifestyle_mobile/focus_shield';
  static const _methods = MethodChannel(channelName);
  static const _events = EventChannel('$channelName/events');
  @override
  Stream<Map<String, dynamic>> get events =>
      _events.receiveBroadcastStream(const {'schemaVersion': 1}).map((event) {
        final data = Map<String, dynamic>.from(event as Map<Object?, Object?>);
        if (data['schemaVersion'] != 1) {
          throw const FormatException('Unknown shield event schema');
        }
        return data;
      });
  @override
  Future<Map<String, dynamic>> invoke(String method,
      [Map<String, Object?> arguments = const {}]) async {
    final result = await _methods.invokeMapMethod<String, dynamic>(
        method, {...arguments, 'schemaVersion': 1});
    if (result == null || result['schemaVersion'] != 1) {
      throw const FormatException('Unknown shield response schema');
    }
    return result;
  }
}

/// Tests inject this platform; production never silently falls back to it.
class FakeFocusShieldPlatform extends FocusShieldPlatform {
  final controller = StreamController<Map<String, dynamic>>.broadcast();
  ShieldState shield = const ShieldState();
  ReplyResult replyResult = ReplyResult.sent;
  final calls = <String>[];
  @override
  Stream<Map<String, dynamic>> get events => controller.stream;
  @override
  Future<Map<String, dynamic>> invoke(String method,
      [Map<String, Object?> arguments = const {}]) async {
    calls.add(method);
    if (method == 'startShield') {
      shield = ShieldState(
          active: true,
          sessionId: arguments['sessionId'] as String,
          taskTitle: arguments['taskTitle'] as String,
          endTimestampMs: arguments['endTimestampMs'] as int);
    } else if (method == 'stopShield') {
      shield = ShieldState(
          sessionId: shield.sessionId,
          blockedAttemptsCount: shield.blockedAttemptsCount,
          manualBypassesCount: shield.manualBypassesCount,
          endReason: arguments['reason'] as String? ?? 'manual');
    }
    return {
      'schemaVersion': 1,
      'active': shield.active,
      'sessionId': shield.sessionId,
      'taskTitle': shield.taskTitle,
      'endTimestampMs': shield.endTimestampMs,
      'blockedAttemptsCount': shield.blockedAttemptsCount,
      'manualBypassesCount': shield.manualBypassesCount,
      'endReason': shield.endReason,
      if (method == 'sendReply') 'result': replyResult.name,
      if (method == 'getInstalledApps') 'apps': <Object>[],
      if (method == 'getPermissionStatus') ...{
        'accessibility': true,
        'notificationListener': true,
        'notifications': true,
      },
    };
  }

  Future<void> dispose() => controller.close();
}
