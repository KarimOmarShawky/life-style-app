import 'package:lifestyle_mobile/core/archive/archive_cancellation.dart';
import 'package:lifestyle_mobile/features/auth/presentation/account_archive_dialog.dart';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/links/external_link_opener.dart';
import 'package:lifestyle_mobile/data/ai_task_parsing_pref.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_age_confirmation.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_settings_client.dart';
import 'package:lifestyle_mobile/data/settings_provider.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/presentation/current_password_dialog.dart';
import 'package:lifestyle_mobile/features/auth/presentation/signed_in_devices_screen.dart';
import 'package:lifestyle_mobile/features/auth/presentation/account_export_dialog.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/features/notifications/notification_settings_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

const supportedCurrencies = [
  {'code': 'EGP', 'name': 'Egyptian Pound (جنيه مصري)'},
  {'code': 'USD', 'name': 'US Dollar (\$)'},
  {'code': 'EUR', 'name': 'Euro (€)'},
  {'code': 'SAR', 'name': 'Saudi Riyal (ريال سعودي)'},
  {'code': 'AED', 'name': 'UAE Dirham (درهم إماراتي)'},
  {'code': 'KWD', 'name': 'Kuwaiti Dinar (دينار كويتي)'},
  {'code': 'QAR', 'name': 'Qatari Riyal (ريال قطري)'},
  {'code': 'GBP', 'name': 'British Pound (£)'},
  {'code': 'BHD', 'name': 'Bahraini Dinar (دينار بحريني)'},
  {'code': 'OMR', 'name': 'Omani Rial (OMR)'},
  {'code': 'JOD', 'name': 'Jordanian Dinar (JOD)'},
  {'code': 'TRY', 'name': 'Turkish Lira (TRY)'},
  {'code': 'CAD', 'name': 'Canadian Dollar (CAD)'},
  {'code': 'AUD', 'name': 'Australian Dollar (AUD)'},
];

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({required this.user, super.key});

  final AppUser user;

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _busyAction = false;
  ArchiveCancellation? _archiveCancel;
  String? _archiveUserId;

  @override
  void dispose() {
    _archiveCancel?.cancel();
    super.dispose();
  }

  Future<void> _handleDomainArchive(BuildContext context, String userId) async {
    if (_busyAction) return;
    final cancel = ArchiveCancellation();
    _archiveCancel = cancel;
    _archiveUserId = userId;
    setState(() => _busyAction = true);
    try {
      await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (_) => AccountArchiveDialog(
              userId: userId,
              cancel: cancel,
              download: ref.read(authRepositoryProvider).streamAccountArchive));
    } finally {
      cancel.cancel();
      _archiveCancel = null;
      _archiveUserId = null;
      if (mounted) setState(() => _busyAction = false);
    }
  }

  Future<void> _changeCurrency(
    BuildContext context,
    AppUser activeUser,
  ) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 16),
        itemCount: supportedCurrencies.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (ctx, index) {
          final curr = supportedCurrencies[index];
          final isCurrent = curr['code'] == activeUser.defaultCurrency;
          return ListTile(
            leading: Icon(
              isCurrent ? Icons.check_circle : Icons.circle_outlined,
              color: isCurrent ? Theme.of(ctx).colorScheme.primary : null,
            ),
            title: Text('${curr['code']} — ${curr['name']}'),
            onTap: () => Navigator.of(ctx).pop(curr['code']),
          );
        },
      ),
    );

    if (selected != null && selected != activeUser.defaultCurrency) {
      if (!context.mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      final l10n = AppLocalizations.of(context);
      try {
        await ref.read(authProvider.notifier).updateCurrency(selected);
        messenger.showSnackBar(
          SnackBar(content: Text('${l10n.currencyUpdated} $selected')),
        );
      } catch (e) {
        messenger.showSnackBar(
          SnackBar(content: Text('${l10n.currencyUpdateFailed}: $e')),
        );
      }
    }
  }

  /// Usage statistics (G5). Turning them off also deletes recorded events.
  Future<void> _setUsageStats(bool enabled) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busyAction = true);
    try {
      await ref.read(authProvider.notifier).setProductEventsEnabled(enabled);
    } catch (_) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.settingSaveFailed)));
    } finally {
      if (mounted) setState(() => _busyAction = false);
    }
  }

  /// AI help for Smart Quick Add (P0-F2): consent is asked every time it is
  /// turned on; turning it off needs no confirmation.
  Future<void> _setAiTaskParsing(bool enabled) async {
    final l10n = AppLocalizations.of(context);
    if (enabled) {
      // Gemini API terms: AI features are for people aged 18 or older (D9).
      if (!await ensureAiAgeConfirmed(context, ref)) return;
      if (!mounted) return;
      final agreed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(l10n.aiTaskParsingConsentTitle),
          content: SingleChildScrollView(
            child: Text(l10n.aiTaskParsingConsentBody),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(l10n.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(l10n.aiTaskParsingAgree),
            ),
          ],
        ),
      );
      if (agreed != true) return;
    }
    await ref.read(aiTaskParsingProvider.notifier).setEnabled(enabled);
  }

  /// Withdraws the AI consent stored on the server (Hybrid AI AI-2c). The
  /// assistant then asks again before it sends anything.
  Future<void> _withdrawAiConsent(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        // Scrolls as a whole, so nothing is cut off at large text (G7).
        scrollable: true,
        title: Text(l10n.aiConsentWithdrawTitle),
        content: Text(l10n.aiConsentWithdrawBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.aiConsentWithdrawAction),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busyAction = true);
    bool withdrawn;
    try {
      await ref.read(aiSettingsClientProvider).withdrawConsent();
      withdrawn = true;
    } on ApiException catch (error) {
      // Before the owner-run SQL nothing is stored on the server, so only
      // the consent kept by an open assistant is left to forget.
      withdrawn = error.code == 'AI_SETTINGS_UNAVAILABLE';
    } on Object {
      withdrawn = false;
    }
    if (!mounted) return;
    setState(() => _busyAction = false);
    if (withdrawn) ref.read(aiConsentRevisionProvider.notifier).bump();
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          withdrawn ? l10n.aiConsentWithdrawn : l10n.settingSaveFailed,
        ),
      ),
    );
  }

  void _openNotificationSettings(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const NotificationSettingsScreen(),
      ),
    );
  }

  Future<void> _changeLanguage(BuildContext context) async {
    final settings = ref.read(settingsProvider);

    final selected = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: 16),
        children: [
          for (final Locale option in AppLocalizations.supportedLocales) ...[
            ListTile(
              leading: Icon(
                settings.locale.languageCode == option.languageCode
                    ? Icons.check_circle
                    : Icons.circle_outlined,
                color: settings.locale.languageCode == option.languageCode
                    ? Theme.of(ctx).colorScheme.primary
                    : null,
              ),
              title: Text(
                AppLocalizations.endonyms[option.languageCode] ??
                    option.languageCode,
              ),
              trailing: Text(
                option.languageCode,
                style: Theme.of(ctx).textTheme.bodySmall,
              ),
              onTap: () => Navigator.of(ctx).pop(option.languageCode),
            ),
            const Divider(height: 1),
          ],
        ],
      ),
    );

    if (selected != null) {
      await ref.read(settingsProvider.notifier).setLocale(Locale(selected));
    }
  }

  Future<void> _changeThemeMode(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final settings = ref.read(settingsProvider);

    final selected = await showModalBottomSheet<ThemeMode>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: 16),
        children: [
          ListTile(
            leading: Icon(
              settings.themeMode == ThemeMode.system
                  ? Icons.check_circle
                  : Icons.circle_outlined,
              color: settings.themeMode == ThemeMode.system
                  ? Theme.of(ctx).colorScheme.primary
                  : null,
            ),
            title: Text(l10n.themeSystem),
            onTap: () => Navigator.of(ctx).pop(ThemeMode.system),
          ),
          const Divider(height: 1),
          ListTile(
            leading: Icon(
              settings.themeMode == ThemeMode.light
                  ? Icons.check_circle
                  : Icons.circle_outlined,
              color: settings.themeMode == ThemeMode.light
                  ? Theme.of(ctx).colorScheme.primary
                  : null,
            ),
            title: Text(l10n.themeLight),
            onTap: () => Navigator.of(ctx).pop(ThemeMode.light),
          ),
          const Divider(height: 1),
          ListTile(
            leading: Icon(
              settings.themeMode == ThemeMode.dark
                  ? Icons.check_circle
                  : Icons.circle_outlined,
              color: settings.themeMode == ThemeMode.dark
                  ? Theme.of(ctx).colorScheme.primary
                  : null,
            ),
            title: Text(l10n.themeDark),
            onTap: () => Navigator.of(ctx).pop(ThemeMode.dark),
          ),
        ],
      ),
    );

    if (selected != null) {
      await ref.read(settingsProvider.notifier).setThemeMode(selected);
    }
  }

  Future<String?> _requestCurrentPassword(BuildContext context) =>
      showDialog<String>(
        context: context,
        builder: (_) => const CurrentPasswordDialog(),
      );

  Future<void> _handleExportData(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final currentPassword = await _requestCurrentPassword(context);
    if (currentPassword == null || !mounted) return;
    setState(() => _busyAction = true);
    try {
      final exportPayload =
          await ref.read(authProvider.notifier).exportUserData(currentPassword);
      final prettyJson =
          const JsonEncoder.withIndent('  ').convert(exportPayload);
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (_) => AccountExportDialog(jsonText: prettyJson),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    } finally {
      if (mounted) setState(() => _busyAction = false);
    }
  }

  Future<void> _openPrivacyPolicy(BuildContext context, Uri link) async {
    final messenger = ScaffoldMessenger.of(context);
    final failure = AppLocalizations.of(context).privacyPolicyOpenFailed;
    final opened = await ref.read(externalLinkOpenerProvider).open(link);
    if (!opened && mounted) {
      messenger.showSnackBar(SnackBar(content: Text(failure)));
    }
  }

  Future<void> _handleScheduleDeletion(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.deletionScheduleTitle),
        content: Text(l10n.deletionScheduleBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.delete),
          ),
        ],
      ),
    );

    if (confirmed != true || !context.mounted) return;
    final currentPassword = await _requestCurrentPassword(context);
    if (currentPassword == null || !mounted) return;
    setState(() => _busyAction = true);
    try {
      await ref
          .read(authProvider.notifier)
          .scheduleAccountDeletion(currentPassword);
      messenger.showSnackBar(
        SnackBar(
          content: Text(l10n.deletionScheduledSnack),
        ),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    } finally {
      if (mounted) setState(() => _busyAction = false);
    }
  }

  Future<void> _handleCancelDeletion(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busyAction = true);
    try {
      await ref.read(authProvider.notifier).cancelAccountDeletion();
      messenger.showSnackBar(
        SnackBar(
          content: Text(l10n.deletionCancelledSnack),
        ),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    } finally {
      if (mounted) setState(() => _busyAction = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final localization = AppLocalizations.of(context);
    final settings = ref.watch(settingsProvider);
    ref.listen(authProvider, (_, next) {
      if (_archiveUserId != null && next.valueOrNull?.id != _archiveUserId) {
        _archiveCancel?.cancel();
      }
    });
    final activeUser = ref.watch(authProvider).valueOrNull ?? widget.user;
    final usageStats = activeUser.productEventsEnabled;
    final aiTaskParsing =
        ref.watch(aiTaskParsingProvider).asData?.value ?? false;
    final privacyPolicy = ref.watch(privacyPolicyUriProvider);

    String themeLabel = localization.themeSystem;
    if (settings.themeMode == ThemeMode.light) {
      themeLabel = localization.themeLight;
    }
    if (settings.themeMode == ThemeMode.dark) {
      themeLabel = localization.themeDark;
    }

    final langLabel = AppLocalizations.endonyms[settings.locale.languageCode] ??
        settings.locale.languageCode;

    final statusLabel = activeUser.isPendingDeletion
        ? localization.accountStatusPendingDeletion
        : localization.activeStatus;

    return Scaffold(
      appBar: AppBar(title: Text(localization.profile)),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          CircleAvatar(
            radius: 36,
            child: Text(
              activeUser.displayName.isEmpty
                  ? '?'
                  : activeUser.displayName.characters.first.toUpperCase(),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            activeUser.displayName,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          Text(activeUser.email, textAlign: TextAlign.center),
          const SizedBox(height: 20),
          if (activeUser.isPendingDeletion) ...[
            Card(
              color: Colors.orange.withAlpha(35),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.warning_amber_rounded,
                            color: Colors.orange),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            localization.deletionPendingBanner,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      onPressed: _busyAction
                          ? null
                          : () => _handleCancelDeletion(context),
                      icon: const Icon(Icons.restore),
                      label: Text(localization.deletionRestoreAction),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
          const _XpProgressSection(),
          const SizedBox(height: 24),
          _ProfileRow(label: localization.timeZone, value: activeUser.timezone),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(localization.language),
            subtitle: Text(langLabel),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () => _changeLanguage(context),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(localization.themeMode),
            subtitle: Text(themeLabel),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () => _changeThemeMode(context),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(localization.defaultCurrency),
            subtitle: Text(activeUser.defaultCurrency),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: activeUser.isPendingDeletion
                ? null
                : () => _changeCurrency(context, activeUser),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.notifications_outlined),
            title: Text(localization.notificationSettingsTitle),
            subtitle: Text(localization.notificationSettingsSubtitle),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () => _openNotificationSettings(context),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.auto_awesome),
            title: Text(localization.aiAssistant),
            subtitle: Text(localization.aiAssistantSubtitle),
          ),
          if (usageStats != null)
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              secondary: const Icon(Icons.insights_outlined),
              title: Text(localization.usageStatsTitle),
              subtitle: Text(localization.usageStatsSubtitle),
              value: usageStats,
              onChanged: _busyAction ? null : _setUsageStats,
            ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            secondary: const Icon(Icons.auto_fix_high_outlined),
            title: Text(localization.aiTaskParsingTitle),
            subtitle: Text(localization.aiTaskParsingSubtitle),
            value: aiTaskParsing,
            onChanged: _setAiTaskParsing,
          ),
          ListTile(
            key: const ValueKey('ai-consent-tile'),
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.verified_user_outlined),
            title: Text(localization.aiConsentTileTitle),
            subtitle: Text(localization.aiConsentTileSubtitle),
            onTap: _busyAction ? null : () => _withdrawAiConsent(context),
          ),
          _ProfileRow(label: localization.accountStatus, value: statusLabel),
          const Divider(height: 24),
          // Feature guide G6. Hidden in the deletion grace period, when the
          // API answers 403 and the other devices are already signed out.
          if (!activeUser.isPendingDeletion)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.devices_outlined),
              title: Text(localization.signedInDevicesTitle),
              subtitle: Text(localization.signedInDevicesSubtitle),
              trailing: const Icon(Icons.arrow_forward_ios, size: 16),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const SignedInDevicesScreen(),
                ),
              ),
            ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.save_alt),
            title: Text(localization.archiveTitle),
            subtitle: Text(localization.archiveSubtitle),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: _busyAction
                ? null
                : () => _handleDomainArchive(context, activeUser.id),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.download_outlined),
            title: Text(localization.accountExportTitle),
            subtitle: Text(localization.accountExportPreviewSubtitle),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: _busyAction ? null : () => _handleExportData(context),
          ),
          // Google Play requires the policy to be reachable inside the app.
          if (privacyPolicy != null)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.privacy_tip_outlined),
              title: Text(localization.privacyPolicyTitle),
              subtitle: Text(localization.privacyPolicySubtitle),
              onTap: () => _openPrivacyPolicy(context, privacyPolicy),
            ),
          if (!activeUser.isPendingDeletion)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading:
                  const Icon(Icons.delete_forever_outlined, color: Colors.red),
              title: Text(
                localization.deleteAccountAction,
                style: const TextStyle(color: Colors.red),
              ),
              trailing: const Icon(Icons.arrow_forward_ios,
                  size: 16, color: Colors.red),
              onTap:
                  _busyAction ? null : () => _handleScheduleDeletion(context),
            ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () async {
              try {
                await ref.read(authProvider.notifier).signOut();
              } catch (_) {
                // Logout and other local cleanup may fail independently.
                // Do not claim that every credential was removed.
              }
            },
            icon: const Icon(Icons.logout),
            label: Text(localization.signOut),
          ),
        ],
      ),
    );
  }
}

