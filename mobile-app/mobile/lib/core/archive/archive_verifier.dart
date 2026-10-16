import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';

class ArchiveException implements Exception {
  const ArchiveException();
  @override
  String toString() => 'The archive could not be verified or saved.';
}

const archiveSectionsV1 = <String>[
  'profile',
  'sessions',
  'pushDevices',
  'ingestDevices',
  'categories',
  'goals',
  'milestones',
  'projects',
  'recurringTasks',
  'habits',
  'recurrences',
  'tasks',
  'timerSessions',
  'habitCheckins',
  'notes',
  'events',
  'noteLinks',
  'subscriptions',
  'transactions',
  'budgets',
  'reminders',
];

class VerifiedArchiveInfo {
  const VerifiedArchiveInfo(
      {required this.bytes,
      required this.records,
      required this.fileSha256,
      required this.counts});
  final int bytes;
  final int records;
  final String fileSha256;
  final Map<String, int> counts;
}

class _DigestResult implements Sink<Digest> {
  Digest? value;
  @override
  void add(Digest data) => value = data;
  @override
  void close() {}
}

/// Validates exact wire bytes, not re-encoded JSON. Retains at most one bounded
/// line and one decoded record; never accumulates an account or its archive.
class ArchiveVerifier {
  ArchiveVerifier({required this.expectedUserId}) {
    _prefix = sha256.startChunkedConversion(_prefixResult);
    _file = sha256.startChunkedConversion(_fileResult);
  }
  static const maxBytes = 128 * 1024 * 1024;
  static const maxLineBytes = 1024 * 1024;
  static const maxChunkBytes = 64 * 1024;
  final String expectedUserId;
  final _prefixResult = _DigestResult();
  final _fileResult = _DigestResult();
  late final ByteConversionSink _prefix;
  late final ByteConversionSink _file;
  final _line = BytesBuilder(copy: false);
  final _counts = {for (final section in archiveSectionsV1) section: 0};
  int _bytes = 0,
      _hashedBytes = 0,
      _lineBytes = 0,
      _records = 0,
      _sectionIndex = -1;
  String? _lastId;
  bool _manifest = false, _complete = false, _finished = false, _failed = false;

  void add(List<int> bytes) {
    try {
      if (_finished || _failed || bytes.length > maxChunkBytes) {
        throw const ArchiveException();
      }
      _bytes += bytes.length;
      if (_bytes > maxBytes) {
        throw const ArchiveException();
      }
      _file.add(bytes);
      var start = 0;
      for (var i = 0; i < bytes.length; i++) {
        if (bytes[i] != 10) continue;
        _append(bytes.sublist(start, i));
        _acceptLine(_line.takeBytes());
        _lineBytes = 0;
        start = i + 1;
      }
      if (start < bytes.length) _append(bytes.sublist(start));
    } on Object {
      _failed = true;
      throw const ArchiveException(); // Never expose decoded personal text/parser diagnostics.
    }
  }

  void _append(List<int> part) {
    _lineBytes += part.length;
    if (_lineBytes > maxLineBytes || _complete && part.isNotEmpty) {
      throw const ArchiveException();
    }
    _line.add(part);
  }

  void _acceptLine(Uint8List bytes) {
    if (bytes.isEmpty || _complete) {
      throw const ArchiveException();
    }
    final frame = jsonDecode(utf8.decode(bytes, allowMalformed: false));
    if (frame is! Map<String, dynamic>) {
      throw const ArchiveException();
    }
    switch (frame['type']) {
      case 'manifest':
        if (_manifest ||
            _records != 0 ||
            frame['format'] != 'lifestyle-domain-archive' ||
            frame['version'] is! int ||
            frame['version'] != 1 ||
            frame['snapshot'] != 'repeatable-read' ||
            frame['sections'] is! List ||
            jsonEncode(frame['sections']) != jsonEncode(archiveSectionsV1) ||
            frame['includesSoftDeleted'] != true ||
            frame['exclusions'] is! List) {
          throw const ArchiveException();
        }
        _manifest = true;
      case 'record':
        if (bytes.length > 512 * 1024 + 1024) {
          throw const ArchiveException();
        }
        if (!_manifest) {
          throw const ArchiveException();
        }
        final section = frame['section'];
        final data = frame['data'];
        final index =
            section is String ? archiveSectionsV1.indexOf(section) : -1;
        if (index < 0 ||
            index < _sectionIndex ||
            data is! Map<String, dynamic>) {
          throw const ArchiveException();
        }
        final id = data['id'];
        if (id is! String ||
            !RegExp(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
                .hasMatch(id)) {
          throw const ArchiveException();
        }
        if (index == _sectionIndex &&
            _lastId != null &&
            id.compareTo(_lastId!) <= 0) {
          throw const ArchiveException();
        }
        if (section == 'profile' &&
            (id != expectedUserId || _counts['profile'] != 0)) {
          throw const ArchiveException();
        }
        if (section != 'profile' && _counts['profile'] != 1) {
          throw const ArchiveException();
        }
        for (final column in [
          'password_hash',
          'token_hash',
          'push_token',
          'idempotency_fingerprint'
        ]) {
          if (data.containsKey(column)) {
            throw const ArchiveException();
          }
        }
        final decimalFields = switch (section) {
          'transactions' || 'subscriptions' => ['amount'],
          'budgets' => ['amount_limit'],
          'goals' => ['target_value', 'current_value'],
          _ => <String>[],
        };
        for (final field in decimalFields) {
          if (!data.containsKey(field) ||
              data[field] != null && data[field] is! String) {
            throw const ArchiveException();
          }
        }
        _sectionIndex = index;
        _lastId = id;
        _counts[section as String] = _counts[section]! + 1;
        _records++;
      case 'complete':
        final counts = frame['counts'];
        if (!_manifest ||
            _counts['profile'] != 1 ||
            frame['records'] is! int ||
            frame['bytesBeforeComplete'] is! int ||
            frame['records'] != _records ||
            frame['bytesBeforeComplete'] != _hashedBytes ||
            counts is! Map<String, dynamic> ||
            counts.length != _counts.length) {
          throw const ArchiveException();
        }
        for (final section in archiveSectionsV1) {
          if (counts[section] is! int || counts[section] != _counts[section]) {
            throw const ArchiveException();
          }
        }
        _prefix.close();
        if (frame['sha256'] != _prefixResult.value?.toString()) {
          throw const ArchiveException();
        }
        _complete = true;
        return;
      default:
        throw const ArchiveException();
    }
    _prefix.add(bytes);
    _prefix.add(const [10]);
    _hashedBytes += bytes.length + 1;
  }

  VerifiedArchiveInfo finish() {
    if (_finished || _failed || !_complete || _lineBytes != 0) {
      throw const ArchiveException();
    }
    _finished = true;
    _file.close();
    return VerifiedArchiveInfo(
        bytes: _bytes,
        records: _records,
        fileSha256: _fileResult.value!.toString(),
        counts: Map.unmodifiable(_counts));
  }
}
