import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Localized label for a project status value from the API.
String projectStatusLabel(AppLocalizations l10n, String status) {
  switch (status) {
    case 'on_hold':
      return l10n.statusOnHold;
    case 'completed':
      return l10n.statusCompleted;
    case 'archived':
      return l10n.statusArchived;
    default:
      return l10n.statusActive;
  }
}
