import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/config/app_config.dart';
import 'package:lifestyle_mobile/data/notification_service.dart';
import 'package:lifestyle_mobile/data/settings_provider.dart';

import 'app.dart';

const String _geminiKeyPref = 'gemini_api_key';

/// Mirrors runtime configuration into Android SharedPreferences so native
/// components (SMS receiver, lock-screen voice service) can reach the same
/// API endpoint without a running Flutter engine. Android stores Flutter
/// keys under a `flutter.` prefix, i.e. `flutter.lifestyle.api_base_url`.
Future<void> _publishNativeConfig() async {
  try {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.setString(SettingsNotifier.apiBaseKey, AppConfig.apiBaseUrl);
    // The AI key comes only from --dart-define. It is mirrored for native voice transcription.
    final geminiKey = AppConfig.geminiApiKey.trim();
    if (geminiKey.isEmpty) {
      await prefs.remove(_geminiKeyPref);
    } else {
      await prefs.setString(_geminiKeyPref, geminiKey);
    }
  } catch (_) {
    // Non-fatal: native code falls back to its built-in default endpoint.
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.instance.init();
  await _publishNativeConfig();
  final initialLocation =
      WidgetsBinding.instance.platformDispatcher.defaultRouteName;
  runApp(ProviderScope(child: LifeStyleApp(initialLocation: initialLocation)));
}
