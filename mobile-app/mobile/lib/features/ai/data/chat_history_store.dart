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

  Future<List<ChatMessage>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(storageKey);
      if (raw == null) return const [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return decoded
          .whereType<Map>()
          .map(
              (entry) => ChatMessage.fromJson(Map<String, dynamic>.from(entry)))
          .where((message) => message.text.isNotEmpty)
          .toList();
    } catch (_) {
      // Corrupt history is treated as no history rather than an error.
      return const [];
    }
  }

  Future<void> save(List<ChatMessage> messages) async {
    try {
      final trimmed = messages.length <= maxMessages
          ? messages
          : messages.sublist(messages.length - maxMessages);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        storageKey,
        jsonEncode(trimmed.map((message) => message.toJson()).toList()),
      );
    } catch (_) {
      // Persistence is best-effort; the live conversation continues.
    }
  }

  Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(storageKey);
    } catch (_) {}
  }
}
