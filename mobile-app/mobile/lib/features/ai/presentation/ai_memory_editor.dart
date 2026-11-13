import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_memory_client.dart';
import 'package:lifestyle_mobile/features/ai/data/text_limits.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// What the note editor returns: the kind and the trimmed text.
class AiMemoryDraft {
  const AiMemoryDraft({required this.kind, required this.content});

  final AiMemoryKind kind;
  final String content;
}

/// Asks for a note to save for the assistant (Hybrid AI AI-3): its kind and
/// its text, at most [aiMemoryMaxChars] characters. Returns null when the
/// user cancels. Used by the Memory screen and by "Save to memory" on the
/// user's own chat messages.
Future<AiMemoryDraft?> showAiMemoryEditor(
  BuildContext context, {
  AiMemoryKind kind = AiMemoryKind.fact,
  String content = '',
  bool editing = false,
}) {
  return showDialog<AiMemoryDraft>(
    context: context,
    builder: (_) => _AiMemoryEditor(
      kind: kind,
      content: content,
      editing: editing,
    ),
  );
}

/// The localized message for a failed save of a note.
String aiMemoryErrorMessage(AppLocalizations l10n, Object error) {
  if (error is ApiException) {
    switch (error.code) {
      case 'AI_MEMORY_DISABLED':
        return l10n.aiMemoryDisabledError;
      case 'AI_MEMORY_LIMIT':
        return l10n.aiMemoryLimitError;
      case 'AI_MEMORY_UNAVAILABLE':
        return l10n.aiMemoryUnavailable;
    }
  }
  return l10n.aiMemorySaveFailed;
}

class _AiMemoryEditor extends StatefulWidget {
  const _AiMemoryEditor({
    required this.kind,
    required this.content,
    required this.editing,
  });

  final AiMemoryKind kind;
  final String content;
  final bool editing;

  @override
  State<_AiMemoryEditor> createState() => _AiMemoryEditorState();
}

class _AiMemoryEditorState extends State<_AiMemoryEditor> {
  late AiMemoryKind _kind = widget.kind;
  late final TextEditingController _text = TextEditingController(
    text: clampUtf16(widget.content.trim(), aiMemoryMaxChars),
  );

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final text = _text.text.trim();
    return AlertDialog(
      // Scrolls as a whole, so nothing is cut off at large text (G7).
      scrollable: true,
      title: Text(widget.editing ? l10n.aiMemoryEditTitle : l10n.aiMemoryAdd),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<AiMemoryKind>(
            segments: [
              ButtonSegment<AiMemoryKind>(
                value: AiMemoryKind.preference,
                label: Text(l10n.aiMemoryKindPreference),
              ),
              ButtonSegment<AiMemoryKind>(
                value: AiMemoryKind.fact,
                label: Text(l10n.aiMemoryKindFact),
              ),
            ],
            selected: {_kind},
            onSelectionChanged: (selection) =>
                setState(() => _kind = selection.first),
          ),
          const SizedBox(height: 16),
          TextField(
            key: const ValueKey('ai-memory-field'),
            controller: _text,
            autofocus: true,
            minLines: 2,
            maxLines: 5,
            maxLength: aiMemoryMaxChars,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: l10n.aiMemoryFieldLabel,
              hintText: l10n.aiMemoryEditorHint,
              helperText: l10n.aiMemoryEditorHelper,
              helperMaxLines: 6,
              border: const OutlineInputBorder(),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed: text.isEmpty
              ? null
              : () => Navigator.pop(
                    context,
                    AiMemoryDraft(kind: _kind, content: text),
                  ),
          child: Text(l10n.save),
        ),
      ],
    );
  }
}
