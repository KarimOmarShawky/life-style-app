import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_assistant_screen.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/habits/presentation/habits_screen.dart';
import 'package:lifestyle_mobile/features/money/presentation/money_screen.dart';
import 'package:lifestyle_mobile/features/notes/presentation/notes_screen.dart';
import 'package:lifestyle_mobile/features/tasks/presentation/tasks_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.user, this.initialIndex = 0});

  final AppUser user;
  final int initialIndex;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    final screens = [
      const TasksScreen(),
      const HabitsScreen(),
      const AiAssistantScreen(),
      const MoneyScreen(),
      const NotesScreen(),
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
            icon: const Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: const Icon(Icons.account_balance_wallet),
            label: l10n.money,
          ),
          NavigationDestination(
            icon: const Icon(Icons.notes_outlined),
            selectedIcon: const Icon(Icons.notes),
            label: l10n.notes,
          ),
        ],
      ),
    );
  }
}
