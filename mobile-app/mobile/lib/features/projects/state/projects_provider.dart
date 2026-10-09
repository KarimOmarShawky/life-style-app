import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/projects/data/project_model.dart';
import 'package:lifestyle_mobile/features/projects/data/projects_repository.dart';

final projectsRepositoryProvider = Provider<ProjectsRepository>(
  (ref) => ProjectsRepository(ref.watch(apiClientProvider)),
);

final projectsProvider = FutureProvider.autoDispose<List<Project>>((ref) async {
  final currentUserId = ref.watch(
    authProvider.select((value) => value.asData?.value?.id),
  );
  if (currentUserId == null) return const [];
  return ref.watch(projectsRepositoryProvider).listProjects();
});
