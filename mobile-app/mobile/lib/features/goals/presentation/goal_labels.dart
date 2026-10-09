import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Localized label for a goal status value from the API.
String goalStatusLabel(AppLocalizations l10n, String status) {
  switch (status) {
    case 'paused':
      return l10n.statusPaused;
    case 'achieved':
      return l10n.statusAchieved;
    case 'abandoned':
      return l10n.statusAbandoned;
    default:
      return l10n.statusActive;
  }
}
