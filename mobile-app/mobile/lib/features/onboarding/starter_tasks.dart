import 'package:flutter/material.dart';

import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Focus areas offered by first-run onboarding (feature guide G1).
enum StarterArea { study, work, routine }

String starterAreaLabel(AppLocalizations l10n, StarterArea area) =>
    switch (area) {
      StarterArea.study => l10n.onboardingAreaStudy,
      StarterArea.work => l10n.onboardingAreaWork,
      StarterArea.routine => l10n.onboardingAreaRoutine,
    };

IconData starterAreaIcon(StarterArea area) => switch (area) {
      StarterArea.study => Icons.menu_book_outlined,
      StarterArea.work => Icons.work_outline,
      StarterArea.routine => Icons.self_improvement,
    };

/// Three small tasks per area that can be done right away, in the app
/// language, so a new account gets a first win without typing.
List<String> starterTitles(AppLocalizations l10n, StarterArea area) =>
    switch (area) {
      StarterArea.study => [
          l10n.starterClearDesk,
          l10n.starterPickLesson,
          l10n.starterFocusSession,
        ],
      StarterArea.work => [
          l10n.starterTopPriority,
          l10n.starterReplyMessage,
          l10n.starterFocusSession,
        ],
      StarterArea.routine => [
          l10n.starterWater,
          l10n.starterWalk,
          l10n.starterStretch,
        ],
    };
