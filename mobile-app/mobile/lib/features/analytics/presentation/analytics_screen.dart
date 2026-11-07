import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/analytics/data/analytics_models.dart';
import 'package:lifestyle_mobile/features/habits/state/habits_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Analytics over the user's real tasks, habits, focus sessions, goals
/// and subscriptions (GET /analytics). There are no demo numbers here:
/// unavailable rates are shown as "No data", and AI insights are only
/// generated from these real aggregates after per-request consent.
class AnalyticsScreen extends ConsumerStatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  ConsumerState<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends ConsumerState<AnalyticsScreen> {
  static const _ranges = <({String label, int days})>[
    (label: '7 days', days: 7),
    (label: '30 days', days: 30),
    (label: '90 days', days: 90),
    (label: '12 months', days: 365),
  ];

  AnalyticsSummary? _summary;
  bool _loading = true;
  bool _aiLoading = false;
  String? _error;
  String? _analysisResult;
  int _selectedRangeIndex = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final summary = await ref
          .read(analyticsRepositoryProvider)
          .getAnalytics(days: _ranges[_selectedRangeIndex].days);
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      setState(() {
        _error = l10n.isArabic
            ? 'تعذر تحميل بياناتك. تحقق من الاتصال وحاول مرة أخرى.'
            : 'Could not load your data. Check your connection and try again.';
        _loading = false;
      });
    }
  }

  Future<Map<String, num>> _streaks() async {
    try {
      final habits = await ref.read(habitsRepositoryProvider).listHabits();
      final active = habits
          .where((habit) => habit.status == 'active')
          .toList(growable: false);
      if (active.isEmpty) return const {};
      return <String, num>{
        'habitsWithActiveStreak':
            active.where((habit) => habit.currentStreak > 0).length,
        'longestCurrentStreak':
            active.map((habit) => habit.currentStreak).reduce(
                  (a, b) => a > b ? a : b,
                ),
      };
    } catch (_) {
      return const {};
    }
  }

  Future<bool> _confirmSend(Map<String, num> payload) async {
    final l10n = AppLocalizations.of(context);
    final consent = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          l10n.isArabic
              ? 'إرسال أرقام مجمعة إلى Gemini؟'
              : 'Send aggregated numbers to Gemini?',
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.isArabic
                    ? 'سيتم إرسال هذه الأعداد والمعدلات فقط. لا عناوين مهام أو ملاحظات أو أي محتوى شخصي. تتم الموافقة لكل طلب على حدة.'
                    : 'Only these counts and rates will be sent. No task titles, notes, or personal content. Consent is requested for every request.',
              ),
              const SizedBox(height: 12),
              SelectableText(
                const JsonEncoder.withIndent('  ').convert(payload),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.isArabic ? 'عدم الإرسال' : 'Keep offline'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child:
                Text(l10n.isArabic ? 'إرسال هذا الطلب' : 'Send this request'),
          ),
        ],
      ),
    );
    return consent == true;
  }

  Future<void> _runAi({required bool dashboard}) async {
    final summary = _summary;
    if (summary == null || _aiLoading) return;
    final l10n = AppLocalizations.of(context);
    final ai = AiService.instance;
    if (ai.isPaused) {
      if (!mounted) return;
      setState(() {
        _analysisResult = l10n.isArabic
            ? 'رؤى الذكاء الاصطناعي متوقفة مؤقتاً بعد محاولات فاشلة متكررة. أرقامك الحقيقية ظاهرة بالأعلى، وحاول مرة أخرى بعد قليل.'
            : 'AI insights are temporarily paused after repeated failures. Your real numbers above still work; please try again shortly.';
      });
      return;
    }
    final streaks = await _streaks();
    if (!mounted) return;
    final aggregates = summary.aiAggregates(streaks: streaks);
    if (!await _confirmSend(aggregates)) return;
    if (!mounted) return;
    setState(() {
      _aiLoading = true;
      _analysisResult = null;
    });
    try {
      final result = dashboard
          ? await ai.getPerformanceDashboard(
              metrics: aggregates,
              streaks: streaks,
              highlights: <String, dynamic>{
                'tasksCompleted': summary.tasksCompleted,
                'focusMinutes': summary.focusMinutes,
                'habitCheckins': summary.habitCheckinsDone,
              },
              languageName: l10n.promptLanguageName,
            )
          : await ai.getCumulativeAnalysis(
              aggregates: aggregates,
              weeklyTrends: summary.aiWeeklyTrends(),
              timeRange: _ranges[_selectedRangeIndex].label,
              languageName: l10n.promptLanguageName,
            );
      if (!mounted) return;
      setState(() {
        _analysisResult = result ??
            (l10n.isArabic
                ? 'تعذر الحصول على التحليل الآن. أرقامك الحقيقية بالأعلى محدثة.'
                : 'Could not get an analysis right now. Your real numbers above are up to date.');
        _aiLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _analysisResult = l10n.isArabic
            ? 'حدث خطأ أثناء التحليل. أرقامك الحقيقية بالأعلى محدثة.'
            : 'Analysis failed. Your real numbers above are up to date.';
        _aiLoading = false;
      });
    }
  }

  String _percent(double? value, AppLocalizations l10n) => value == null
      ? (l10n.isArabic ? 'لا توجد بيانات' : 'No data')
      : '${value.toStringAsFixed(value % 1 == 0 ? 0 : 1)}%';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final summary = _summary;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Icon(Icons.insights, size: 20, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text(l10n.analyticsTitle),
          ],
        ),
        actions: [
          IconButton(
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: l10n.isArabic ? 'تحديث' : 'Refresh',
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Text(l10n.analyticsTimeRange,
                      style: theme.textTheme.labelLarge),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: List.generate(
                        _ranges.length,
                        (index) => FilterChip(
                          label: Text(_ranges[index].label),
                          selected: _selectedRangeIndex == index,
                          onSelected: _loading
                              ? null
                              : (_) {
                                  setState(() {
                                    _selectedRangeIndex = index;
                                    _analysisResult = null;
                                  });
                                  _load();
                                },
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.all(32),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_error != null)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.red.withAlpha(20),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    children: [
                      Text(_error!, style: const TextStyle(color: Colors.red)),
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: _load,
                        child: Text(l10n.isArabic ? 'حاول مجددًا' : 'Retry'),
                      ),
                    ],
                  ),
                )
              else if (summary != null) ...[
                if (summary.isEmpty)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        l10n.isArabic
                            ? 'لا يوجد نشاط مسجل في هذه الفترة بعد. أكمل مهام وعادات وجلسات تركيز وستظهر أرقامك الحقيقية هنا.'
                            : 'No recorded activity in this range yet. Complete tasks, habits and focus sessions and your real numbers will appear here.',
                      ),
                    ),
                  ),
                _MetricGrid(summary: summary, percent: _percent),
                const SizedBox(height: 16),
                _TrendBars(summary: summary),
                const SizedBox(height: 24),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    FilledButton.icon(
                      onPressed:
                          _aiLoading ? null : () => _runAi(dashboard: false),
                      icon: const Icon(Icons.analytics),
                      label: Text(l10n.analyticsCumulative),
                    ),
                    FilledButton.icon(
                      onPressed:
                          _aiLoading ? null : () => _runAi(dashboard: true),
                      icon: const Icon(Icons.dashboard),
                      label: Text(l10n.analyticsDashboard),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                if (_aiLoading)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_analysisResult != null)
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: SelectableText(
                      _analysisResult!,
                      style: const TextStyle(fontSize: 14, height: 1.5),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.summary, required this.percent});

  final AnalyticsSummary summary;
  final String Function(double?, AppLocalizations) percent;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final arabic = l10n.isArabic;
    final metrics = <({String label, String value})>[
      (
        label: arabic ? 'مهام مكتملة' : 'Tasks completed',
        value: '${summary.tasksCompleted}',
      ),
      (
        label: arabic ? 'معدل إكمال المهام' : 'Task completion rate',
        value: percent(summary.taskCompletionRatePercent, l10n),
      ),
      (
        label: arabic ? 'مهام قيد الانتظار' : 'Tasks pending',
        value: '${summary.tasksPending}',
      ),
      (
        label: arabic ? 'مهام متأخرة' : 'Tasks overdue',
        value: '${summary.tasksOverdue}',
      ),
      (
        label: arabic ? 'تسجيلات عادات' : 'Habit check-ins',
        value: '${summary.habitCheckinsDone}',
      ),
      (
        label: arabic ? 'اتساق العادات' : 'Habit consistency',
        value: percent(summary.habitConsistencyPercent, l10n),
      ),
      (
        label: arabic ? 'دقائق التركيز' : 'Focus minutes',
        value: summary.focusMinutes % 1 == 0
            ? '${summary.focusMinutes.toInt()}'
            : summary.focusMinutes.toStringAsFixed(1),
      ),
      (
        label: arabic ? 'جلسات التركيز' : 'Focus sessions',
        value: '${summary.focusSessions}',
      ),
      (
        label: arabic ? 'أهداف نشطة' : 'Active goals',
        value: '${summary.goalsActive}',
      ),
      (
        label: arabic ? 'تقدم الأهداف الرقمية' : 'Numeric goal progress',
        value: percent(summary.goalProgressPercent, l10n),
      ),
      (
        label: arabic ? 'اشتراكات نشطة' : 'Active subscriptions',
        value: '${summary.subscriptionsActive}',
      ),
      (
        label: arabic ? 'تجديدات خلال ٧ أيام' : 'Renewals in 7 days',
        value: '${summary.subscriptionsDueNext7Days}',
      ),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      childAspectRatio: 1.9,
      children: metrics
          .map(
            (metric) => Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      metric.value,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      metric.label,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          )
          .toList(growable: false),
    );
  }
}

