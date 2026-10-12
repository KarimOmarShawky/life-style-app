import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/more/data/daily_plan_models.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class DailyPlanScreen extends ConsumerStatefulWidget {
  const DailyPlanScreen({super.key});

  @override
  ConsumerState<DailyPlanScreen> createState() => _DailyPlanScreenState();
}

class _DailyPlanScreenState extends ConsumerState<DailyPlanScreen> {
  DateTime _selectedDate = DateTime.now();
  DashboardOverview? _overview;
  DayPlanView? _dayPlan;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  String _formatDateKey(DateTime d) {
    final y = d.year.toString().padLeft(4, '0');
    final m = d.month.toString().padLeft(2, '0');
    final day = d.day.toString().padLeft(2, '0');
    return '$y-$m-$day';
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repo = ref.read(dailyPlanRepositoryProvider);
      final dateKey = _formatDateKey(_selectedDate);
      final results = await Future.wait<Object>(<Future<Object>>[
        repo.getDashboardOverview(),
        repo.getDayPlan(date: dateKey),
      ]);
      if (!mounted) return;
      setState(() {
        _overview = results[0] as DashboardOverview;
        _dayPlan = results[1] as DayPlanView;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked == null || !mounted) return;
    setState(() => _selectedDate = picked);
    await _loadData();
  }

  void _shiftDay(int deltaDays) {
    setState(() {
      _selectedDate = _selectedDate.add(Duration(days: deltaDays));
    });
    _loadData();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isAr = l10n.isArabic;
    final theme = Theme.of(context);
    final dateKey = _formatDateKey(_selectedDate);

    return Scaffold(
      appBar: AppBar(
        title: Text(isAr ? 'خطة اليوم والملخص' : 'Daily Plan & Overview'),
        actions: [
          IconButton(
            tooltip: l10n.jumpToDate,
            icon: const Icon(Icons.calendar_today_outlined),
            onPressed: _pickDate,
          ),
          IconButton(
            tooltip: l10n.retry,
            icon: const Icon(Icons.refresh),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: _loadData,
                          child: Text(l10n.retry),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (_overview != null) ...[
                        _buildOverviewGrid(context, _overview!, l10n, isAr),
                        const SizedBox(height: 16),
                      ],
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 6,
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              IconButton(
                                tooltip: l10n.previousDay,
                                icon: const Icon(Icons.chevron_left),
                                onPressed: () => _shiftDay(-1),
                              ),
                              InkWell(
                                onTap: _pickDate,
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 6,
                                  ),
                                  child: Text(
                                    dateKey,
                                    style: theme.textTheme.titleMedium
                                        ?.copyWith(fontWeight: FontWeight.bold),
                                  ),
                                ),
                              ),
                              IconButton(
                                tooltip: l10n.nextDay,
                                icon: const Icon(Icons.chevron_right),
                                onPressed: () => _shiftDay(1),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      if (_dayPlan != null)
                        ..._buildDaySections(context, _dayPlan!, l10n, isAr),
                    ],
                  ),
                ),
    );
  }

  Widget _buildOverviewGrid(
    BuildContext context,
    DashboardOverview overview,
    AppLocalizations l10n,
    bool isAr,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: _StatCard(
                icon: Icons.check_circle_outline,
                title: l10n.tasks,
                value: '${overview.tasksDoneToday} / ${overview.tasksDueToday + overview.tasksDoneToday}',
                subtitle: overview.tasksOverdue > 0
                    ? (isAr
                        ? '${overview.tasksOverdue} متأخرة'
                        : '${overview.tasksOverdue} overdue')
                    : l10n.today,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _StatCard(
                icon: Icons.repeat,
                title: l10n.habits,
                value: '${overview.habitsCompletedToday} / ${overview.habitsDueToday}',
                subtitle: l10n.completedToday,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _StatCard(
                icon: Icons.event_outlined,
                title: l10n.calendarTitle,
                value: '${overview.eventsToday}',
                subtitle: l10n.today,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _StatCard(
                icon: Icons.account_balance_wallet_outlined,
                title: l10n.subscriptionsTitle,
                value: '${overview.subscriptionsDueCount}',
                subtitle: isAr
                    ? 'خلال 7 أيام (${overview.activeSubscriptions} نشط)'
                    : 'Next 7d (${overview.activeSubscriptions} active)',
              ),
            ),
          ],
        ),
      ],
    );
  }

  List<Widget> _buildDaySections(
    BuildContext context,
    DayPlanView plan,
    AppLocalizations l10n,
    bool isAr,
  ) {
    final theme = Theme.of(context);
    return <Widget>[
      _SectionHeader(
        icon: Icons.check_box_outlined,
        title: '${l10n.tasks} (${plan.tasks.length})',
      ),
      if (plan.tasks.isEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            l10n.noTasksForDay,
            style: TextStyle(color: theme.colorScheme.outline),
          ),
        )
      else
        ...plan.tasks.map(
          (task) => Card(
            child: ListTile(
              leading: Icon(
                task.isDone ? Icons.check_circle : Icons.radio_button_unchecked,
                color: task.isDone ? Colors.green : theme.colorScheme.primary,
              ),
              title: Text(task.title),
              subtitle: task.dueTime != null ? Text(task.dueTime!) : null,
            ),
          ),
        ),
      const SizedBox(height: 12),
      _SectionHeader(
        icon: Icons.repeat,
        title: '${l10n.habits} (${plan.habits.length})',
      ),
      if (plan.habits.isEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            l10n.noHabits,
            style: TextStyle(color: theme.colorScheme.outline),
          ),
        )
      else
        ...plan.habits.map(
          (habit) => Card(
            child: ListTile(
              leading: Icon(
                habit.completedOn ? Icons.check_circle : Icons.circle_outlined,
                color: habit.completedOn ? Colors.green : theme.colorScheme.primary,
              ),
              title: Text(habit.name),
            ),
          ),
        ),
      const SizedBox(height: 12),
      _SectionHeader(
        icon: Icons.event_outlined,
        title: '${l10n.calendarTitle} (${plan.events.length})',
      ),
      if (plan.events.isEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            l10n.noEventsForDay,
            style: TextStyle(color: theme.colorScheme.outline),
          ),
        )
      else
        ...plan.events.map(
          (event) => Card(
            child: ListTile(
              leading: const Icon(Icons.event),
              title: Text(event.title),
              subtitle: event.location != null ? Text(event.location!) : null,
            ),
          ),
        ),
      if (plan.subscriptionsDue.isNotEmpty) ...[
        const SizedBox(height: 12),
        _SectionHeader(
          icon: Icons.payments_outlined,
          title: '${l10n.subscriptionsTitle} (${plan.subscriptionsDue.length})',
        ),
        ...plan.subscriptionsDue.map(
          (sub) => Card(
            child: ListTile(
              leading: const Icon(Icons.repeat),
              title: Text(sub.name),
              subtitle: Text('${sub.formattedAmount} ${sub.currency}'),
            ),
          ),
        ),
      ],
    ];
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.title,
    required this.value,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String value;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    title,
                    style: theme.textTheme.labelMedium,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              value,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.outline,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.icon, required this.title});

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: theme.colorScheme.primary),
          const SizedBox(width: 8),
          Text(
            title,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.bold,
              color: theme.colorScheme.primary,
            ),
          ),
        ],
      ),
    );
  }
}
