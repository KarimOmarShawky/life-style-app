import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Reminder offsets (minutes before the event starts) offered in the event form.
const List<int> reminderOffsetChoices = [0, 10, 15, 30, 60, 120, 1440];

/// Human-readable reminder offset, for example "At start", "15 min before", "1 day before".
String reminderOffsetLabel(AppLocalizations l10n, int minutes) {
  if (minutes == 0) return l10n.reminderAtStart;
  if (minutes % 1440 == 0) return l10n.daysBefore(minutes ~/ 1440);
  if (minutes % 60 == 0) return l10n.hoursBefore(minutes ~/ 60);
  return l10n.minutesBefore(minutes);
}
