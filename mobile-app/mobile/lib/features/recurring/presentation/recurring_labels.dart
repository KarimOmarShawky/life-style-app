import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/features/recurring/data/recurring_task_model.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

String recurrenceFrequencyLabel(AppLocalizations l10n, String freq) {
  switch (freq) {
    case 'weekly':
      return l10n.freqWeekly;
    case 'monthly':
      return l10n.freqMonthly;
    case 'yearly':
      return l10n.freqYearly;
    default:
      return l10n.freqDaily;
  }
}

String _recurrenceUnitLabel(AppLocalizations l10n, String freq) {
  switch (freq) {
    case 'weekly':
      return l10n.unitWeeks;
    case 'monthly':
      return l10n.unitMonths;
    case 'yearly':
      return l10n.unitYears;
    default:
      return l10n.unitDays;
  }
}

String recurringStatusLabel(AppLocalizations l10n, String status) {
  switch (status) {
    case 'paused':
      return l10n.statusPaused;
    case 'ended':
      return l10n.statusEnded;
    default:
      return l10n.statusActive;
  }
}

String priorityLabel(AppLocalizations l10n, String priority) {
  switch (priority) {
    case 'low':
      return l10n.priorityLow;
    case 'medium':
      return l10n.priorityMedium;
    case 'high':
      return l10n.priorityHigh;
    default:
      return l10n.priorityNone;
  }
}

/// Short weekday name for an ISO weekday (1 = Monday ... 7 = Sunday).
String isoWeekdayLabel(BuildContext context, int isoWeekday) {
  return MaterialLocalizations.of(context).shortWeekdays[isoWeekday % 7];
}

/// Human-readable summary, for example "Weekly · Mon, Wed" or "Every 2 weeks".
String recurrenceSummary(
  BuildContext context,
  AppLocalizations l10n,
  RecurrenceRule rule,
) {
  final base = rule.interval <= 1
      ? recurrenceFrequencyLabel(l10n, rule.freq)
      : l10n.recurrenceEvery(
          rule.interval,
          _recurrenceUnitLabel(l10n, rule.freq),
        );
  if (rule.freq != 'weekly' || rule.byWeekday.isEmpty) return base;
  final days = rule.byWeekday
      .map((day) => isoWeekdayLabel(context, day))
      .join(', ');
  return '$base · $days';
}
