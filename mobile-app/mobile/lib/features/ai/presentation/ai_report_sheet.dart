import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_reports_client.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Flag button shown next to AI-generated text. It opens [AiReportSheet]
/// (Google Play AI-Generated Content policy: report without leaving the app).
class AiReportButton extends StatelessWidget {
  const AiReportButton({
    super.key,
    required this.surface,
    required this.replyText,
  });

  final AiReportSurface surface;
  final String replyText;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return IconButton(
      tooltip: l10n.aiReportReplyTooltip,
      icon: const Icon(Icons.outlined_flag, size: 20),
      onPressed: () => showAiReportSheet(
        context,
        surface: surface,
        replyText: replyText,
      ),
    );
  }
}

Future<void> showAiReportSheet(
  BuildContext context, {
  required AiReportSurface surface,
  required String replyText,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => AiReportSheet(surface: surface, replyText: replyText),
  );
}

/// Lets the user pick a reason, decide whether the reply is included (on by
/// default) and add an optional note. Nothing is sent before "Send report".
class AiReportSheet extends ConsumerStatefulWidget {
  const AiReportSheet({
    super.key,
    required this.surface,
    required this.replyText,
  });

  final AiReportSurface surface;
  final String replyText;

  @override
  ConsumerState<AiReportSheet> createState() => _AiReportSheetState();
}

class _AiReportSheetState extends ConsumerState<AiReportSheet> {
  final _note = TextEditingController();
  AiReportCategory? _category;
  bool _includeReply = true;
  bool _sending = false;
  bool _failed = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  String _label(AppLocalizations l10n, AiReportCategory category) {
    switch (category) {
      case AiReportCategory.offensive:
        return l10n.aiReportCategoryOffensive;
      case AiReportCategory.harmful:
        return l10n.aiReportCategoryHarmful;
      case AiReportCategory.inaccurate:
        return l10n.aiReportCategoryInaccurate;
      case AiReportCategory.spam:
        return l10n.aiReportCategorySpam;
      case AiReportCategory.other:
        return l10n.aiReportCategoryOther;
    }
  }

  Future<void> _send() async {
    final category = _category;
    if (category == null || _sending) return;
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    setState(() {
      _sending = true;
      _failed = false;
    });
    try {
      await ref.read(aiReportsClientProvider).submit(
            surface: widget.surface,
            category: category,
            locale: locale,
            replyText: _includeReply ? widget.replyText : null,
            note: _note.text,
          );
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context);
      messenger.showSnackBar(SnackBar(content: Text(l10n.aiReportSent)));
    } on Object {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _failed = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                header: true,
                child: Text(
                  l10n.aiReportTitle,
                  style: theme.textTheme.titleLarge,
                ),
              ),
              const SizedBox(height: 8),
              Text(l10n.aiReportBody),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final category in AiReportCategory.values)
                    ChoiceChip(
                      label: Text(_label(l10n, category)),
                      selected: _category == category,
                      onSelected: _sending
                          ? null
                          : (_) => setState(() => _category = category),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              CheckboxListTile(
                value: _includeReply,
                onChanged: _sending
                    ? null
                    : (value) => setState(() => _includeReply = value ?? true),
                title: Text(l10n.aiReportIncludeReply),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _note,
                enabled: !_sending,
                minLines: 1,
                maxLines: 3,
                inputFormatters: [
                  LengthLimitingTextInputFormatter(aiReportNoteMaxChars),
                ],
                decoration: InputDecoration(
                  labelText: l10n.aiReportNoteLabel,
                  border: const OutlineInputBorder(),
                ),
              ),
              if (_failed) ...[
                const SizedBox(height: 12),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    l10n.aiReportFailed,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              OverflowBar(
                alignment: MainAxisAlignment.end,
                overflowAlignment: OverflowBarAlignment.end,
                spacing: 8,
                overflowSpacing: 8,
                children: [
                  TextButton(
                    onPressed: _sending ? null : () => Navigator.pop(context),
                    child: Text(l10n.cancel),
                  ),
                  FilledButton(
                    onPressed: _category == null || _sending ? null : _send,
                    child: Text(l10n.aiReportSend),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
