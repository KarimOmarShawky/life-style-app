import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Per-account "I am 18 or older" confirmation for the AI features (Hybrid
/// AI audit AI0-F11, decision D9). The Gemini API terms require users of the
/// API to be 18 or older, so every AI feature asks once per account before
/// it sends anything. Signed-out sessions are never confirmed.
class AiAgeConfirmationNotifier extends AsyncNotifier<bool> {
  static const String _prefix = 'ai_age_confirmed.v1.';

  @override
  Future<bool> build() async {
    final userId = ref.watch(
      authProvider.select((value) => value.valueOrNull?.id),
    );
    if (userId == null) return false;
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool('$_prefix$userId') ?? false;
  }

  Future<void> confirm() async {
    final userId = ref.read(authProvider).valueOrNull?.id;
    if (userId == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('$_prefix$userId', true);
    state = const AsyncData(true);
  }
}

final aiAgeConfirmationProvider =
    AsyncNotifierProvider<AiAgeConfirmationNotifier, bool>(
  AiAgeConfirmationNotifier.new,
);

/// Returns true when the AI may be used: the account already confirmed, or
/// the user confirms now. Declining shows a short message and returns false;
/// nothing is stored, so the question comes back next time.
Future<bool> ensureAiAgeConfirmed(BuildContext context, WidgetRef ref) async {
  final confirmed = await ref.read(aiAgeConfirmationProvider.future);
  if (confirmed) return true;
  if (!context.mounted) return false;
  final l10n = AppLocalizations.of(context);
  final answer = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l10n.aiAgeTitle),
      content: SingleChildScrollView(child: Text(l10n.aiAgeBody)),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: Text(l10n.aiAgeDecline),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text(l10n.aiAgeConfirm),
        ),
      ],
    ),
  );
  if (answer == true) {
    await ref.read(aiAgeConfirmationProvider.notifier).confirm();
    return true;
  }
  if (answer == false) {
    if (!context.mounted) return false;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(l10n.aiAgeDeclined)),
    );
  }
  return false;
}
