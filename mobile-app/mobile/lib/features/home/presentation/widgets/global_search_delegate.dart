import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
import 'package:lifestyle_mobile/features/more/data/daily_plan_models.dart';
import 'package:lifestyle_mobile/features/notes/state/notes_provider.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class GlobalSearchDelegate extends SearchDelegate<void> {
  GlobalSearchDelegate(this.ref, {this.isArabic = false});

  final WidgetRef ref;
  final bool isArabic;

  String _lastServerQuery = '';
  Future<GlobalSearchResult>? _serverFuture;

  @override
  String get searchFieldLabel => isArabic
      ? 'بحث شامل في المهام، الملاحظات، والاشتراكات...'
      : 'Search tasks, notes, subscriptions...';

  @override
  List<Widget>? buildActions(BuildContext context) {
    return [
      if (query.isNotEmpty)
        IconButton(
          icon: const Icon(Icons.clear),
          onPressed: () => query = '',
        ),
    ];
  }

  @override
  Widget? buildLeading(BuildContext context) {
    return IconButton(
      icon: const Icon(Icons.arrow_back),
      onPressed: () => close(context, null),
    );
  }

  @override
  Widget buildResults(BuildContext context) => _buildSearchResults(context);

  @override
  Widget buildSuggestions(BuildContext context) => _buildSearchResults(context);

  Future<GlobalSearchResult> _fetchServerResults(String q) {
    if (_lastServerQuery == q && _serverFuture != null) {
      return _serverFuture!;
    }
    _lastServerQuery = q;
    _serverFuture =
        ref.read(dailyPlanRepositoryProvider).searchGlobal(q).catchError(
              (_) => GlobalSearchResult(
                query: q,
                tasks: const <DayPlanTaskItem>[],
                notes: const <SearchNoteItem>[],
                habits: const <DayPlanHabitItem>[],
                projects: const <SearchProjectItem>[],
                events: const <DayPlanEventItem>[],
              ),
            );
    return _serverFuture!;
  }

  Widget _buildSearchResults(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final trimmed = query.trim();
    final trimmedLower = trimmed.toLowerCase();

    final allTasks = ref.watch(tasksProvider).valueOrNull ?? [];
    final allNotes = ref.watch(notesProvider).valueOrNull ?? [];
    final allSubs = ref.watch(subscriptionsProvider).valueOrNull ?? [];

    if (trimmedLower.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.search,
              size: 48,
              color: Theme.of(context).colorScheme.outline,
            ),
            const SizedBox(height: 12),
            Text(
              l10n.searchPromptEmpty,
              style: TextStyle(color: Theme.of(context).colorScheme.outline),
            ),
          ],
        ),
      );
    }

    final localTasks = allTasks.where((t) {
      return t.title.toLowerCase().contains(trimmedLower);
    }).toList();

    final localNotes = allNotes.where((n) {
      return n.title.toLowerCase().contains(trimmedLower) ||
          n.body.toLowerCase().contains(trimmedLower) ||
          n.tags.any((tag) => tag.toLowerCase().contains(trimmedLower));
    }).toList();

    final matchingSubs = allSubs.where((s) {
      return s.name.toLowerCase().contains(trimmedLower) ||
          s.currency.toLowerCase().contains(trimmedLower);
    }).toList();

    return FutureBuilder<GlobalSearchResult>(
      future: _fetchServerResults(trimmed),
      builder: (context, snapshot) {
        final server = snapshot.data;

        final taskById =
            <String, ({String title, String? dueDate, bool isDone})>{
          for (final t in localTasks)
            t.id: (title: t.title, dueDate: t.dueDate, isDone: t.isDone),
          if (server != null)
            for (final t in server.tasks)
              t.id: (title: t.title, dueDate: t.dueDate, isDone: t.isDone),
        };

        final noteById = <String, ({String title, String body})>{
          for (final n in localNotes) n.id: (title: n.title, body: n.body),
          if (server != null)
            for (final n in server.notes)
              n.id: (title: n.title, body: n.excerpt ?? ''),
        };

        final serverHabits = server?.habits ?? const <DayPlanHabitItem>[];
        final serverProjects = server?.projects ?? const <SearchProjectItem>[];
        final serverEvents = server?.events ?? const <DayPlanEventItem>[];

        final totalFound = taskById.length +
            noteById.length +
            matchingSubs.length +
            serverHabits.length +
            serverProjects.length +
            serverEvents.length;

        if (totalFound == 0) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          return Center(
            child: Text(
              l10n.searchNoResultsFor(query),
              style: TextStyle(color: Theme.of(context).colorScheme.outline),
            ),
          );
        }

        return ListView(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
          children: [
            if (taskById.isNotEmpty) ...[
              _buildSectionHeader(
                context,
                '${l10n.tasks} (${taskById.length})',
                Icons.check_circle_outline,
              ),
              ...taskById.values.map(
                (task) => ListTile(
                  title: Text(task.title),
                  subtitle: task.dueDate != null
                      ? Text('${l10n.dueDate}: ${task.dueDate}')
                      : null,
                  trailing: task.isDone
                      ? const Icon(Icons.check, color: Colors.green, size: 20)
                      : null,
                  onTap: () => close(context, null),
                ),
              ),
              const Divider(height: 24),
            ],
            if (noteById.isNotEmpty) ...[
              _buildSectionHeader(
                context,
                '${l10n.notesTitle} (${noteById.length})',
                Icons.notes_outlined,
              ),
              ...noteById.values.map(
                (note) => ListTile(
                  title: Text(note.title),
                  subtitle: note.body.isNotEmpty
                      ? Text(
                          note.body,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        )
                      : null,
                  onTap: () => close(context, null),
                ),
              ),
              const Divider(height: 24),
            ],
            if (serverHabits.isNotEmpty) ...[
              _buildSectionHeader(
                context,
                '${l10n.habits} (${serverHabits.length})',
                Icons.repeat,
              ),
              ...serverHabits.map(
                (habit) => ListTile(
                  title: Text(habit.name),
                  trailing: habit.completedOn
                      ? const Icon(Icons.check, color: Colors.green, size: 20)
                      : null,
                  onTap: () => close(context, null),
                ),
              ),
              const Divider(height: 24),
            ],
            if (serverProjects.isNotEmpty) ...[
              _buildSectionHeader(
                context,
                '${l10n.projects} (${serverProjects.length})',
                Icons.folder_outlined,
              ),
              ...serverProjects.map(
                (project) => ListTile(
                  title: Text(project.name),
                  subtitle: project.description != null
                      ? Text(
                          project.description!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        )
                      : null,
                  onTap: () => close(context, null),
                ),
              ),
              const Divider(height: 24),
            ],
            if (serverEvents.isNotEmpty) ...[
              _buildSectionHeader(
                context,
                '${l10n.calendarTitle} (${serverEvents.length})',
                Icons.event_outlined,
              ),
              ...serverEvents.map(
                (event) => ListTile(
                  title: Text(event.title),
                  subtitle:
                      event.location != null ? Text(event.location!) : null,
                  onTap: () => close(context, null),
                ),
              ),
              const Divider(height: 24),
            ],
            if (matchingSubs.isNotEmpty) ...[
              _buildSectionHeader(
                context,
                '${l10n.subscriptionsTitle} (${matchingSubs.length})',
                Icons.account_balance_wallet_outlined,
              ),
              ...matchingSubs.map(
                (sub) => ListTile(
                  title: Text(sub.name),
                  subtitle: Text(
                    '${sub.amount} ${sub.currency} - ${sub.billingUnit}',
                  ),
                  onTap: () => close(context, null),
                ),
              ),
            ],
          ],
        );
      },
    );
  }

  Widget _buildSectionHeader(
    BuildContext context,
    String title,
    IconData icon,
  ) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6, top: 4),
      child: Row(
        children: [
          Icon(icon, size: 18, color: theme.colorScheme.primary),
          const SizedBox(width: 8),
          Text(
            title,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 14,
              color: theme.colorScheme.primary,
            ),
          ),
        ],
      ),
    );
  }
}
