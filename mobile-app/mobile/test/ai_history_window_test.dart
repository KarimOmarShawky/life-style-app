import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

/// Hybrid AI audit AI0-F1: the app keeps up to 100 messages on the device,
/// but the backend accepts at most 21 turns and 24,000 characters. Only the
/// most recent answered turns that fit are sent.
class _RecordingGateway implements AiBackendGateway {
  Object? lastBody;

  @override
  Future<Object?> post(String path, {Object? body}) async {
    lastBody = body;
    return <String, Object?>{'reply': 'ok'};
  }

  @override
  Stream<String> postEventStream(
    String path, {
    Object? body,
    required Duration timeout,
  }) async* {
    lastBody = body;
    yield '{"text":"ok"}';
    yield '[DONE]';
  }
}

ChatMessage _user(String text) => ChatMessage(role: 'user', text: text);
ChatMessage _model(String text) => ChatMessage(role: 'model', text: text);

List<ChatMessage> _conversation(int exchanges) => [
      _model('Welcome'),
      for (var i = 0; i < exchanges; i++) ...[
        _user('question $i'),
        _model('answer $i'),
      ],
    ];

int _chars(List<ChatMessage> turns) =>
    turns.fold(0, (total, turn) => total + turn.text.length);

void main() {
  test('sends at most 20 earlier turns, newest kept, starting with the user',
      () {
    final window = boundedAiHistory(_conversation(50), 'next');
    expect(window, hasLength(aiMaxRequestTurns - 1));
    expect(window.first.role, 'user');
    expect(window.last.role, 'model');
    expect(window.last.text, 'answer 49');
    expect(window.first.text, 'question 40');
  });

  test('keeps short conversations whole, without the greeting', () {
    final window = boundedAiHistory(_conversation(2), 'next');
    expect(window.map((turn) => turn.text), [
      'question 0',
      'answer 0',
      'question 1',
      'answer 1',
    ]);
  });

  test('skips empty bubbles and drops an unanswered last question', () {
    final history = [
      _user('first'),
      _model('reply'),
      _user('lost question'),
      _model('   '),
      _model(''),
    ];
    final window = boundedAiHistory(history, 'next');
    expect(window.map((turn) => turn.text), ['first', 'reply']);
  });

  test('keeps the later of two turns from the same side', () {
    final history = [
      _user('failed attempt'),
      _user('retried question'),
      _model('reply'),
    ];
    final window = boundedAiHistory(history, 'next');
    expect(window.map((turn) => turn.text), ['retried question', 'reply']);
  });

  test('cuts a very long turn to the backend limit', () {
    final history = [_user('q'), _model('x' * 5000)];
    final window = boundedAiHistory(history, 'next');
    expect(window.last.text.length, aiMaxTurnChars);
  });

  test('stays within the character budget with long replies', () {
    final history = [
      for (var i = 0; i < 7; i++) ...[
        _user('q$i'),
        _model('y' * 3500),
      ],
    ];
    const message = 'a new question';
    final window = boundedAiHistory(history, message);
    expect(
      _chars(window) + message.length,
      lessThanOrEqualTo(aiMaxRequestChars),
    );
    expect(window.first.role, 'user');
    expect(window.last.role, 'model');
  });

  test('the request body always fits the backend limits', () async {
    final gateway = _RecordingGateway();
    final transport = BackendAiTransport(gateway);
    final history = [..._conversation(50), _model('')];
    await transport.chat(
      history: history,
      message: 'next',
      languageName: 'English',
      mode: AiReplyMode.chat,
    );
    final body = gateway.lastBody! as Map<String, Object?>;
    final messages = body['messages']! as List<Object?>;
    expect(messages.length, lessThanOrEqualTo(aiMaxRequestTurns));
    expect(messages.last, {'role': 'user', 'text': 'next'});
    for (final raw in messages) {
      final turn = raw! as Map<String, Object?>;
      expect((turn['text']! as String).trim(), isNotEmpty);
    }

    final stream = transport.chatStream(
      history: history,
      message: 'streamed',
      languageName: 'English',
    );
    await stream.drain<void>();
    final streamedBody = gateway.lastBody! as Map<String, Object?>;
    final streamed = streamedBody['messages']! as List<Object?>;
    expect(streamed.length, lessThanOrEqualTo(aiMaxRequestTurns));
  });
}
