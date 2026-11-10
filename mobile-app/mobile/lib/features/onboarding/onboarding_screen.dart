import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:lifestyle_mobile/data/notification_service.dart';
import 'package:lifestyle_mobile/data/product_events.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/onboarding/onboarding_store.dart';
import 'package:lifestyle_mobile/features/onboarding/starter_tasks.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// First-run flow for a new account (feature guide G1 with E4): pick a
/// focus, get three starter tasks for today without typing, complete one,
/// and only then decide about reminders. Skip is always available, and a
/// failure never blocks the way into the app.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({
    super.key,
    required this.user,
    this.requestReminderPermission,
  });

  final AppUser user;

  /// Test seam; defaults to [NotificationService.requestPermissionsIfNeeded].
  final Future<void> Function()? requestReminderPermission;

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

enum _Step { checking, chooseFocus, firstWin, celebrate }

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  _Step _step = _Step.checking;
  bool _busy = false;
  String? _error;
  List<Task> _tasks = const <Task>[];

  @override
  void initState() {
    super.initState();
    _begin();
  }

  Future<void> _begin() async {
    var finishedBefore = false;
    try {
      finishedBefore = await isOnboardingDoneLocally(widget.user.id);
    } catch (_) {
      // Unreadable preferences: show onboarding; skipping stays possible.
    }
    if (!mounted) return;
    if (finishedBefore) {
      // Finished while offline earlier: only retry the server flag.
      await _finish();
      return;
    }
    ref.recordProductEvent(ProductEvent.onboardingStarted);
    setState(() => _step = _Step.chooseFocus);
  }

  Future<void> _finish() async {
    try {
      await ref.read(authProvider.notifier).completeOnboarding();
    } catch (_) {
      // The session changed meanwhile; the app shell takes over.
    }
  }

  Future<void> _skip() async {
    setState(() => _busy = true);
    ref.recordProductEvent(ProductEvent.onboardingSkipped);
    await _finish();
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _addStarters(StarterArea area) async {
    final l10n = AppLocalizations.of(context);
    final repository = ref.read(tasksRepositoryProvider);
    final today = _localDateKey(DateTime.now());
    setState(() {
      _busy = true;
      _error = null;
    });
    final created = <Task>[];
    for (final title in starterTitles(l10n, area)) {
      try {
        created.add(await repository.createTask(title: title, dueDate: today));
      } catch (_) {
        break;
      }
    }
    if (!mounted) return;
    if (created.isNotEmpty) ref.invalidate(tasksProvider);
    setState(() {
      _busy = false;
      if (created.isEmpty) {
        _error = l10n.onboardingAddFailed;
      } else {
        _tasks = created;
        _step = _Step.firstWin;
      }
    });
  }

  Future<void> _completeTask(Task task) async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(tasksRepositoryProvider).setDone(task, true);
      if (!mounted) return;
      ref.recordProductEvent(ProductEvent.taskCompleted);
      ref.invalidate(tasksProvider);
      HapticFeedback.lightImpact();
      setState(() {
        _busy = false;
        _step = _Step.celebrate;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = l10n.onboardingCompleteFailed;
      });
    }
  }

  /// Notification permission is asked only here, after the first win
  /// (P0-F5). Denying it, or any error, still finishes onboarding.
  Future<void> _decideReminders(bool enable) async {
    setState(() => _busy = true);
    if (enable) {
      try {
        final request = widget.requestReminderPermission;
        if (request != null) {
          await request();
        } else {
          await NotificationService.instance.requestPermissionsIfNeeded();
        }
      } catch (_) {
        // Denied or unavailable: reminders stay off.
      }
    }
    if (!mounted) return;
    ref.recordProductEvent(ProductEvent.onboardingCompleted);
    await _finish();
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final canSkip = _step == _Step.chooseFocus || _step == _Step.firstWin;
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        actions: [
          if (canSkip)
            TextButton(
              onPressed: _busy ? null : _skip,
              child: Text(l10n.onboardingSkip),
            ),
        ],
      ),
      body: SafeArea(
        // A fresh subtree per step, so each step starts scrolled to the top.
        child: KeyedSubtree(
          key: ValueKey<_Step>(_step),
          child: switch (_step) {
            _Step.checking => const Center(child: CircularProgressIndicator()),
            _Step.chooseFocus => _chooseFocus(l10n, theme),
            _Step.firstWin => _firstWin(l10n, theme),
            _Step.celebrate => _celebrate(l10n, theme),
          },
        ),
      ),
    );
  }

  Widget _chooseFocus(AppLocalizations l10n, ThemeData theme) => ListView(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        children: [
          _Heading(text: l10n.onboardingTitle),
          const SizedBox(height: 8),
          Text(l10n.onboardingSubtitle, style: theme.textTheme.bodyLarge),
          const SizedBox(height: 24),
          for (final area in StarterArea.values)
            Card(
              child: ListTile(
                leading: Icon(starterAreaIcon(area)),
                title: Text(starterAreaLabel(l10n, area)),
                subtitle: Text(starterTitles(l10n, area).join(' · ')),
                enabled: !_busy,
                onTap: () => _addStarters(area),
              ),
            ),
          if (_busy) const _Progress(),
          if (_error != null) _ErrorNote(message: _error!),
        ],
      );

  Widget _firstWin(AppLocalizations l10n, ThemeData theme) => ListView(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        children: [
          _Heading(text: l10n.onboardingFirstWinTitle),
          const SizedBox(height: 8),
          Text(
            l10n.onboardingFirstWinSubtitle,
            style: theme.textTheme.bodyLarge,
          ),
          const SizedBox(height: 16),
          for (final task in _tasks)
            CheckboxListTile(
              value: false,
              onChanged: _busy ? null : (_) => _completeTask(task),
              title: Text(task.title),
              controlAffinity: ListTileControlAffinity.leading,
            ),
          if (_busy) const _Progress(),
          if (_error != null) _ErrorNote(message: _error!),
        ],
      );

  Widget _celebrate(AppLocalizations l10n, ThemeData theme) => ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Icon(
            Icons.celebration_outlined,
            size: 64,
            color: theme.colorScheme.primary,
          ),
          const SizedBox(height: 16),
          _Heading(
            text: l10n.onboardingCelebrateTitle,
            textAlign: TextAlign.center,
            announce: true,
          ),
          const SizedBox(height: 8),
          Text(
            l10n.onboardingCelebrateBody,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyLarge,
          ),
          const SizedBox(height: 32),
          Text(
            l10n.onboardingRemindersQuestion,
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _busy ? null : () => _decideReminders(true),
            icon: const Icon(Icons.notifications_active_outlined),
            label: Text(l10n.onboardingEnableReminders),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _busy ? null : () => _decideReminders(false),
            child: Text(l10n.onboardingNotNow),
          ),
        ],
      );
}

String _localDateKey(DateTime now) {
  final month = now.month.toString().padLeft(2, '0');
  final day = now.day.toString().padLeft(2, '0');
  return '${now.year}-$month-$day';
}

class _Heading extends StatelessWidget {
  const _Heading({
    required this.text,
    this.textAlign,
    this.announce = false,
  });

  final String text;
  final TextAlign? textAlign;
  final bool announce;

  @override
  Widget build(BuildContext context) => Semantics(
        header: true,
        liveRegion: announce,
        child: Text(
          text,
          textAlign: textAlign,
          style: Theme.of(context).textTheme.headlineSmall,
        ),
      );
}

class _Progress extends StatelessWidget {
  const _Progress();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
}

class _ErrorNote extends StatelessWidget {
  const _ErrorNote({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Semantics(
          liveRegion: true,
          child: Text(
            message,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
      );
}
