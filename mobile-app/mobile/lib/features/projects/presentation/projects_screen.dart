import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/projects/data/project_model.dart';
import 'package:lifestyle_mobile/features/projects/presentation/project_form_screen.dart';
import 'package:lifestyle_mobile/features/projects/presentation/project_labels.dart';
import 'package:lifestyle_mobile/features/projects/state/projects_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class ProjectsScreen extends ConsumerWidget {
  const ProjectsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final projectsAsync = ref.watch(projectsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.projects)),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(projectsProvider),
        child: projectsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => FeatureErrorView(
            message: error.toString(),
            onRetry: () => ref.invalidate(projectsProvider),
          ),
          data: (projects) {
            if (projects.isEmpty) {
              return ListView(
                children: [
                  FeatureEmptyView(
                    icon: Icons.folder_outlined,
                    message: l10n.noProjects,
                  ),
                ],
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: projects.length,
              itemBuilder: (context, index) {
                final project = projects[index];
                return Dismissible(
                  key: ValueKey('project-${project.id}'),
                  direction: DismissDirection.endToStart,
                  background: const DeleteSwipeBackground(),
                  confirmDismiss: (_) => confirmDestructiveAction(
                    context,
                    title: l10n.deleteProjectConfirm,
                    detail: project.name,
                  ),
                  onDismissed: (_) async {
                    await ref
                        .read(projectsRepositoryProvider)
                        .deleteProject(project.id);
                    ref.invalidate(projectsProvider);
                  },
                  child: _ProjectCard(
                    project: project,
                    onTap: () =>
                        openProjectForm(context, ref, project: project),
                  ),
                );
              },
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => openProjectForm(context, ref),
        icon: const Icon(Icons.add),
        label: Text(l10n.addProject),
      ),
    );
  }
}

class _ProjectCard extends StatelessWidget {
  const _ProjectCard({required this.project, required this.onTap});

  final Project project;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final colorHex = project.color;
    final accent = colorHex == null
        ? colorScheme.primary
        : Color(int.parse('FF${colorHex.substring(1)}', radix: 16));
    final due = project.dueDate;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      color: accent,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      project.name,
                      style: theme.textTheme.titleMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Chip(
                    label: Text(projectStatusLabel(l10n, project.status)),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                l10n.projectTaskCounts(project.openTasks, project.doneTasks),
                style: theme.textTheme.bodySmall,
              ),
              if (due != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    '${l10n.dueDate}: ${formatDisplayDate(context, due, emptyText: '')}',
                    style: theme.textTheme.bodySmall,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
