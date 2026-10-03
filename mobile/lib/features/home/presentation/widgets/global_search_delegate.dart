import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
import 'package:lifestyle_mobile/features/notes/state/notes_provider.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class GlobalSearchDelegate extends SearchDelegate<void> {
  GlobalSearchDelegate(this.ref);

  final WidgetRef ref;

  @override
  String get searchFieldLabel => 'بحث شامل في المهام، الملاحظات، والاشتراكات...';

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

  Widget _buildSearchResults(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final trimmedQuery = query.trim().toLowerCase();

    final allTasks = ref.watch(tasksProvider).valueOrNull ?? [];
    final allNotes = ref.watch(notesProvider).valueOrNull ?? [];
    final allSubs = ref.watch(subscriptionsProvider).valueOrNull ?? [];

    if (trimmedQuery.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search, size: 48, color: Theme.of(context).colorScheme.outline),
            const SizedBox(height: 12),
            Text(
              'اكتب أي كلمة للبحث في كل بياناتك',
              style: TextStyle(color: Theme.of(context).colorScheme.outline),
            ),
          ],
        ),
      );
    }

    final matchingTasks = allTasks.where((t) {
      return t.title.toLowerCase().contains(trimmedQuery);
    }).toList();

    final matchingNotes = allNotes.where((n) {
      return n.title.toLowerCase().contains(trimmedQuery) ||
          n.body.toLowerCase().contains(trimmedQuery) ||
          n.tags.any((tag) => tag.toLowerCase().contains(trimmedQuery));
    }).toList();

    final matchingSubs = allSubs.where((s) {
      return s.name.toLowerCase().contains(trimmedQuery) ||
          s.currency.toLowerCase().contains(trimmedQuery);
    }).toList();

    final totalFound = matchingTasks.length + matchingNotes.length + matchingSubs.length;

    if (totalFound == 0) {
      return Center(
        child: Text(
          'لا توجد نتائج مطابقة لـ "$query"',
          style: TextStyle(color: Theme.of(context).colorScheme.outline),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
      children: [
        if (matchingTasks.isNotEmpty) ...[
          _buildSectionHeader(context, '${l10n.tasks} (${matchingTasks.length})', Icons.check_circle_outline),
          ...matchingTasks.map((task) => ListTile(
                title: Text(task.title),
                subtitle: task.dueDate != null ? Text('${l10n.dueDate}: ${task.dueDate}') : null,
                trailing: task.isDone
                    ? const Icon(Icons.check, color: Colors.green, size: 20)
                    : null,
                onTap: () {
                  close(context, null);
                },
              )),
          const Divider(height: 24),
        ],
        if (matchingNotes.isNotEmpty) ...[
          _buildSectionHeader(context, '${l10n.notesTitle} (${matchingNotes.length})', Icons.notes_outlined),
          ...matchingNotes.map((note) => ListTile(
                title: Text(note.title),
                subtitle: Text(
                  note.body,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                onTap: () {
                  close(context, null);
                },
              )),
          const Divider(height: 24),
        ],
        if (matchingSubs.isNotEmpty) ...[
          _buildSectionHeader(context, '${l10n.subscriptionsTitle} (${matchingSubs.length})', Icons.account_balance_wallet_outlined),
          ...matchingSubs.map((sub) => ListTile(
                title: Text(sub.name),
                subtitle: Text('${sub.amount} ${sub.currency} - ${sub.billingUnit}'),
                onTap: () {
                  close(context, null);
                },
              )),
        ],
      ],
    );
  }

  Widget _buildSectionHeader(BuildContext context, String title, IconData icon) {
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
