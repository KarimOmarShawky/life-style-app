import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';
import 'package:lifestyle_mobile/features/ai/data/chat_history_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ChatHistoryStore', () {
    test('round-trips messages through local storage', () async {
      SharedPreferences.setMockInitialValues({});
      final store = ChatHistoryStore();
      expect(await store.load(), isEmpty);

      final messages = [
        ChatMessage(role: 'model', text: 'Hello!', timestamp: DateTime(2026)),
        const ChatMessage(role: 'user', text: 'Help me plan'),
      ];
      await store.save(messages);

      final restored = await store.load();
      expect(restored, hasLength(2));
      expect(restored[0].role, 'model');
      expect(restored[0].text, 'Hello!');
      expect(restored[1].role, 'user');
    });

    test('trims history past the cap, keeping the newest', () async {
      SharedPreferences.setMockInitialValues({});
      final store = ChatHistoryStore();
      await store.save([
        for (var i = 0; i < ChatHistoryStore.maxMessages + 25; i++)
          ChatMessage(role: 'user', text: 'm$i'),
      ]);

      final restored = await store.load();
      expect(restored, hasLength(ChatHistoryStore.maxMessages));
      expect(restored.first.text, 'm25');
      expect(restored.last.text, 'm${ChatHistoryStore.maxMessages + 24}');
    });

    test('corrupt data restores as empty and clear removes everything',
        () async {
      SharedPreferences.setMockInitialValues({
        ChatHistoryStore.storageKey: 'not-json-at-all',
      });
      final store = ChatHistoryStore();
      expect(await store.load(), isEmpty);

      await store.save([const ChatMessage(role: 'user', text: 'hi')]);
      expect(await store.load(), hasLength(1));
      await store.clear();
      expect(await store.load(), isEmpty);
    });
  });
}
