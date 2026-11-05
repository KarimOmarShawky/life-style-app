import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Opens a dialog allowing the user to save or clear their personal BYOK
/// Gemini API key in encrypted device storage (`FlutterSecureStorage`).
Future<bool> showGeminiApiKeyDialog(BuildContext context,
    {AiService? service}) async {
  final ai = service ?? AiService.instance;
  final l10n = AppLocalizations.of(context);
  final isAr = l10n.isArabic;
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

  final controller = TextEditingController(text: currentKey);
  var obscure = true;
  var busy = false;
  var storageError = false;

  final saved = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setDialogState) => AlertDialog(
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
              style: Theme.of(dialogContext).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            if (storageError) ...[
              Text(l10n.aiKeyStorageError,
                  style: TextStyle(
                      color: Theme.of(dialogContext).colorScheme.error)),
              const SizedBox(height: 8),
            ],
            TextField(
              enabled: !busy,
              controller: controller,
              obscureText: obscure,
              autocorrect: false,
              enableSuggestions: false,
              decoration: InputDecoration(
                labelText: 'Gemini API Key',
                hintText: 'AIza...',
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  icon: Icon(
                    obscure
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                  onPressed: () => setDialogState(() => obscure = !obscure),
                ),
              ),
            ),
          ],
        ),
        actions: [
          if (currentKey.isNotEmpty)
            TextButton(
              onPressed: busy
                  ? null
                  : () async {
                      setDialogState(() {
                        busy = true;
                        storageError = false;
                      });
                      try {
                        await ai.setUserApiKey(null);
                        if (dialogContext.mounted) {
                          Navigator.of(dialogContext).pop(true);
                        }
                      } on AiSecureStorageException {
                        if (dialogContext.mounted) {
                          setDialogState(() {
                            busy = false;
                            storageError = true;
                          });
                        }
                      }
                    },
              child: Text(
                l10n.clearValue,
                style: const TextStyle(color: Colors.red),
              ),
            ),
          TextButton(
            onPressed:
                busy ? null : () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: busy
                ? null
                : () async {
                    setDialogState(() {
                      busy = true;
                      storageError = false;
                    });
                    try {
                      await ai.setUserApiKey(controller.text);
                      if (dialogContext.mounted) {
                        Navigator.of(dialogContext).pop(true);
                      }
                    } on AiSecureStorageException {
                      if (dialogContext.mounted) {
                        setDialogState(() {
                          busy = false;
                          storageError = true;
                        });
                      }
                    }
                  },
            child: Text(l10n.save),
          ),
        ],
      ),
    ),
  );

  controller.dispose();
  if (saved == true && context.mounted) {
    final hasKey = await ai.hasUserApiKey();
    if (context.mounted) {
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
