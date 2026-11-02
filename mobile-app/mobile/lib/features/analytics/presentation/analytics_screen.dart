import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class AnalyticsScreen extends ConsumerStatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  ConsumerState<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends ConsumerState<AnalyticsScreen> {
  String? _analysisResult;
  bool _isLoading = false;
  String? _error;
  int _selectedRangeIndex = 0;

  final List<String> _timeRanges = [
    '7 days',
    '30 days',
    '90 days',
    '12 months',
  ];

  Future<void> _runAnalysis() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _isLoading = true;
      _error = null;
      _analysisResult = null;
    });

    try {
      final result = await AiService.instance.getCumulativeAnalysis(
        aggregates: const {
          'tasksCompleted': 42,
          'tasksTotal': 60,
          'habitsCompleted': 18,
          'habitsTotal': 24,
          'goalsOnTrack': 3,
          'goalsTotal': 5,
          'moneySpent': 1500,
          'moneyBudget': 2000,
        },
        weeklyTrends: const [
          {'tasks': 8, 'habits': 5, 'focusMinutes': 120},
          {'tasks': 6, 'habits': 4, 'focusMinutes': 90},
          {'tasks': 9, 'habits': 6, 'focusMinutes': 150},
        ],
        timeRange: _timeRanges[_selectedRangeIndex],
        languageName: l10n.promptLanguageName,
      );

      if (!mounted) return;
      setState(() {
        _analysisResult = result ??
            (l10n.isArabic
                ? 'تعذر الحصول على التحليل. تأكد من إضافة مفتاح Gemini API.'
                : 'Could not load analysis. Please add your Gemini API key.');
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = l10n.isArabic
            ? 'حدث خطأ أثناء التحميل. يرجى المحاولة مرة أخرى.'
            : 'An error occurred. Please try again.';
        _isLoading = false;
      });
    }
  }

  Future<void> _runPerformanceDashboard() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _isLoading = true;
      _error = null;
      _analysisResult = null;
    });

    try {
      final result = await AiService.instance.getPerformanceDashboard(
        metrics: const {
          'taskCompletionRate': 70,
          'habitConsistency': 75,
          'goalProgress': 60,
          'focusMinutesWeekly': 450,
        },
        streaks: const {
          'taskStreak': 5,
          'habitStreak': 12,
          'focusStreak': 3,
        },
        highlights: const [
          'Completed 42 tasks this month',
          'Maintained 12-day habit streak',
        ],
        languageName: l10n.promptLanguageName,
      );

      if (!mounted) return;
      setState(() {
        _analysisResult = result ??
            (l10n.isArabic
                ? 'تعذر الحصول على الداش بورد. تأكد من إضافة مفتاح Gemini API.'
                : 'Could not load dashboard. Please add your Gemini API key.');
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = l10n.isArabic
            ? 'حدث خطأ أثناء التحميل. يرجى المحاولة مرة أخرى.'
            : 'An error occurred. Please try again.';
        _isLoading = false;
      });
    }
  }

  Future<void> _runLifeBalance() async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _isLoading = true;
      _error = null;
      _analysisResult = null;
    });

    try {
      final result = await AiService.instance.getLifeBalanceScore(
        categoryScores: const {
          'work': 7,
          'health': 6,
          'finance': 8,
          'social': 5,
          'personal': 6,
        },
        weights: const {
          'work': 0.25,
          'health': 0.25,
          'finance': 0.2,
          'social': 0.15,
          'personal': 0.15,
        },
        languageName: l10n.promptLanguageName,
      );

      if (!mounted) return;
      setState(() {
        _analysisResult = result ??
            (l10n.isArabic
                ? 'تعذر الحصول على نقاط توازن الحياة. تأكد من إضافة مفتاح Gemini API.'
                : 'Could not load balance score. Please add your Gemini API key.');
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = l10n.isArabic
            ? 'حدث خطأ أثناء التحميل. يرجى المحاولة مرة أخرى.'
            : 'An error occurred. Please try again.';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Icon(Icons.insights,
                size: 20, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text(l10n.analyticsTitle),
          ],
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Time range selector
              Row(
                children: [
                  Text(
                    l10n.analyticsTimeRange,
                    style: theme.textTheme.labelLarge,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: List.generate(
                        _timeRanges.length,
                        (index) => FilterChip(
                          label: Text(_timeRanges[index]),
                          selected: _selectedRangeIndex == index,
                          onSelected: (_) =>
                              setState(() => _selectedRangeIndex = index),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),

              // Action buttons
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  FilledButton.icon(
                    onPressed: _isLoading ? null : _runAnalysis,
                    icon: const Icon(Icons.analytics),
                    label: Text(l10n.analyticsCumulative),
                  ),
                  FilledButton.icon(
                    onPressed: _isLoading ? null : _runPerformanceDashboard,
                    icon: const Icon(Icons.dashboard),
                    label: Text(l10n.analyticsDashboard),
                  ),
                  FilledButton.icon(
                    onPressed: _isLoading ? null : _runLifeBalance,
                    icon: const Icon(Icons.scale_balance),
                    label: Text(l10n.analyticsBalance),
                  ),
                ],
              ),
              const SizedBox(height: 24),

              // Results area
              if (_isLoading)
                const Padding(
                  padding: EdgeInsets.all(32),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_error != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.red.withAlpha(20),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ),
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
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.5,
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                )
              else
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    l10n.analyticsEmpty,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
