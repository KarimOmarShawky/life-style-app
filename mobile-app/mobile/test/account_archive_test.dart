// Authored Flutter/Dart tests; syntax parsing/Node fixture checks are NOT execution.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/core/archive/archive_cancellation.dart';
import 'package:lifestyle_mobile/core/archive/archive_export.dart';
import 'package:lifestyle_mobile/core/archive/archive_verifier.dart';

const userId = '00000000-0000-4000-8000-000000000001';
List<int> fixture() =>
    File('test/fixtures/account_archive_v1.ndjson').readAsBytesSync();
List<int> rewrite(void Function(List<Map<String, dynamic>>) change) {
  final rows = const LineSplitter()
      .convert(utf8.decode(fixture()))
      .map((line) => jsonDecode(line) as Map<String, dynamic>)
      .toList();
  rows.removeLast();
  change(rows);
  final body = rows.map((row) => '${jsonEncode(row)}\n').join();
  final counts = {
    for (final section in archiveSectionsV1)
      section: rows.where((r) => r['section'] == section).length
  };
  return utf8.encode('$body${jsonEncode({
        'type': 'complete',
        'counts': counts,
        'records': rows.length - 1,
        'bytesBeforeComplete': utf8.encode(body).length,
        'sha256': sha256.convert(utf8.encode(body)).toString()
      })}\n');
}

