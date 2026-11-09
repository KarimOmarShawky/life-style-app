import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/digital_detox/detox_provider.dart';
import 'package:lifestyle_mobile/features/digital_detox/detox_screen.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_screen.dart';
import 'package:lifestyle_mobile/features/timer/presentation/focus_history_screen.dart';
import 'package:lifestyle_mobile/features/timer/presentation/focus_timer_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// The Focus home: one place for everything focus-related.
///
/// Order matters and mirrors how a session is set up: first the Digital
/// Detox section (pick your own installed apps + session length), then the
/// Focus Timer, Focus Shield and Focus history. The app selection lives
/// only here and is shared by Digital Detox and Focus Shield — nothing is
/// pre-filled or suggested.
class FocusHomeScreen extends ConsumerWidget {
  const FocusHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final shieldData = ref.watch(focusShieldProvider).asData?.value;
    final detox = ref.watch(detoxProvider);
    final detoxSession = detox.session;
    final lastSession = shieldData == null || shieldData.history.isEmpty
        ? null
        : (shieldData.history.toList()
              ..sort((a, b) => b.endedAt.compareTo(a.endedAt)))
            .first;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.tr('focus'))),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          if (shieldData?.shield.active ?? false)
            _ActiveBanner(
              title: shieldData!.shield.taskTitle.isEmpty
                  ? l10n.tr('focusHubActiveSession')
                  : shieldData.shield.taskTitle,
              remainingSeconds: ((shieldData.shield.endTimestampMs -
                          DateTime.now().millisecondsSinceEpoch) ~/
                      1000)
                  .clamp(0, 86400),
              onEnd: () =>
                  ref.read(focusShieldProvider.notifier).endShieldNow(),
            ),
          if (detoxSession?.running ?? false)
            _ActiveBanner(
              title: l10n.tr('detoxTitle'),
              remainingSeconds: detoxSession!.remainingSeconds,
              onEnd: () => detox.run(detoxSession.stop),
            ),
          const DigitalDetoxPanel(),
          const SizedBox(height: 24),
          _FocusNavCard(
            icon: Icons.timer_outlined,
            title: l10n.focusTimer,
            subtitle: l10n.tr('focusHubTimerSubtitle'),
            builder: (_) => const FocusTimerScreen(),
          ),
          _FocusNavCard(
            icon: Icons.shield_outlined,
            title: l10n.tr('shieldTitle'),
            subtitle: l10n.tr('focusHubShieldSubtitle'),
            builder: (_) => const FocusShieldScreen(),
          ),
          _FocusNavCard(
            icon: Icons.history,
            title: l10n.focusHistoryTitle,
            subtitle: l10n.focusHistorySubtitle,
            builder: (_) => const FocusHistoryScreen(),
          ),
          if (lastSession != null) ...[
            const SizedBox(height: 8),
            Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.tr('focusHubLastSession'),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      l10n
                          .tr('focusHubSessionSummary')
                          .replaceAll(
                            '{minutes}',
                            '${(lastSession.durationSeconds / 60).round()}',
                          )
                          .replaceAll('{attempts}', '${lastSession.attempts}'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Sticky-looking summary of a live session with an always-available exit.
class _ActiveBanner extends StatelessWidget {
  const _ActiveBanner({
    required this.title,
    required this.remainingSeconds,
    required this.onEnd,
  });

  final String title;
  final int remainingSeconds;
  final VoidCallback onEnd;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final mm =
        (remainingSeconds ~/ 60).toString().padLeft(2, '0');
    final ss = (remainingSeconds % 60).toString().padLeft(2, '0');
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Card(
        color: theme.colorScheme.primaryContainer,
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(Icons.timer, color: theme.colorScheme.onPrimaryContainer),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: theme.colorScheme.onPrimaryContainer,
                      ),
                    ),
                    Text(
                      l10n
                          .tr('focusHubRemaining')
                          .replaceAll('{time}', '$mm:$ss'),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onPrimaryContainer,
                      ),
                    ),
                  ],
                ),
              ),
              FilledButton(
                onPressed: onEnd,
                child: Text(l10n.tr('focusHubEndNow')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FocusNavCard extends StatelessWidget {
  const _FocusNavCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.builder,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final WidgetBuilder builder;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: theme.colorScheme.primaryContainer,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(
            icon,
            color: theme.colorScheme.onPrimaryContainer,
            size: 20,
          ),
        ),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: builder),
        ),
      ),
    );
  }
}
