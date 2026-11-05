import 'package:lifestyle_mobile/features/focus_shield/routine_wizard_screen.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_assistant_screen.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_reminder_notifications.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/habits/presentation/habits_screen.dart';
import 'package:lifestyle_mobile/features/money/data/pending_wallet_reviews.dart';
import 'package:lifestyle_mobile/features/money/data/pending_wallet_transactions.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_ingest_token.dart';
import 'package:lifestyle_mobile/features/money/presentation/money_screen.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
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
  bool _flushingWalletQueue = false;
  bool _syncingSubscriptionReminders = false;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _flushWalletQueue();
      _ensureWalletIngestToken();
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
      _flushWalletQueue();
      _ensureWalletIngestToken();
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

  /// Keeps the token that the SMS receiver uses in step with the SMS capture setting.
  Future<void> _ensureWalletIngestToken() async {
    try {
      await WalletIngestToken(ref.read(apiClientProvider)).ensure(
        account: widget.user.id,
        currentAccount: () => ref.read(authProvider.notifier).walletAccount,
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Background wallet sync is unavailable. Check connection and secure storage, then retry.',
            ),
          ),
        );
      }
    }
  }

  /// Sends the SMS transactions that were captured while the app was not running,
  /// then retries any fallback candidates the receiver could not deliver (the
  /// backend fallback turns them into auto-saved transactions or review items).
  Future<void> _flushWalletQueue() async {
    if (_flushingWalletQueue) return;
    _flushingWalletQueue = true;
    try {
      final controller = ref.read(authProvider.notifier);
      final account = widget.user.id;
      final generation = controller.walletGeneration;
      bool stillCurrent() =>
          mounted &&
          identical(ref.read(authProvider.notifier), controller) &&
          controller.walletWorkIsCurrent(account, generation);
      if (!stillCurrent()) return;
      final stored = await PendingWalletTransactions(
        ref.read(moneyRepositoryProvider),
        stillCurrent: stillCurrent,
      ).flush();
      if (!stillCurrent()) return;
      final resolvedCandidates = await PendingWalletCandidates(
        ref.read(apiClientProvider),
        ref.read(moneyRepositoryProvider),
        stillCurrent: stillCurrent,
      ).flush();
      if (stillCurrent() && (stored > 0 || resolvedCandidates > 0)) {
        ref.invalidate(budgetsProvider);
        ref.invalidate(subscriptionsProvider);
      }
    } finally {
      _flushingWalletQueue = false;
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
      const MoneyScreen(),
      const NotesScreen(),
      const MoreScreen(),
    ];

    return Scaffold(
      floatingActionButtonLocation: FloatingActionButtonLocation.startFloat,
      floatingActionButton: FloatingActionButton.small(
          heroTag: 'daily-routines',
          tooltip: 'Daily routines',
          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => const RoutineWizardScreen())),
          child: const Icon(Icons.wb_twilight)),
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
