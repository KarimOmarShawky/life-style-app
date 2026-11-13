import 'package:shared_preferences/shared_preferences.dart';

/// Everything the server may summarise for the assistant when the user lets
/// it use app data (Hybrid AI AI-2b scopes): today's counts, tasks, habits,
/// goals and events. Notes and Money are never among them.
const List<String> aiContextScopes = [
  'today',
  'tasks',
  'habits',
  'goals',
  'calendar',
];

/// Whether the assistant may attach the app-data summary (AI-2c), kept per
/// account on this phone. Off until the user turns it on.
class AiContextPreferenceStore {
  const AiContextPreferenceStore._();

  static const String _prefix = 'ai_context_enabled.v1.';

  static Future<bool> isEnabled(String userId) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool('$_prefix$userId') ?? false;
  }

  static Future<void> setEnabled(String userId, bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('$_prefix$userId', enabled);
  }
}
