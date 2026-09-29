import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/notes/data/note_model.dart';
import 'package:lifestyle_mobile/features/notes/data/notes_repository.dart';

final notesRepositoryProvider = Provider<NotesRepository>(
  (ref) => NotesRepository(ref.watch(apiClientProvider)),
);

final notesProvider = FutureProvider.autoDispose<List<Note>>((ref) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.valueOrNull?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(notesRepositoryProvider).listNotes();
});
