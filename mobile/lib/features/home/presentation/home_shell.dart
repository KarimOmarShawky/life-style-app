import 'package:flutter/material.dart';

import '../../../data/models.dart';
import '../../auth/presentation/profile_screen.dart';
import '../../habits/presentation/habits_screen.dart';
import '../../money/presentation/money_screen.dart';
import '../../notes/presentation/notes_screen.dart';
import '../../tasks/presentation/tasks_screen.dart';

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
    final screens = [
      const TasksScreen(),
      const HabitsScreen(),
      const MoneyScreen(),
      const NotesScreen(),
      ProfileScreen(user: widget.user),
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
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.check_box_outlined),
            selectedIcon: Icon(Icons.check_box),
            label: 'Tasks',
          ),
          NavigationDestination(
            icon: Icon(Icons.repeat),
            selectedIcon: Icon(Icons.repeat),
            label: 'Habits',
          ),
          NavigationDestination(
            icon: Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: Icon(Icons.account_balance_wallet),
            label: 'Money',
          ),
          NavigationDestination(
            icon: Icon(Icons.notes_outlined),
            selectedIcon: Icon(Icons.notes),
            label: 'Notes',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
