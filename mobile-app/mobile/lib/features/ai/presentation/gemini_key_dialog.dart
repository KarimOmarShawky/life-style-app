import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Opens a dialog allowing the user to save or clear their personal BYOK
/// Gemini API key in encrypted device storage (`FlutterSecureStorage`).
Future<bool> showGeminiApiKeyDialog(BuildContext context,
    {AiService? service}) async {
  final ai = service ?? AiService.instance;
  final l10n = AppLocalizations.of(context);
  final String currentKey;
  try {
    currentKey = await ai.getUserApiKey();
  } on AiSecureStorageException {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.aiKeyStorageError)),
      );
    }
    return false;
  }
  if (!context.mounted) return false;

  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _GeminiKeyDialog(
      service: ai,
      initialKey: currentKey,
      hasExistingKey: currentKey.isNotEmpty,
    ),
  );

  if (saved == true && context.mounted) {
    final hasKey = await ai.hasUserApiKey();
    if (context.mounted) {
      final isAr = AppLocalizations.of(context).isArabic;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            hasKey
                ? (isAr
                    ? 'تم حفظ مفتاح Gemini API المشفر بنجاح'
                    : 'Gemini API key saved securely')
                : (isAr ? 'تم مسح مفتاح Gemini API' : 'Gemini API key cleared'),
          ),
        ),
      );
    }
  }
  return saved == true;
}

/// Stateful so the [TextEditingController] is owned by the dialog's State
/// and disposed from [State.dispose]. The previous implementation created
/// the controller in the caller and disposed it as soon as the dialog
/// future completed, while the route's exit transition could still be
/// using it — which surfaced as a debug-mode framework assertion
/// ('_dependents.isEmpty') right after saving a key on a real device.
class _GeminiKeyDialog extends StatefulWidget {
  const _GeminiKeyDialog({
    required this.service,
    required this.initialKey,
    required this.hasExistingKey,
  });

  final AiService service;
  final String initialKey;
  final bool hasExistingKey;

  @override
  State<_GeminiKeyDialog> createState() => _GeminiKeyDialogState();
}

class _GeminiKeyDialogState extends State<_GeminiKeyDialog> {
  late final TextEditingController _controller;
  bool _obscure = true;
  bool _busy = false;
  bool _storageError = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialKey);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _storageError = false;
    });
    try {
      await widget.service.setUserApiKey(_controller.text);
      if (mounted) Navigator.of(context).pop(true);
    } on AiSecureStorageException {
      if (mounted) {
        setState(() {
          _busy = false;
          _storageError = true;
        });
      }
    }
  }

  Future<void> _clear() async {
    setState(() {
      _busy = true;
      _storageError = false;
    });
    try {
      await widget.service.setUserApiKey(null);
      if (mounted) Navigator.of(context).pop(true);
    } on AiSecureStorageException {
      if (mounted) {
        setState(() {
          _busy = false;
          _storageError = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isAr = l10n.isArabic;
    return AlertDialog(
      title: Row(
        children: [
          const Icon(Icons.key_outlined, size: 22),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              isAr ? 'مفتاح Gemini API الشخصي' : 'Personal Gemini API Key',
              style: const TextStyle(fontSize: 17),
            ),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isAr
                ? 'أدخل مفتاح Google AI Studio (Gemini) الخاص بك. يُحفظ المفتاح مشفراً على جهازك فقط ولا تتم مشاركته مع أي مستخدم آخر.'
                : 'Enter your personal Google AI Studio (Gemini) key. It is stored encrypted on your device only and never shared.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          if (_storageError) ...[
            Text(l10n.aiKeyStorageError,
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
            const SizedBox(height: 8),
          ],
          TextField(
            enabled: !_busy,
            controller: _controller,
            obscureText: _obscure,
            autocorrect: false,
            enableSuggestions: false,
            decoration: InputDecoration(
              labelText: 'Gemini API Key',
              hintText: 'AQ.…',
              border: const OutlineInputBorder(),
              suffixIcon: IconButton(
                icon: Icon(
                  _obscure
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                ),
                onPressed: () => setState(() => _obscure = !_obscure),
              ),
            ),
          ),
        ],
      ),
      actions: [
        if (widget.hasExistingKey)
          TextButton(
            onPressed: _busy ? null : _clear,
            child: Text(
              l10n.clearValue,
              style: const TextStyle(color: Colors.red),
            ),
          ),
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(l10n.save),
        ),
      ],
    );
  }
}
