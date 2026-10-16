import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/notes/data/note_model.dart';
import 'package:lifestyle_mobile/features/notes/state/notes_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

import 'widgets/note_card.dart';

class NotesScreen extends ConsumerStatefulWidget {
  const NotesScreen({super.key});

  @override
  ConsumerState<NotesScreen> createState() => _NotesScreenState();
}

class _NotesScreenState extends ConsumerState<NotesScreen> {
  final Set<String> _selectedNoteIds = {};
  bool get _isSelectionMode => _selectedNoteIds.isNotEmpty;

  void _toggleNoteSelection(String id) {
    setState(() {
      if (_selectedNoteIds.contains(id)) {
        _selectedNoteIds.remove(id);
      } else {
        _selectedNoteIds.add(id);
      }
    });
  }

  void _selectAllNotes(List<Note> notes) {
    setState(() {
      if (_selectedNoteIds.length == notes.length) {
        _selectedNoteIds.clear();
      } else {
        _selectedNoteIds.addAll(notes.map((n) => n.id));
      }
    });
  }

  Future<void> _deleteSelectedNotes(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final count = _selectedNoteIds.length;
    if (count == 0) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.deleteSelected),
        content: Text('${l10n.deleteSelectedConfirm} ($count)'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(l10n.deleteSelected),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final idsToDelete = _selectedNoteIds.toList();
      setState(() => _selectedNoteIds.clear());
      try {
        await ref
            .read(notesRepositoryProvider)
            .deleteMultipleNotes(idsToDelete);
        ref.invalidate(notesProvider);
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(e.toString())),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final notesAsync = ref.watch(notesProvider);

    return Scaffold(
      appBar: _isSelectionMode
          ? AppBar(
              backgroundColor:
                  Theme.of(context).colorScheme.surfaceContainerHighest,
              leading: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => setState(() => _selectedNoteIds.clear()),
              ),
              title: Text('${_selectedNoteIds.length} ${l10n.selectedCount}'),
              actions: [
                IconButton(
                  tooltip: l10n.selectAll,
                  icon: const Icon(Icons.select_all),
                  onPressed: () {
                    final notes = notesAsync.valueOrNull ?? [];
                    _selectAllNotes(notes);
                  },
                ),
                IconButton(
                  tooltip: l10n.deleteSelected,
                  icon: const Icon(Icons.delete_outline, color: Colors.red),
                  onPressed: () => _deleteSelectedNotes(context),
                ),
              ],
            )
          : AppBar(
              title: Text(l10n.notesTitle),
            ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(notesProvider);
        },
        child: notesAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => Center(child: Text('${l10n.errorTitle}: $err')),
          data: (notes) => notes.isEmpty
              ? Center(
                  child: Text(l10n.noNotes, textAlign: TextAlign.center),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: notes.length,
                  itemBuilder: (context, index) {
                    final note = notes[index];
                    final isSelected = _selectedNoteIds.contains(note.id);
                    return Dismissible(
                      key: Key(note.id),
                      direction: DismissDirection.endToStart,
                      background: Container(
                        alignment: Alignment.centerRight,
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(
                          color: Colors.red.shade700,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const Icon(Icons.delete_outline,
                            color: Colors.white),
                      ),
                      confirmDismiss: (_) async {
                        return await showDialog<bool>(
                          context: context,
                          builder: (ctx) => AlertDialog(
                            title: Text(l10n.deleteConfirm),
                            content: Text(note.title),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.of(ctx).pop(false),
                                child: Text(l10n.cancel),
                              ),
                              FilledButton(
                                style: FilledButton.styleFrom(
                                    backgroundColor: Colors.red),
                                onPressed: () => Navigator.of(ctx).pop(true),
                                child: Text(l10n.delete),
                              ),
                            ],
                          ),
                        );
                      },
                      onDismissed: (_) async {
                        try {
                          await ref
                              .read(notesRepositoryProvider)
                              .deleteNote(note.id);
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(e.toString())),
                            );
                          }
                        } finally {
                          ref.invalidate(notesProvider);
                        }
                      },
                      child: InkWell(
                        onLongPress: () => _toggleNoteSelection(note.id),
                        onTap: _isSelectionMode
                            ? () => _toggleNoteSelection(note.id)
                            : null,
                        borderRadius: BorderRadius.circular(16),
                        child: Stack(
                          children: [
                            NoteCard(note: note),
                            if (_isSelectionMode)
                              Positioned(
                                top: 12,
                                left: l10n.isArabic ? null : 12,
                                right: l10n.isArabic ? 12 : null,
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: isSelected
                                        ? Theme.of(context).colorScheme.primary
                                        : Theme.of(context).colorScheme.surface,
                                    shape: BoxShape.circle,
                                    border: Border.all(
                                      color:
                                          Theme.of(context).colorScheme.primary,
                                      width: 2,
                                    ),
                                  ),
                                  child: isSelected
                                      ? const Icon(Icons.check,
                                          size: 18, color: Colors.white)
                                      : const SizedBox.square(dimension: 18),
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showAddNote(context, ref),
        child: const Icon(Icons.add),
      ),
    );
  }
}

Future<void> _showAddNote(BuildContext context, WidgetRef ref) async {
  final l10n = AppLocalizations.of(context);
  final titleController = TextEditingController();
  final bodyController = TextEditingController();
  final tagsController = TextEditingController();
  final formKey = GlobalKey<FormState>();
  var busy = false;
  String? error;

  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) {
        Future<void> submit() async {
          if (!formKey.currentState!.validate()) return;
          setDialogState(() {
            busy = true;
            error = null;
          });
          try {
            final rawTags = tagsController.text.trim();
            final tags = rawTags.isEmpty
                ? <String>[]
                : rawTags
                    .split(',')
                    .map((t) => t.trim())
                    .where((t) => t.isNotEmpty)
                    .toList();
            await ref.read(notesRepositoryProvider).createNote(
                  title: titleController.text,
                  body: bodyController.text,
                  tags: tags,
                );
            ref.invalidate(notesProvider);
            if (dialogContext.mounted) Navigator.of(dialogContext).pop();
          } catch (e) {
            if (dialogContext.mounted) {
              setDialogState(() => error = e.toString());
            }
          } finally {
            if (dialogContext.mounted) setDialogState(() => busy = false);
          }
        }

        return AlertDialog(
          title: Text(l10n.addNote),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: titleController,
                    decoration: InputDecoration(
                      labelText: l10n.noteTitle,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? l10n.fieldRequired
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: bodyController,
                    maxLines: 4,
                    decoration: InputDecoration(
                      labelText: l10n.noteContent,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? l10n.fieldRequired
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: tagsController,
                    decoration: InputDecoration(
                      labelText: l10n.tags,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Text(error!, style: const TextStyle(color: Colors.red)),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.of(dialogContext).pop(),
              child: Text(l10n.cancel),
            ),
            FilledButton(
              onPressed: busy ? null : submit,
              child: busy
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.save),
            ),
          ],
        );
      },
    ),
  );

  titleController.dispose();
  bodyController.dispose();
  tagsController.dispose();
}
