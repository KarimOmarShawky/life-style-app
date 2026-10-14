import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/features/timer/state/timer_sessions_provider.dart';
import 'package:lifestyle_mobile/features/habits/state/habits_provider.dart';
import 'package:lifestyle_mobile/features/more/data/daily_plan_models.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
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
    final currency =
        ref.read(authProvider).asData?.value?.defaultCurrency ?? 'EGP';
    final moneyRequest = _optional(ref
        .read(moneyControllerProvider)
        .weeklySpending(localDateKey(from),
            localDateKey(DateTime(now.year, now.month, now.day)), currency));
    final tasks = await tasksRequest;
    final sessions = await sessionsRequest;
    final habits = await habitsRequest;
    final days = await daysRequest;
    final money = await moneyRequest;
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
        netSpending: money?.netSpending,
        currency: money?.currency);
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
      if ((await ai.getEffectiveApiKey()).isEmpty || ai.isKeyPaused) {
        if (mounted) {
          setState(() => _coaching = metrics.offlineSummary());
        }
        return;
      }
      if (!mounted) return;
      var includeSpending = false;
      final consent = await showDialog<bool>(
          context: context,
          builder: (context) => StatefulBuilder(
              builder: (context, update) => AlertDialog(
                    title: const Text('Send aggregated numbers to Gemini?'),
                    content: SingleChildScrollView(
                        child:
                            Column(mainAxisSize: MainAxisSize.min, children: [
                      const Text(
                          'This request sends only counts, rates, focus minutes and average clarity. No task titles, notes, messages, sender names or package names. Consent is requested again for every request. Your encrypted BYOK key and existing circuit breaker are used.'),
                      CheckboxListTile(
                          value: includeSpending,
                          onChanged: metrics.netSpending == null
                              ? null
                              : (value) => update(
                                  () => includeSpending = value ?? false),
                          title: const Text(
                              'Include net spending total (optional)')),
                      SelectableText(const JsonEncoder.withIndent('  ').convert(
                          metrics.aggregates(
                              includeSpending: includeSpending))),
                    ])),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: const Text('Keep offline')),
                      FilledButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: const Text('Send this request'))
                    ],
                  )));
      if (consent != true) return;
      final coaching = await ai.generateWeeklyCoaching(
          aggregates: metrics.aggregates(includeSpending: includeSpending));
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
            : ListView(padding: const EdgeInsets.all(20), children: [
                SelectableText(_metrics?.report() ?? 'No data'),
                const SizedBox(height: 16),
                const Text(
                    'Unavailable metrics are marked No data, never treated as zero. Spending is shown only in your default currency; other currencies are not converted.'),
                FilledButton(
                    onPressed: _generating ? null : _generate,
                    child: const Text('Generate AI Weekly Coaching Plan')),
                const SizedBox(height: 16),
                SelectableText(_coaching ?? ''),
              ]),
      );
}
