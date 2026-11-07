import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

/// Controllable offline transport for streaming behavior tests.
class _StreamTransport implements AiTransport {
  _StreamTransport(this.chunks, {this.error});

  final List<String> chunks;
  final AiTransportException? error;

  @override
  Future<String> chat({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final failure = error;
    if (failure != null) throw failure;
    return chunks.join();
  }

  @override
  Stream<String> chatStream({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    final failure = error;
    if (failure != null) throw failure;
    for (final chunk in chunks) {
      yield chunk;
    }
  }
}

class _StreamResult {
  _StreamResult(this.chunks, this.error);

  final List<String> chunks;
  final Object? error;
}

Future<_StreamResult> _collect(AiService service) async {
  final chunks = <String>[];
  Object? failure;
  try {
    await for (final chunk in service.streamMessage(
      conversationHistory: const [],
      newMessage: 'Hello',
      languageName: 'English',
    )) {
      chunks.add(chunk);
    }
  } catch (error) {
    failure = error;
  }
  return _StreamResult(chunks, failure);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('chunks are emitted incrementally and in order (incl. Arabic)',
      () async {
    final source = StreamController<String>();
    final service = AiService.forTesting(
      transport: _ControlledStreamTransport(source.stream),
    );
    final chunks = <String>[];
    final firstChunk = Completer<void>();
    final finished = Completer<void>();
    Object? failure;
    final subscription = service.streamMessage(
      conversationHistory: const [],
      newMessage: 'Hello',
      languageName: 'English',
    ).listen((chunk) {
      chunks.add(chunk);
      if (!firstChunk.isCompleted) firstChunk.complete();
    }, onError: (Object error) {
      failure = error;
    }, onDone: () {
      if (!finished.isCompleted) finished.complete();
    });

    try {
      source.add('أهلاً');
      await firstChunk.future.timeout(const Duration(seconds: 3));
      expect(chunks, ['أهلاً']);
      source.add(' there');
      source.add('!');
      await source.close();
      await finished.future.timeout(const Duration(seconds: 3));
      expect(failure, isNull);
      expect(chunks, ['أهلاً', ' there', '!']);
    } finally {
      if (!source.isClosed) await source.close();
      await subscription.cancel();
    }
  });

  test('an empty stream reports an error without emitting content', () async {
    final service = AiService.forTesting(transport: _StreamTransport(const []));
    final result = await _collect(service);
    expect(result.chunks, isEmpty);
    expect(result.error, isA<AiStreamingException>());
    expect((result.error! as AiStreamingException).code, 'empty_response');
  });

  test('transport failures report an error without emitting content', () async {
    final service = AiService.forTesting(
      transport: _StreamTransport(
        const [],
        error: const AiTransportException('unavailable'),
      ),
    );
    final result = await _collect(service);
    expect(result.chunks, isEmpty);
    expect(result.error, isA<AiStreamingException>());
  });

  test('a paused circuit refuses to stream before any transport call',
      () async {
    final transport = _CountingTransport();
    final service = AiService.forTesting(transport: transport);
    for (var i = 0; i < AiService.maxConsecutiveFailures; i++) {
      await _collect(service);
    }
    expect(service.isPaused, isTrue);
    final callsBefore = transport.calls;
    final result = await _collect(service);
    expect(result.error, isA<AiStreamingException>());
    expect((result.error! as AiStreamingException).code, 'paused');
    expect(transport.calls, callsBefore);
  });
}

/// Stream transport backed by an external controller (timing control).
class _ControlledStreamTransport implements AiTransport {
  _ControlledStreamTransport(this._source);

  final Stream<String> _source;

  @override
  Future<String> chat({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    return (await chatStream(
      history: history,
      message: message,
      languageName: languageName,
      timeout: timeout,
    ).toList())
        .join();
  }

  @override
  Stream<String> chatStream({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    Duration timeout = const Duration(seconds: 60),
  }) =>
      _source;
}

class _CountingTransport implements AiTransport {
  int calls = 0;

  @override
  Future<String> chat({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls++;
    throw const AiTransportException('unavailable');
  }

  @override
  Stream<String> chatStream({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    calls++;
    throw const AiTransportException('unavailable');
  }
}