class _TrendBars extends StatelessWidget {
  const _TrendBars({required this.summary});

  final AnalyticsSummary summary;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final maxTasks = summary.series
        .map((point) => point.tasksCompleted)
        .fold<int>(0, (a, b) => a > b ? a : b);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.isArabic
                  ? 'مهام مكتملة عبر الفترة'
                  : 'Tasks completed over time',
              style: theme.textTheme.titleSmall,
            ),
            const SizedBox(height: 12),
            if (summary.series.isEmpty || maxTasks == 0)
              Text(
                l10n.isArabic
                    ? 'لا توجد مهام مكتملة في هذه الفترة.'
                    : 'No completed tasks in this range.',
                style: theme.textTheme.bodyMedium,
              )
            else
              SizedBox(
                height: 96,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: summary.series
                      .map(
                        (point) => Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 1),
                            child: Tooltip(
                              message: '${point.date}: ${point.tasksCompleted}',
                              child: Container(
                                height:
                                    8 + 88 * (point.tasksCompleted / maxTasks),
                                decoration: BoxDecoration(
                                  color: theme.colorScheme.primary,
                                  borderRadius: BorderRadius.circular(3),
                                ),
                              ),
                            ),
                          ),
                        ),
                      )
                      .toList(growable: false),
                ),
              ),
            const SizedBox(height: 8),
            Text(
              '${summary.from} → ${summary.to}',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
