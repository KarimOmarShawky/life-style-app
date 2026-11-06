import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Test-only channel replacement. It never leaves secrets in preferences.
class FakeSecureStorage {
  static const channel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final values = <String, String>{};
  bool failRead = false;
  int writeAttempts = 0;
  bool failWrite = false;
  bool failDelete = false;
  Completer<void>? writeStarted;
  Completer<void>? finishWrite;

  void install() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      final args =
          (call.arguments as Map<Object?, Object?>?) ?? <Object?, Object?>{};
      final key = args['key'] as String?;
      switch (call.method) {
        case 'read':
          if (failRead) throw PlatformException(code: 'read-failed');
          return key == null ? null : values[key];
        case 'write':
          writeAttempts++;
          if (writeStarted != null && !writeStarted!.isCompleted) {
            writeStarted!.complete();
          }
          if (failWrite) throw PlatformException(code: 'write-failed');
          final value = args['value'] as String?;
          if (key != null && value != null) values[key] = value;
          if (finishWrite != null) await finishWrite!.future;
          return null;
        case 'delete':
          if (failDelete) throw PlatformException(code: 'delete-failed');
          if (key != null) values.remove(key);
          return null;
        case 'deleteAll':
          values.clear();
          return null;
        default:
          return null;
      }
    });
  }
}
