import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/notes/state/notes_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

import 'widgets/note_card.dart';

class NotesScreen extends ConsumerWidget {
  const NotesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final notesAsync = ref.watch(notesProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.notesTitle)),
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
                    return NoteCard(note: note);
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
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: titleController,
                    autofocus: true,
                    decoration: InputDecoration(
                      labelText: l10n.noteTitle,
                    ),
                    validator: (v) =>
                        v == null || v.trim().isEmpty ? l10n.noteTitle : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: bodyController,
                    maxLines: 4,
                    decoration: InputDecoration(
                      labelText: l10n.noteContent,
                      alignLabelWithHint: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: tagsController,
                    decoration: InputDecoration(
                      labelText: l10n.tags,
                    ),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
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
                      dimension: 18,
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