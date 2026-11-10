import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';

/// Per-account opt-in for sending Smart Quick Add text to the AI proxy
/// (feature guide P0-F2). Off by default: tasks are parsed on the device.
/// The Profile switch turns it on only after the consent dialog; signed-out
/// sessions are always off.
class AiTaskParsingNotifier extends AsyncNotifier<bool> {
  static const String _prefix = 'ai_task_parsing.v1.';

  @override
  Future<bool> build() async {
    final userId = ref.watch(
      authProvider.select((value) => value.asData?.value?.id),
    );
    if (userId == null) return false;
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool('$_prefix$userId') ?? false;
  }

  Future<void> setEnabled(bool enabled) async {
    final userId = ref.read(authProvider).asData?.value?.id;
    if (userId == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('$_prefix$userId', enabled);
    state = AsyncData(enabled);
  }
}

final aiTaskParsingProvider =
    AsyncNotifierProvider<AiTaskParsingNotifier, bool>(
  AiTaskParsingNotifier.new,
);
