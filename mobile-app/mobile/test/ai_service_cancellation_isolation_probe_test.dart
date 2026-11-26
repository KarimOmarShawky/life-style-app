import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

const _limit = Duration(seconds: 5);
final _clock = Stopwatch();

// ignore: avoid_print
void _trace(String message) => print('SERVICE PROBE +${_clock.elapsedMilliseconds}ms $message');

class _UnusedGateway implements AiBackendGateway {
  @override
  Future<Object?> post(String path, {Object? body}) =>
      throw StateError('The isolated service probe must not call the gateway');

  @override
  Stream<String> postEventStream(String path,
          {Object? body, required Duration timeout}) =>
      throw StateError('The isolated service probe must not call the gateway');
}

// The service requires a BackendAiTransport for a guarded session. This fake
// overrides the streaming entry point and never calls the real transport or API.
class _DirectTransport extends BackendAiTransport {
  _DirectTransport() : super(_UnusedGateway());

  final listening = Completer<void>();
  final cancelled = Completer<void>();
  int calls = 0;
  late final StreamController<String> source = StreamController<String>(
    onListen: () {
      _trace('fake transport source listened');
      if (!listening.isCompleted) listening.complete();
    },
    onCancel: () {
      _trace('fake transport source onCancel');
      if (!cancelled.isCompleted) cancelled.complete();
    },
  );

  @override
  Stream<String> assistantTurnStream({
    required List<ChatMessage> history,
    required String message,
    required String clientLocale,
    required String languageName,
    List<String> contextScopes = const [],
    Duration timeout = const Duration(seconds: 60),
    bool Function()? sessionIsCurrent,
  }) {
    calls++;
    _trace('fake transport assistantTurnStream called');
    return source.stream;
  }
}

Future<void> _cancel(StreamSubscription<String> subscription) async {
  _trace('service subscription cancel invoked');
  try {
    await subscription.cancel();
  } finally {
    _trace('service subscription cancel settled (success or error)');
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('service: cancellation reaches directly managed fake transport', () async {
    _clock
      ..reset()
      ..start();
    final transport = _DirectTransport();
    final service = AiService.forTesting(transport: transport);
    addTearDown(() async {
      if (!transport.source.isClosed) {
        _trace('teardown requests fake transport source close');
        await transport.source.close().timeout(_limit,
            onTimeout: () => throw TimeoutException('fake source close timed out', _limit));
        _trace('teardown fake transport source close settled');
      }
    });
    final chunks = <String>[];
    final errors = <Object>[];
    final subscription = service.streamAssistantTurn(
      conversationHistory: const [],
      newMessage: 'synthetic',
      clientLocale: 'en',
      sessionIsCurrent: () => true,
    ).listen(chunks.add, onError: (Object error) => errors.add(error));

    await transport.listening.future.timeout(_limit,
        onTimeout: () => throw TimeoutException('fake source listen timed out', _limit));
    await expectLater(
      _cancel(subscription).timeout(_limit,
          onTimeout: () => throw TimeoutException('service cancellation timed out', _limit)),
      completes,
    );
    expect(transport.source.isClosed, isFalse,
        reason: 'The fake producer must remain open when cancellation completes');
    expect(transport.cancelled.isCompleted, isTrue);
    expect(transport.calls, 1);
    expect(chunks, isEmpty);
    expect(errors, isEmpty);
    expect(service.isPaused, isFalse);
  });
}
