import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_assistant_screen.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_reminder_notifications.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/habits/presentation/habits_screen.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
import 'package:lifestyle_mobile/features/focus/presentation/focus_home_screen.dart';
import 'package:lifestyle_mobile/features/more/presentation/more_screen.dart';
import 'package:lifestyle_mobile/features/notes/presentation/notes_screen.dart';
import 'package:lifestyle_mobile/features/tasks/presentation/tasks_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key, required this.user, this.initialIndex = 0});

  final AppUser user;
  final int initialIndex;

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell>
    with WidgetsBindingObserver {
  late int _currentIndex;
  bool _syncingSubscriptionReminders = false;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      rescheduleCalendarReminders();
      _syncRenewalReminders();
      ref.read(focusShieldProvider.notifier).refreshNative();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _syncRenewalReminders();
      ref.read(focusShieldProvider.notifier).refreshNative();
    }
  }

  Future<void> _syncRenewalReminders() async {
    if (_syncingSubscriptionReminders) return;
    _syncingSubscriptionReminders = true;
    try {
      await syncSubscriptionReminders(ref);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(AppLocalizations.of(context)
                  .subscriptionReminderUnavailable)),
        );
      }
    } finally {
      _syncingSubscriptionReminders = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(focusShieldProvider);
    final l10n = AppLocalizations.of(context);

    final screens = [
      const TasksScreen(),
      const HabitsScreen(),
      const AiAssistantScreen(),
      const NotesScreen(),
      const FocusHomeScreen(),
      const MoreScreen(),
    ];

    return Scaffold(
      body: IndexedStack(index: _currentIndex, children: screens),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) {
          setState(() {
            _currentIndex = index;
          });
        },
        labelBehavior: labelBehaviorForTextScale(
          MediaQuery.textScalerOf(context).scale(14) / 14,
        ),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.check_box_outlined),
            selectedIcon: const Icon(Icons.check_box),
            label: l10n.tasks,
          ),
          NavigationDestination(
            icon: const Icon(Icons.repeat),
            selectedIcon: const Icon(Icons.repeat),
            label: l10n.habits,
          ),
          NavigationDestination(
            icon: const Icon(Icons.auto_awesome_outlined),
            selectedIcon: const Icon(Icons.auto_awesome),
            label: l10n.aiAssistant,
          ),
          NavigationDestination(
            icon: const Icon(Icons.notes_outlined),
            selectedIcon: const Icon(Icons.notes),
            label: l10n.notes,
          ),
          NavigationDestination(
            icon: const Icon(Icons.center_focus_strong_outlined),
            selectedIcon: const Icon(Icons.center_focus_strong),
            label: l10n.tr('focus'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.grid_view_outlined),
            selectedIcon: const Icon(Icons.grid_view),
            label: l10n.moreTitle,
          ),
        ],
      ),
    );
  }
}

/// With six destinations, tab labels are the first thing to clip when
/// the system font grows. Past this scale only the selected tab keeps
/// its label, so nothing wraps or truncates on narrow screens.
NavigationDestinationLabelBehavior labelBehaviorForTextScale(double scale) =>
    scale > 1.4
        ? NavigationDestinationLabelBehavior.onlyShowSelected
        : NavigationDestinationLabelBehavior.alwaysShow;
