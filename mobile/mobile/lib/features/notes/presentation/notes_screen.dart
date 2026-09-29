import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/notes/state/notes_provider.dart';

import 'widgets/note_card.dart';

class NotesScreen extends ConsumerWidget {
  const NotesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notesAsync = ref.watch(notesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Notes')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(notesProvider);
        },
        child: notesAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => Center(child: Text('Error loading notes: $err')),
          data: (notes) => notes.isEmpty
              ? const Center(
                  child: Text('No notes yet.\nJot down your thoughts!'),
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
    );
  }
}
