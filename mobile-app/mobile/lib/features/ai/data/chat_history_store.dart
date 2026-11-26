import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'ai_transport.dart';

/// On-device persistence for the AI conversation. The chat used to live
/// only in widget state, so closing the app erased it. History stays on
/// this device (SharedPreferences), capped so it cannot grow forever;
/// nothing about the conversation is stored anywhere else by the app.
class ChatHistoryStore {
  static const storageKey = 'ai.chat.history.v1';
  static const maxMessages = 100;

  static String keyForAccount(String account) =>
      '$storageKey.account.${Uri.encodeComponent(account)}';

  Future<List<ChatMessage>> load(String account) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(keyForAccount(account));
      if (raw == null) return const [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return decoded
          .whereType<Map<String, dynamic>>()
          .map(
              (entry) => ChatMessage.fromJson(Map<String, dynamic>.from(entry)))
          .where((message) => message.text.isNotEmpty)
          .toList();
    } catch (_) {
      // Corrupt history is treated as no history rather than an error.
      return const [];
    }
  }

  Future<void> save(String account, List<ChatMessage> messages) async {
    try {
      final trimmed = messages.length <= maxMessages
          ? messages
          : messages.sublist(messages.length - maxMessages);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        keyForAccount(account),
        jsonEncode(trimmed.map((message) => message.toJson()).toList()),
      );
    } catch (_) {
      // Persistence is best-effort; the live conversation continues.
    }
  }

  Future<void> clear(String account) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(keyForAccount(account));
    } catch (_) {}
  }
}
