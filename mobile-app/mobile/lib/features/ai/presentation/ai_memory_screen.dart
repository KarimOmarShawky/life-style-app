import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_age_confirmation.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_memory_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_settings_client.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_memory_editor.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Profile → Assistant memory (Hybrid AI AI-3): the notes the user saved for
/// the assistant, the switch that lets the assistant use them, and add, edit,
/// delete and delete-all. Notes can always be seen and deleted, also with
/// memory off.
class AiMemoryScreen extends ConsumerStatefulWidget {
  const AiMemoryScreen({super.key});

  @override
  ConsumerState<AiMemoryScreen> createState() => _AiMemoryScreenState();
}

class _AiMemoryScreenState extends ConsumerState<AiMemoryScreen> {
  AiSettingsSnapshot? _settings;
  List<AiMemory> _memories = const [];
  bool _memoryAvailable = false;
  bool _loading = true;
  bool _failed = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    unawaited(_fetch());
  }

  Future<void> _fetch() async {
    try {
      final settings = await ref.read(aiSettingsClientProvider).fetch();
      final list = await ref.read(aiMemoryClientProvider).list();
      if (!mounted) return;
      setState(() {
        _settings = settings;
        _memories = list.items;
        _memoryAvailable = list.available;
        _loading = false;
        _failed = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  Future<void> _retry() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    await _fetch();
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  /// Turns both memory switches on or off. Turning on is an AI feature, so
  /// the 18+ confirmation comes first (D9).
  Future<void> _setMemory(bool enable) async {
    if (enable) {
      if (!await ensureAiAgeConfirmed(context, ref)) return;
      if (!mounted) return;
    }
    setState(() => _busy = true);
    try {
      final updated =
          await ref.read(aiSettingsClientProvider).setMemoryEnabled(enable);
      if (!mounted) return;
      setState(() => _settings = updated);
      // An open assistant reads the switch again.
      ref.read(aiSettingsRevisionProvider.notifier).bump();
    } on Object {
      if (!mounted) return;
      _showMessage(AppLocalizations.of(context).settingSaveFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add() async {
    final draft = await showAiMemoryEditor(context);
    if (draft == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final saved = await ref
          .read(aiMemoryClientProvider)
          .create(kind: draft.kind, content: draft.content);
      if (!mounted) return;
      setState(() => _memories = [saved, ..._memories]);
      _showMessage(AppLocalizations.of(context).aiMemorySaved);
    } on Object catch (error) {
      if (!mounted) return;
      _showMessage(aiMemoryErrorMessage(AppLocalizations.of(context), error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit(AiMemory memory) async {
    final draft = await showAiMemoryEditor(
      context,
      kind: memory.kind,
      content: memory.content,
      editing: true,
    );
    if (draft == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final saved = await ref
          .read(aiMemoryClientProvider)
          .update(memory.id, kind: draft.kind, content: draft.content);
      if (!mounted) return;
      setState(() {
        _memories = [
          for (final item in _memories) item.id == saved.id ? saved : item,
        ];
      });
      _showMessage(AppLocalizations.of(context).aiMemorySaved);
    } on Object catch (error) {
      if (!mounted) return;
      _showMessage(aiMemoryErrorMessage(AppLocalizations.of(context), error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(String title, String body) async {
    final l10n = AppLocalizations.of(context);
    final answer = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        scrollable: true,
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(l10n.delete),
          ),
        ],
      ),
    );
    return answer == true;
  }

  Future<void> _delete(AiMemory memory) async {
    final l10n = AppLocalizations.of(context);
    if (!await _confirm(l10n.aiMemoryDeleteTitle, l10n.aiMemoryDeleteBody)) {
      return;
    }
    if (!mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(aiMemoryClientProvider).delete(memory.id);
      if (!mounted) return;
      setState(() {
        _memories = [
          for (final item in _memories)
            if (item.id != memory.id) item,
        ];
      });
      _showMessage(l10n.aiMemoryDeleted);
    } on Object {
      if (!mounted) return;
      _showMessage(l10n.aiMemoryDeleteFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteAll() async {
    final l10n = AppLocalizations.of(context);
    if (!await _confirm(
      l10n.aiMemoryDeleteAllTitle,
      l10n.aiMemoryDeleteAllBody,
    )) {
      return;
    }
    if (!mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(aiMemoryClientProvider).deleteAll();
      if (!mounted) return;
      setState(() => _memories = const []);
      _showMessage(l10n.aiMemoryAllDeleted);
    } on Object {
      if (!mounted) return;
      _showMessage(l10n.aiMemoryDeleteFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.aiMemoryTitle)),
      body: SafeArea(child: _body(context, l10n)),
    );
  }

  Widget _body(BuildContext context, AppLocalizations l10n) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_failed) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.aiMemoryLoadFailed, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => unawaited(_retry()),
                child: Text(l10n.retry),
              ),
            ],
          ),
        ),
      );
    }
    final settings = _settings;
    if (settings == null || !settings.available || !_memoryAvailable) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(l10n.aiMemoryUnavailable, textAlign: TextAlign.center),
        ),
      );
    }
    final memoryOn = settings.memoryOn;
    final canAdd = memoryOn && !_busy && _memories.length < aiMemoryMaxActive;
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        SwitchListTile(
          key: const ValueKey('ai-memory-switch'),
          title: Text(l10n.aiMemorySwitchTitle),
          subtitle: Text(l10n.aiMemorySwitchSubtitle),
          value: memoryOn,
          onChanged: _busy ? null : (value) => unawaited(_setMemory(value)),
        ),
        const Divider(),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Align(
            alignment: AlignmentDirectional.centerStart,
            child: FilledButton.tonalIcon(
              key: const ValueKey('ai-memory-add'),
              onPressed: canAdd ? () => unawaited(_add()) : null,
              icon: const Icon(Icons.add),
              label: Text(l10n.aiMemoryAdd),
            ),
          ),
        ),
        if (_memories.isEmpty)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(l10n.aiMemoryEmpty),
          )
        else ...[
          for (final memory in _memories)
            ListTile(
              key: ValueKey('ai-memory-${memory.id}'),
              leading: Icon(
                memory.kind == AiMemoryKind.preference
                    ? Icons.tune
                    : Icons.info_outline,
              ),
              title: Text(memory.content),
              subtitle: Text(
                memory.kind == AiMemoryKind.preference
                    ? l10n.aiMemoryKindPreference
                    : l10n.aiMemoryKindFact,
              ),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    tooltip: l10n.aiMemoryEditTitle,
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: _busy ? null : () => unawaited(_edit(memory)),
                  ),
                  IconButton(
                    tooltip: l10n.aiMemoryDeleteTooltip,
                    icon: const Icon(Icons.delete_outline),
                    onPressed: _busy ? null : () => unawaited(_delete(memory)),
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                key: const ValueKey('ai-memory-delete-all'),
                onPressed: _busy ? null : () => unawaited(_deleteAll()),
                icon: const Icon(Icons.delete_sweep_outlined),
                label: Text(l10n.aiMemoryDeleteAll),
                style: TextButton.styleFrom(
                  foregroundColor: Theme.of(context).colorScheme.error,
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}
