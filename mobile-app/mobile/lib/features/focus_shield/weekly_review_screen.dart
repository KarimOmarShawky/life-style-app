import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/features/timer/state/timer_sessions_provider.dart';
import 'package:lifestyle_mobile/features/habits/state/habits_provider.dart';
import 'package:lifestyle_mobile/features/more/data/daily_plan_models.dart';
import 'focus_shield_provider.dart';
import 'focus_shield_models.dart';
import 'routine_and_weekly_models.dart';

class WeeklyReviewScreen extends ConsumerStatefulWidget {
  const WeeklyReviewScreen({super.key});
  @override
  ConsumerState<WeeklyReviewScreen> createState() => _WeeklyReviewScreenState();
}

class _WeeklyReviewScreenState extends ConsumerState<WeeklyReviewScreen> {
  WeeklyMetrics? _metrics;
  String? _coaching;
  bool _loading = true;
  bool _generating = false;
  Future<T?> _optional<T>(Future<T> request) async {
    try {
      return await request;
    } catch (_) {
      return null;
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final focus = await ref.read(focusShieldProvider.future);
    if (!mounted) return;
    final now = DateTime.now();
    final from = DateTime(now.year, now.month, now.day - 6);
    final to = DateTime(now.year, now.month, now.day + 1);
    final tasksRequest =
        _optional(ref.read(tasksRepositoryProvider).listAllTasks());
    final sessionsRequest = _optional(ref
        .read(timerSessionsRepositoryProvider)
        .listWindow(from.subtract(const Duration(hours: 12)), to));
    final habitsRequest =
        _optional(ref.read(habitsRepositoryProvider).listHabits());
    final daysRequest = _optional(Future.wait(List.generate(7, (index) {
      final date = DateTime(from.year, from.month, from.day + index);
      return ref
          .read(dailyPlanRepositoryProvider)
          .getDayPlan(date: localDateKey(date));
    })));
    final tasks = await tasksRequest;
    final sessions = await sessionsRequest;
    final habits = await habitsRequest;
    final days = await daysRequest;
    final due = days
        ?.expand((day) => day.habits)
        .where((habit) => habit.dueOn)
        .toList();
    final metrics = calculateWeeklyMetrics(
      now: now,
      history: focus.history,
      backendSessions: sessions,
      tasks: tasks,
      habitsDue: due?.length,
      habitsDone: due?.where((habit) => habit.completedOn).length,
      activeStreaks: habits
          ?.where(
              (habit) => habit.status == 'active' && habit.currentStreak > 0)
          .length,
    );
    if (!mounted) return;
    setState(() {
      _metrics = metrics;
      _coaching = metrics.offlineSummary();
      _loading = false;
    });
  }

  Future<void> _generate() async {
    final metrics = _metrics;
    if (metrics == null || _generating) return;
    setState(() => _generating = true);
    try {
      final ai = AiService.instance;
      if (ai.isPaused) {
        if (mounted) {
          setState(() => _coaching = metrics.offlineSummary());
        }
        return;
      }
      if (!mounted) return;
      final consent = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
                title: const Text('Send aggregated numbers to Gemini?'),
                content: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Text(
                      'This request sends only counts, rates, focus minutes and average clarity. No task titles, notes, messages, sender names or package names. Consent is requested again for every request. The request runs through the LifeStyle server; no personal API key is needed.'),
                  SelectableText(const JsonEncoder.withIndent('  ')
                      .convert(metrics.aggregates())),
                ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Keep offline')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Send this request'))
                ],
              ));
      if (consent != true) return;
      final coaching =
          await ai.generateWeeklyCoaching(aggregates: metrics.aggregates());
      if (mounted) {
        setState(() => _coaching = coaching ?? metrics.offlineSummary());
      }
    } catch (_) {
      if (mounted) {
        setState(() => _coaching = metrics.offlineSummary());
      }
    } finally {
      if (mounted) {
        setState(() => _generating = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Weekly Brain Report'), actions: [
          IconButton(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh report'),
          IconButton(
              onPressed: _metrics == null
                  ? null
                  : () => Clipboard.setData(ClipboardData(
                      text: '${_metrics!.report()}\n\n${_coaching ?? ''}')),
              icon: const Icon(Icons.copy),
              tooltip: 'Copy Weekly Brain Report')
        ]),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(padding: const EdgeInsets.all(16), children: [
                if (_metrics == null)
                  const Text('No data')
                else
                  WeeklyMetricsSummary(metrics: _metrics!),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _generating ? null : _generate,
                    child: Text(
                      _generating
                          ? 'Generating…'
                          : 'Generate AI Weekly Coaching Plan',
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                if ((_coaching ?? '').isNotEmpty)
                  Card(
                    margin: EdgeInsets.zero,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Coaching',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          SelectableText(_coaching!),
                        ],
                      ),
                    ),
                  ),
              ]),
      );
}

