import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Per-account "I am 18 or older" confirmation for the AI features (Hybrid
/// AI audit AI0-F11, decision D9). The Gemini API terms require users of the
/// API to be 18 or older, so every AI feature asks once per account on this
/// device before it sends anything. Nothing is stored for signed-out
/// sessions or when the user declines.
class AiAgeConfirmationStore {
  const AiAgeConfirmationStore._();

  static const String _prefix = 'ai_age_confirmed.v1.';

  static Future<bool> isConfirmed(String userId) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool('$_prefix$userId') ?? false;
  }

  static Future<void> confirm(String userId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('$_prefix$userId', true);
  }
}

Future<String?> _currentUserId(WidgetRef ref) async {
  try {
    return (await ref.read(authProvider.future))?.id;
  } on Object {
    return null;
  }
}

/// Returns true when the AI may be used: the account already confirmed, or
/// the user confirms now. Declining shows a short message and returns false;
/// the question comes back next time.
Future<bool> ensureAiAgeConfirmed(BuildContext context, WidgetRef ref) async {
  final userId = await _currentUserId(ref);
  if (userId != null && await AiAgeConfirmationStore.isConfirmed(userId)) {
    return true;
  }
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
    if (userId != null) await AiAgeConfirmationStore.confirm(userId);
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
