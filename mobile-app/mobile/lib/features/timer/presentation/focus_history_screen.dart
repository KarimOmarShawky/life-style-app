import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/features/timer/data/timer_session_model.dart';
import 'package:lifestyle_mobile/features/timer/state/timer_sessions_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Focus sessions saved to the server, newest first.
class FocusHistoryScreen extends ConsumerWidget {
  const FocusHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final sessionsAsync = ref.watch(timerSessionsProvider);
    final tasks = ref.watch(tasksProvider).valueOrNull ?? const [];
    final titles = {for (final task in tasks) task.id: task.title};

    return Scaffold(
      appBar: AppBar(title: Text(l10n.focusHistoryTitle)),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(timerSessionsProvider),
        child: sessionsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => FeatureErrorView(
            message: error.toString(),
            onRetry: () => ref.invalidate(timerSessionsProvider),
          ),
          data: (sessions) {
            if (sessions.isEmpty) {
              return ListView(
                children: [
                  FeatureEmptyView(
                    icon: Icons.timer_outlined,
                    message: l10n.noFocusSessions,
                  ),
                ],
              );
            }
            final totalSeconds = sessions.fold<int>(
              0,
              (sum, session) => sum + session.durationSeconds,
            );
            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: sessions.length + 1,
              itemBuilder: (context, index) {
                if (index == 0) {
                  return _TotalCard(
                    totalMinutes: totalSeconds ~/ 60,
                    sessionCount: sessions.length,
                  );
                }
                final session = sessions[index - 1];
                return Dismissible(
                  key: ValueKey('session-${session.id}'),
                  direction: DismissDirection.endToStart,
                  background: const DeleteSwipeBackground(),
                  confirmDismiss: (_) => confirmDestructiveAction(
                    context,
                    title: l10n.deleteFocusSessionConfirm,
                  ),
                  onDismissed: (_) => runWithErrorSnackBar(context, () async {
                    await ref
                        .read(timerSessionsRepositoryProvider)
                        .deleteSession(session.id);
                    ref.invalidate(timerSessionsProvider);
                  }),
                  child: _SessionTile(
                    session: session,
                    taskTitle: titles[session.taskId] ?? l10n.focusSession,
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _TotalCard extends StatelessWidget {
  const _TotalCard({required this.totalMinutes, required this.sessionCount});

  final int totalMinutes;
  final int sessionCount;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: const Icon(Icons.timer_outlined),
        title: Text(l10n.focusTotalLabel(totalMinutes)),
        subtitle: Text(l10n.focusSessionsCount(sessionCount)),
      ),
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({required this.session, required this.taskTitle});

  final TimerSession session;
  final String taskTitle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final minutes = session.durationSeconds ~/ 60;
    final when =
        '${formatDisplayDate(context, session.startedAt, emptyText: '')} · '
        '${formatDisplayTime(context, session.startedAt)}';
    final durationText = session.isRunning
        ? l10n.focusRunningLabel
        : l10n.durationMinutes(minutes);

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: ListTile(
        leading: const Icon(Icons.check_circle_outline),
        title: Text(taskTitle, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text('$when · $durationText'),
      ),
    );
  }
}
