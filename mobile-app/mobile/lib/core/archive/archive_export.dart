import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'archive_cancellation.dart';
import 'archive_verifier.dart';

abstract interface class ArchiveStaging {
  bool get supported;
  Future<String> begin();
  Future<void> append(String id, Uint8List bytes);
  Future<void> seal(String id, VerifiedArchiveInfo info);
  Future<bool> save(
      String id); // false = picker cancelled, never saved success.
  Future<void> discard(String id);
}

class AndroidArchiveStaging implements ArchiveStaging {
  const AndroidArchiveStaging();
  static const _channel = MethodChannel('lifestyle/account_archive');
  @override
  bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  @override
  Future<String> begin() async {
    if (!supported) {
      throw const ArchiveException();
    }
    final id = await _channel.invokeMethod<String>('begin');
    if (id == null || !RegExp(r'^[0-9a-f-]{36}$').hasMatch(id)) {
      throw const ArchiveException();
    }
    return id;
  }

  @override
  Future<void> append(String id, Uint8List bytes) =>
      _channel.invokeMethod<void>('append', {'id': id, 'bytes': bytes});
  @override
  Future<void> seal(String id, VerifiedArchiveInfo info) =>
      _channel.invokeMethod<void>('seal', {
        'id': id,
        'bytes': info.bytes,
        'sha256': info.fileSha256,
      });
  @override
  Future<bool> save(String id) async {
    final status = await _channel.invokeMethod<String>('save', {'id': id});
    if (status == 'saved') {
      return true;
    }
    if (status == 'cancelled') {
      return false;
    }
    throw const ArchiveException();
  }

  @override
  Future<void> discard(String id) =>
      _channel.invokeMethod<void>('discard', {'id': id});
}

class PreparedArchive {
  PreparedArchive(this._staging, this._id, this.info);
  final ArchiveStaging _staging;
  final String _id;
  final VerifiedArchiveInfo info;
  bool _closed = false;
  Future<bool> save() async {
    if (_closed) {
      throw const ArchiveException();
    }
    final saved = await _staging.save(_id);
    if (saved) _closed = true;
    return saved;
  }

  Future<void> discard() async {
    if (_closed) {
      return;
    }
    await _staging.discard(_id);
    _closed = true;
  }
}

/// Validated bytes are staged encrypted, not collected in Dart or passed through
/// the platform codec as a whole file. Save is a separate user action after EOF.
Future<PreparedArchive> prepareAccountArchive({
  required Stream<List<int>> Function() source,
  required String userId,
  required ArchiveStaging staging,
  required ArchiveCancellation cancel,
  void Function(int bytes)? onProgress,
}) async {
  if (!staging.supported) {
    throw const ArchiveException();
  }
  String? id;
  var transferred = false;
  final verifier = ArchiveVerifier(expectedUserId: userId);
  final pending = BytesBuilder(copy: false);
  var received = 0;
  try {
    cancel.check();
    id = await staging.begin();
    cancel.check();
    await for (final chunk in source()) {
      cancel.check();
      verifier.add(chunk);
      received += chunk.length;
      var start = 0;
      while (start < chunk.length) {
        final capacity = 32 * 1024 - pending.length;
        final end =
            start + capacity < chunk.length ? start + capacity : chunk.length;
        pending.add(chunk.sublist(start, end));
        start = end;
        if (pending.length == 32 * 1024) {
          await cancel.bind(staging.append(id, pending.takeBytes()));
        }
      }
      onProgress?.call(received);
    }
    cancel.check();
    final info = verifier.finish();
    if (pending.isNotEmpty) {
      await cancel.bind(staging.append(id, pending.takeBytes()));
    }
    await cancel.bind(staging.seal(id, info));
    cancel.check();
    transferred = true;
    return PreparedArchive(staging, id, info);
  } finally {
    if (id != null && !transferred) await staging.discard(id);
  }
}
