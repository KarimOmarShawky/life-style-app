import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Ephemeral proof only: no provider, token store, logging or persistence.
/// State owns the controller until the route's exit animation is disposed.
class CurrentPasswordDialog extends StatefulWidget {
  const CurrentPasswordDialog({super.key});

  @override
  State<CurrentPasswordDialog> createState() => _CurrentPasswordDialogState();
}

class _CurrentPasswordDialogState extends State<CurrentPasswordDialog> {
  final _password = TextEditingController();

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    // Password whitespace is significant; do not trim or otherwise normalize it.
    if (_password.text.isNotEmpty) Navigator.pop(context, _password.text);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.verifyCurrentPassword),
      content: TextField(
        controller: _password,
        obscureText: true,
        autofocus: true,
        autocorrect: false,
        enableSuggestions: false,
        enableIMEPersonalizedLearning: false,
        onSubmitted: (_) => _submit(),
        decoration: InputDecoration(labelText: l10n.currentPassword),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(onPressed: _submit, child: Text(l10n.verifyAndContinue)),
      ],
    );
  }
}