void main() {
  test(
      'exact bytes, multibyte boundaries, decimal strings and whole-file digest verify',
      () {
    final bytes = fixture(), verifier = ArchiveVerifier(expectedUserId: userId);
    for (final byte in bytes) {
      verifier.add([byte]);
    }
    final info = verifier.finish();
    expect(info.records, 3);
    expect(info.counts['notes'], 1);
    expect(info.fileSha256, sha256.convert(bytes).toString());
    expect(info.bytes, bytes.length);
  });
  for (final size in [1, 7, 127, 1024]) {
    test('chunk size $size is independent of framing and UTF-8 boundaries', () {
      final bytes = fixture(), parser = ArchiveVerifier(expectedUserId: userId);
      for (var at = 0; at < bytes.length; at += size) {
        parser.add(bytes.sublist(
            at, at + size < bytes.length ? at + size : bytes.length));
      }
      expect(parser.finish().records, 3);
    });
  }
  test('missing footer or final LF is never successful', () {
    final bytes = fixture();
    final truncated = ArchiveVerifier(expectedUserId: userId)
      ..add(bytes.sublist(0, bytes.length - 1));
    expect(truncated.finish, throwsA(isA<ArchiveException>()));
    final noFooter = ArchiveVerifier(expectedUserId: userId)
      ..add(utf8
          .encode('${utf8.decode(bytes).split('\n').take(4).join('\n')}\n'));
    expect(noFooter.finish, throwsA(isA<ArchiveException>()));
  });
  test('hash/counters cannot be normalized or mismatched', () {
    for (final field in [
      'sha256',
      'records',
      'bytesBeforeComplete',
      'counts'
    ]) {
      final lines = utf8.decode(fixture()).trimRight().split('\n'),
          footer = jsonDecode(lines.removeLast()) as Map<String, dynamic>;
      footer[field] = field == 'sha256'
          ? '0' * 64
          : field == 'counts'
              ? <String, int>{}
              : 0;
      final verifier = ArchiveVerifier(expectedUserId: userId);
      expect(
          () => verifier
              .add(utf8.encode('${lines.join('\n')}\n${jsonEncode(footer)}\n')),
          throwsA(isA<ArchiveException>()));
    }
  });
  test('duplicate footer, appended bytes and blank lines are rejected', () {
    for (final suffix in [
      utf8.encode('\n'),
      utf8.encode('x'),
      utf8.encode('${utf8.decode(fixture()).trimRight().split('\n').last}\n')
    ]) {
      final verifier = ArchiveVerifier(expectedUserId: userId)..add(fixture());
      expect(() => verifier.add(suffix), throwsA(isA<ArchiveException>()));
    }
  });
  test(
      'wrong authenticated profile, unsupported version/section/order and credential columns reject even with recomputed hash',
      () {
    for (final change in <void Function(List<Map<String, dynamic>>)>[
      (rows) => (rows[1]['data'] as Map)['id'] =
          '00000000-0000-4000-8000-000000000099',
      (rows) => rows[0]['version'] = 2,
      (rows) => rows[2]['section'] = 'refresh_tokens',
      (rows) {
        final row = rows.removeAt(2);
        rows.add(row);
      },
      (rows) => (rows[1]['data'] as Map)['password_hash'] =
          'synthetic-protected-material',
      (rows) => (rows[3]['data'] as Map)['amount'] = 1.23,
    ]) {
      expect(() => ArchiveVerifier(expectedUserId: userId).add(rewrite(change)),
          throwsA(isA<ArchiveException>()));
    }
  });
  test('invalid UTF-8 and line/chunk size bounds fail safely', () {
    expect(() => ArchiveVerifier(expectedUserId: userId).add([255, 10]),
        throwsA(isA<ArchiveException>()));
    expect(
        () => ArchiveVerifier(expectedUserId: userId)
            .add(List.filled(ArchiveVerifier.maxChunkBytes + 1, 32)),
        throwsA(isA<ArchiveException>()));
    final verifier = ArchiveVerifier(expectedUserId: userId);
    expect(() {
      for (var i = 0; i < 17; i++) {
        verifier.add(List.filled(65536, 32));
      }
    }, throwsA(isA<ArchiveException>()));
  });
  test(
      'coordinator stages/verifies incrementally, never saves without a later explicit action',
      () async {
    final staging = FakeStaging(), cancel = ArchiveCancellation();
    final prepared = await prepareAccountArchive(
        source: () => Stream.value(fixture()),
        userId: userId,
        staging: staging,
        cancel: cancel);
    expect(staging.saves, 0);
    expect(staging.sealed, true);
    staging.saveResult = false;
    expect(await prepared.save(), false);
    expect(staging.discards, 0);
    staging.saveResult = true;
    expect(await prepared.save(), true);
    await prepared.discard();
    expect(staging.discards, 0);
    cancel.cancel();
  });
  test(
      'partial stream, sink failure and cancellation discard only the owned stage, never save',
      () async {
    for (final failure in ['partial', 'sink', 'cancel']) {
      final staging = FakeStaging(), cancel = ArchiveCancellation();
      staging.failAppend = failure == 'sink';
      Stream<List<int>> source() async* {
        yield failure == 'partial' ? fixture().sublist(0, 100) : fixture();
        if (failure == 'cancel') cancel.cancel();
      }

      await expectLater(
          prepareAccountArchive(
              source: source, userId: userId, staging: staging, cancel: cancel),
          throwsA(anything));
      expect(staging.discards, 1);
      expect(staging.saves, 0);
      expect(staging.sealed, false);
    }
  });
  test('unsupported platform never downloads or creates a stage', () async {
    final stage = FakeStaging()..isSupported = false;
    await expectLater(
        prepareAccountArchive(
            source: () => throw StateError('must not download'),
            userId: userId,
            staging: stage,
            cancel: ArchiveCancellation()),
        throwsA(isA<ArchiveException>()));
    expect(stage.begins, 0);
  });
}

class FakeStaging implements ArchiveStaging {
  bool isSupported = true,
      sealed = false,
      saveResult = true,
      failAppend = false;
  int begins = 0, saves = 0, discards = 0;
  final bytes = BytesBuilder();
  @override
  bool get supported => isSupported;
  @override
  Future<String> begin() async {
    begins++;
    return 'stage-owned-by-test';
  }

  @override
  Future<void> append(String id, Uint8List chunk) async {
    expect(id, 'stage-owned-by-test');
    expect(chunk.length, lessThanOrEqualTo(32768));
    if (failAppend) {
      throw StateError('synthetic sink failure');
    }
    bytes.add(chunk);
  }

  @override
  Future<void> seal(String id, VerifiedArchiveInfo info) async {
    expect(info.fileSha256, sha256.convert(bytes.toBytes()).toString());
    sealed = true;
  }

  @override
  Future<bool> save(String id) async {
    expect(sealed, true);
    saves++;
    return saveResult;
  }

  @override
  Future<void> discard(String id) async {
    expect(id, 'stage-owned-by-test');
    discards++;
  }
}