/// Card-based weekly metrics. The plain-text [WeeklyMetrics.report] remains
/// the copy/export format; on screen the numbers are easier to scan as
/// separate tiles instead of one stacked paragraph.
class WeeklyMetricsSummary extends StatelessWidget {
  const WeeklyMetricsSummary({super.key, required this.metrics});

  final WeeklyMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final habitRate = metrics.habitRate;
    final tiles = <_WeeklyMetricTileData>[
      _WeeklyMetricTileData(
        label: 'Tasks completed',
        value: '${metrics.tasksCompleted ?? 'No data'}',
      ),
      _WeeklyMetricTileData(
        label: 'Pending due',
        value: '${metrics.tasksPending ?? 'No data'}',
      ),
      _WeeklyMetricTileData(
        label: 'Habit consistency',
        value:
            habitRate == null ? 'No data' : '${habitRate.toStringAsFixed(1)}%',
        detail:
            'Check-ins: ${metrics.habitsDone ?? 'No data'}/${metrics.habitsDue ?? 'No data'}',
      ),
      _WeeklyMetricTileData(
        label: 'Active streaks',
        value: '${metrics.activeStreaks ?? 'No data'}',
      ),
      _WeeklyMetricTileData(
        label: 'Focus time',
        value: '${(metrics.focusSeconds / 60).toStringAsFixed(1)} min',
        detail:
            '${metrics.sessionCount} session${metrics.sessionCount == 1 ? '' : 's'}${metrics.localFocusOnly ? ' · local history only' : ''}',
      ),
      _WeeklyMetricTileData(
        label: 'Blocked attempts',
        value: '${metrics.attempts}',
      ),
      _WeeklyMetricTileData(
        label: 'Brain Clarity Score',
        value: metrics.averageClarity?.toStringAsFixed(1) ?? 'No data',
      ),
      _WeeklyMetricTileData(
        label: 'Estimated time saved',
        value: '${metrics.estimatedMinutesSaved} min',
        detail:
            'Estimate only: $estimatedMinutesSavedPerAttempt min per blocked attempt, not measured.',
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${localDateKey(metrics.from)} — ${localDateKey(metrics.to.subtract(const Duration(microseconds: 1)))}',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 6),
        const Text(
          'Unavailable metrics are marked No data, never treated as zero.',
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 620
                ? 3
                : constraints.maxWidth >= 360
                    ? 2
                    : 1;
            final tileWidth =
                (constraints.maxWidth - (columns - 1) * 12) / columns;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final tile in tiles)
                  SizedBox(
                    width: tileWidth,
                    child: _WeeklyMetricTile(data: tile),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _WeeklyMetricTileData {
  const _WeeklyMetricTileData({
    required this.label,
    required this.value,
    this.detail,
  });

  final String label;
  final String value;
  final String? detail;
}

class _WeeklyMetricTile extends StatelessWidget {
  const _WeeklyMetricTile({required this.data});

  final _WeeklyMetricTileData data;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              data.label,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 6),
            Text(
              data.value,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            if (data.detail != null) ...[
              const SizedBox(height: 4),
              Text(
                data.detail!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
