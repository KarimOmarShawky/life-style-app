import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Displaying an export never writes to the system clipboard. Copy requires an
/// explicit acknowledgement and action; clipboard history cannot be revoked here.
class AccountExportDialog extends StatefulWidget {
  const AccountExportDialog({required this.jsonText, super.key});

  final String jsonText;

  @override
  State<AccountExportDialog> createState() => _AccountExportDialogState();
}

class _AccountExportDialogState extends State<AccountExportDialog> {
  bool _acknowledged = false;
  bool _copying = false;
  bool _copied = false;
  bool _failed = false;

  Future<void> _copy() async {
    if (!_acknowledged || _copying) return;
    setState(() {
      _copying = true;
      _failed = false;
      _copied = false;
    });
    try {
      await Clipboard.setData(ClipboardData(text: widget.jsonText));
      if (mounted) setState(() => _copied = true);
    } catch (_) {
      // A platform error can contain private values. Show only a safe failure.
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _copying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final preview = widget.jsonText.length > 600
        ? '${widget.jsonText.substring(0, 600)}...'
        : widget.jsonText;
    return AlertDialog(
      title: Text(l10n.accountExportReady),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.accountExportPrivacy),
            const SizedBox(height: 12),
            Text(preview,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
            CheckboxListTile(
              value: _acknowledged,
              onChanged: _copying
                  ? null
                  : (value) => setState(() => _acknowledged = value ?? false),
              title: Text(l10n.accountExportAcknowledge),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
            ),
            if (_copied) Text(l10n.accountExportCopied),
            if (_failed) Text(l10n.accountExportCopyFailed),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: Text(l10n.back)),
        FilledButton(
          onPressed: _acknowledged && !_copying ? _copy : null,
          child: Text(l10n.accountExportCopy),
        ),
      ],
    );
  }
}