class _ProfileRow extends StatelessWidget {
  const _ProfileRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(label),
        subtitle: Text(value),
      );
}

/// Profile rank card and badges (P1-F15). Every number comes from the Focus
/// Shield XP ledger stored on this device; nothing shows until it has loaded.
class _XpProgressSection extends ConsumerWidget {
  const _XpProgressSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ledger = ref.watch(xpLedgerProvider);
    if (ledger == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: scheme.primaryContainer.withAlpha(90),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: scheme.primary.withAlpha(50)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Wraps instead of overflowing at large text sizes (G7).
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 8,
                runSpacing: 6,
                children: [
                  Text(
                    l10n.accountRank,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: scheme.primary,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: scheme.primary,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      l10n.levelXpBadge(ledger.level, ledger.totalXp),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: scheme.onPrimary,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: ledger.levelProgress,
                  minHeight: 6,
                  backgroundColor: scheme.surfaceContainerHighest,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                l10n.xpRemainingText(ledger.xpToNextLevel, ledger.level + 1),
                style: TextStyle(
                  fontSize: 11,
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                l10n.xpDeviceNote,
                style: TextStyle(
                  fontSize: 11,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Text(
          l10n.achievementBadges,
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _BadgeTile(
              title: l10n.badgeStrongStart,
              description: l10n.badgeFirstTask,
              icon: Icons.verified_outlined,
              earned: ledger.hasWin(XpType.task),
            ),
            const SizedBox(width: 8),
            _BadgeTile(
              title: l10n.badgeFocusHero,
              description: l10n.badgePomodoro,
              icon: Icons.timer_outlined,
              earned: ledger.hasWin(XpType.focus),
            ),
            const SizedBox(width: 8),
            _BadgeTile(
              title: l10n.badgeDiscipline,
              description: l10n.badgeStreak7,
              icon: Icons.local_fire_department_outlined,
              earned: ledger.longestDayStreak >= 7,
            ),
          ],
        ),
      ],
    );
  }
}

/// One badge: earned or not is announced to screen readers, and locked
/// badges use an accessible colour instead of the outline colour (G7).
class _BadgeTile extends StatelessWidget {
  const _BadgeTile({
    required this.title,
    required this.description,
    required this.icon,
    required this.earned,
  });

  final String title;
  final String description;
  final IconData icon;
  final bool earned;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final state = earned ? l10n.badgeEarned : l10n.badgeLocked;
    return Expanded(
      child: Semantics(
        container: true,
        label: '$title. $description. $state',
        child: ExcludeSemantics(
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
            decoration: BoxDecoration(
              color: earned
                  ? scheme.primaryContainer.withAlpha(50)
                  : scheme.surfaceContainerHighest.withAlpha(40),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: earned ? scheme.primary : scheme.outlineVariant,
              ),
            ),
            child: Column(
              children: [
                Icon(
                  earned ? icon : Icons.lock_outline,
                  size: 24,
                  color: earned ? scheme.primary : scheme.onSurfaceVariant,
                ),
                const SizedBox(height: 6),
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: earned ? scheme.onSurface : scheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: TextStyle(
                    fontSize: 11,
                    color: scheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
