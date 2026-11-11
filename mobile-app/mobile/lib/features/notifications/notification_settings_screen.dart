import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/notification_policy.dart';
import 'package:lifestyle_mobile/data/notification_preferences.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Feature guide G2 (ADR-046): quiet hours, daily limit, alarms during quiet
/// hours and the master switch. Every change is saved to the account and
/// re-plans this device's reminders.
class NotificationSettingsScreen extends ConsumerWidget {
  const NotificationSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final settings = ref.watch(notificationSettingsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.notificationSettingsTitle)),
      body: settings.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => _LoadError(
          onRetry: () => ref.invalidate(notificationSettingsProvider),
        ),
        data: (value) => _SettingsList(settings: value),
      ),
    );
  }
}

const List<int?> _dailyLimitOptions = <int?>[null, 3, 5, 10, 20];

class _SettingsList extends ConsumerWidget {
  const _SettingsList({required this.settings});

  final NotificationSettings settings;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final noteStyle = Theme.of(context).textTheme.bodySmall;
    final prefs = settings.preferences;
    final editable = settings.available;

    Future<void> save(NotificationPreferences next) async {
      final messenger = ScaffoldMessenger.of(context);
      try {
        await ref.read(notificationSettingsProvider.notifier).save(next);
      } catch (error) {
        messenger.showSnackBar(
          SnackBar(content: Text(_saveErrorText(l10n, error))),
        );
      }
    }

    ValueChanged<bool>? whenEditable(ValueChanged<bool> onChanged) {
      return editable ? onChanged : null;
    }

    Future<void> pickTime({required bool start}) async {
      final current = start ? prefs.quietStartMinute : prefs.quietEndMinute;
      final picked = await showTimePicker(
        context: context,
        initialTime: _timeOfDay(current ?? 0),
      );
      if (picked == null || !context.mounted) return;
      final minute = picked.hour * 60 + picked.minute;
      NotificationPreferences next;
      if (start) {
        next = prefs.withQuietHours(minute, prefs.quietEndMinute);
      } else {
        next = prefs.withQuietHours(prefs.quietStartMinute, minute);
      }
      if (!next.hasQuietHours) return;
      await save(next);
    }

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        if (!editable) _Notice(text: l10n.notificationSettingsUnavailable),
        SwitchListTile(
          secondary: const Icon(Icons.notifications_active_outlined),
          title: Text(l10n.notificationsMasterSwitch),
          subtitle: Text(l10n.notificationsMasterSwitchHint),
          value: prefs.notificationsEnabled,
          onChanged: whenEditable((value) {
            save(prefs.copyWith(notificationsEnabled: value));
          }),
        ),
        const Divider(),
        SwitchListTile(
          secondary: const Icon(Icons.bedtime_outlined),
          title: Text(l10n.quietHoursTitle),
          subtitle: Text(l10n.quietHoursHint),
          value: prefs.hasQuietHours,
          onChanged: whenEditable((value) {
            save(_toggleQuietHours(prefs, value));
          }),
        ),
        if (prefs.hasQuietHours) ...[
          _TimeTile(
            label: l10n.quietHoursStart,
            minute: prefs.quietStartMinute!,
            onTap: editable ? () => pickTime(start: true) : null,
          ),
          _TimeTile(
            label: l10n.quietHoursEnd,
            minute: prefs.quietEndMinute!,
            onTap: editable ? () => pickTime(start: false) : null,
          ),
          SwitchListTile(
            secondary: const Icon(Icons.alarm),
            title: Text(l10n.alarmsBreakQuietTitle),
            subtitle: Text(l10n.alarmsBreakQuietHint),
            value: prefs.criticalBreaksQuiet,
            onChanged: whenEditable((value) {
              save(prefs.copyWith(criticalBreaksQuiet: value));
            }),
          ),
        ],
        const Divider(),
        ListTile(
          leading: const Icon(Icons.filter_list),
          title: Text(l10n.dailyLimitTitle),
          subtitle: Text(l10n.dailyLimitHint),
        ),
        Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(16, 0, 16, 8),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final option in _dailyLimitOptions)
                ChoiceChip(
                  label: Text(_dailyLimitLabel(l10n, option)),
                  selected: prefs.dailyCap == option,
                  onSelected: whenEditable((_) {
                    save(prefs.withDailyCap(option));
                  }),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            l10n.notificationTimeZoneNote(settings.timeZone),
            style: noteStyle?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ),
      ],
    );
  }
}

NotificationPreferences _toggleQuietHours(
  NotificationPreferences prefs,
  bool on,
) {
  if (!on) return prefs.withQuietHours(null, null);
  return prefs.withQuietHours(
    NotificationPreferences.suggestedQuietStart,
    NotificationPreferences.suggestedQuietEnd,
  );
}

String _dailyLimitLabel(AppLocalizations l10n, int? option) {
  if (option == null) return l10n.dailyLimitNone;
  return l10n.dailyLimitPerDay(option);
}

String _saveErrorText(AppLocalizations l10n, Object error) {
  if (error is ApiException &&
      error.code == 'NOTIFICATION_PREFERENCES_UNAVAILABLE') {
    return l10n.notificationSettingsUnavailable;
  }
  return l10n.notificationSettingsSaveFailed;
}

TimeOfDay _timeOfDay(int minute) =>
    TimeOfDay(hour: minute ~/ 60, minute: minute % 60);

class _TimeTile extends StatelessWidget {
  const _TimeTile({
    required this.label,
    required this.minute,
    required this.onTap,
  });

  final String label;
  final int minute;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final time = MaterialLocalizations.of(context).formatTimeOfDay(
      _timeOfDay(minute),
      alwaysUse24HourFormat: MediaQuery.of(context).alwaysUse24HourFormat,
    );
    return ListTile(
      leading: const Icon(Icons.schedule),
      title: Text(label),
      trailing: Text(time, style: Theme.of(context).textTheme.titleMedium),
      onTap: onTap,
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Card(
        color: scheme.secondaryContainer,
        child: ListTile(
          leading: Icon(Icons.info_outline, color: scheme.onSecondaryContainer),
          title: Text(
            text,
            style: TextStyle(color: scheme.onSecondaryContainer),
          ),
        ),
      ),
    );
  }
}

class _LoadError extends StatelessWidget {
  const _LoadError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              l10n.notificationSettingsLoadFailed,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: Text(l10n.retry)),
          ],
        ),
      ),
    );
  }
}
