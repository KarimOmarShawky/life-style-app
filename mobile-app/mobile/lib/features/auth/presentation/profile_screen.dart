import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/settings_provider.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/presentation/gemini_key_dialog.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
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
  bool _hasGeminiKey = false;
  bool _busyAction = false;

  @override
  void initState() {
    super.initState();
    _refreshGeminiKeyStatus();
  }

  Future<void> _refreshGeminiKeyStatus() async {
    final hasKey = await AiService.instance.hasUserApiKey();
    if (!mounted) return;
    setState(() => _hasGeminiKey = hasKey);
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

  Future<void> _handleExportData(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final isAr = l10n.isArabic;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busyAction = true);
    try {
      final exportPayload = await ref.read(authProvider.notifier).exportUserData();
      final prettyJson = const JsonEncoder.withIndent('  ').convert(exportPayload);
      await Clipboard.setData(ClipboardData(text: prettyJson));
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(
            isAr ? 'تم تصدير بيانات الحساب' : 'Account Data Exported',
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isAr
                      ? 'تم نسخ نسخة JSON الكاملة لبيانات حسابك إلى الحافظة.'
                      : 'Your complete account JSON export has been copied to the clipboard.',
                ),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Theme.of(dialogContext).colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    prettyJson.length > 600
                        ? '${prettyJson.substring(0, 600)}...\n'
                        : prettyJson,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(l10n.back),
            ),
          ],
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

  Future<void> _handleScheduleDeletion(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final isAr = l10n.isArabic;
    final messenger = ScaffoldMessenger.of(context);

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          isAr ? 'جدولة حذف الحساب' : 'Schedule Account Deletion',
        ),
        content: Text(
          isAr
              ? 'سيتم وضع حسابك في فترة سماح لمدة 14 يوماً وإلغاء جميع الجلسات الأخرى قبل الحذف النهائي. يمكنك إلغاء طلب الحذف في أي وقت خلال فترة السماح.'
              : 'Your account will enter a 14-day grace period and other active sessions will be revoked before permanent deletion. You can cancel deletion anytime during the grace window.',
        ),
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

    if (confirmed != true) return;
    setState(() => _busyAction = true);
    try {
      await ref.read(authProvider.notifier).scheduleAccountDeletion();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            isAr
                ? 'تمت جدولة حذف الحساب (مهلة السماح 14 يوماً)'
                : 'Account deletion scheduled (14-day grace period)',
          ),
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
    final isAr = l10n.isArabic;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busyAction = true);
    try {
      await ref.read(authProvider.notifier).cancelAccountDeletion();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            isAr
                ? 'تم إلغاء حذف الحساب واستعادة النشاط الكامل'
                : 'Account deletion cancelled and full access restored',
          ),
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
    final isAr = localization.isArabic;
    final settings = ref.watch(settingsProvider);
    final activeUser = ref.watch(authProvider).valueOrNull ?? widget.user;

    String themeLabel = localization.themeSystem;
    if (settings.themeMode == ThemeMode.light) {
      themeLabel = localization.themeLight;
    }
    if (settings.themeMode == ThemeMode.dark) {
      themeLabel = localization.themeDark;
    }

    final langLabel =
        AppLocalizations.endonyms[settings.locale.languageCode] ??
            settings.locale.languageCode;

    final statusLabel = activeUser.isPendingDeletion
        ? (isAr ? 'مجدول للحذف (مهلة 14 يوماً)' : 'pending_deletion (14-day grace)')
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
                        const Icon(Icons.warning_amber_rounded, color: Colors.orange),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            isAr
                                ? 'حسابك مجدول للحذف النهائي. يمكنك استعادته الآن قبل انتهاء مهلة الـ 14 يوماً.'
                                : 'Your account is scheduled for deletion. You can restore it now before the 14-day grace period ends.',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      onPressed: _busyAction ? null : () => _handleCancelDeletion(context),
                      icon: const Icon(Icons.restore),
                      label: Text(
                        isAr ? 'إلغاء حذف الحساب واستعادته' : 'Cancel Deletion & Restore Account',
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Level & XP Gamification Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.primaryContainer.withAlpha(90),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: Theme.of(context).colorScheme.primary.withAlpha(50),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      localization.accountRank,
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 14,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primary,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        localization.levelXpBadge,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: 0.7,
                    minHeight: 6,
                    backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  localization.xpRemainingText,
                  style: TextStyle(
                    fontSize: 11,
                    color: Theme.of(context).colorScheme.outline,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Achievements Badges Section
          Text(
            localization.achievementBadges,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              _buildBadgeItem(context, localization.badgeStrongStart, localization.badgeFirstTask, Icons.verified_outlined, true),
              const SizedBox(width: 8),
              _buildBadgeItem(context, localization.badgeFocusHero, localization.badgePomodoro, Icons.timer_outlined, true),
              const SizedBox(width: 8),
              _buildBadgeItem(context, localization.badgeDiscipline, localization.badgeStreak7, Icons.local_fire_department_outlined, false),
            ],
          ),
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
            leading: const Icon(Icons.key_outlined),
            title: Text(isAr ? 'مفتاح Gemini API الشخصي (BYOK)' : 'Personal Gemini API Key (BYOK)'),
            subtitle: Text(
              _hasGeminiKey
                  ? (isAr ? 'مُعَدّ ومشفر على الجهاز' : 'Configured & encrypted on device')
                  : localization.notSet,
            ),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () async {
              await showGeminiApiKeyDialog(context);
              await _refreshGeminiKeyStatus();
            },
          ),
          _ProfileRow(label: localization.accountStatus, value: statusLabel),
          const Divider(height: 24),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.download_outlined),
            title: Text(isAr ? 'تصدير بيانات الحساب (JSON)' : 'Export Account Data (JSON)'),
            subtitle: Text(
              isAr
                  ? 'نسخ أرشيف كامل لجميع بياناتك إلى الحافظة'
                  : 'Copy a full archive of your account data to clipboard',
            ),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: _busyAction ? null : () => _handleExportData(context),
          ),
          if (!activeUser.isPendingDeletion)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.delete_forever_outlined, color: Colors.red),
              title: Text(
                isAr ? 'حذف الحساب (مهلة سماح 14 يوماً)' : 'Delete Account (14-day grace period)',
                style: const TextStyle(color: Colors.red),
              ),
              trailing: const Icon(Icons.arrow_forward_ios, size: 16, color: Colors.red),
              onTap: _busyAction ? null : () => _handleScheduleDeletion(context),
            ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () async {
              try {
                await ref.read(authProvider.notifier).signOut();
              } catch (_) {
                // Local credentials are cleared even if the network is down.
              }
            },
            icon: const Icon(Icons.logout),
            label: Text(localization.signOut),
          ),
        ],
      ),
    );
  }

  Widget _buildBadgeItem(
    BuildContext context,
    String title,
    String desc,
    IconData icon,
    bool unlocked,
  ) {
    final theme = Theme.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        decoration: BoxDecoration(
          color: unlocked
              ? theme.colorScheme.primaryContainer.withAlpha(50)
              : theme.colorScheme.surfaceContainerHighest.withAlpha(40),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: unlocked ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
            width: 1,
          ),
        ),
        child: Column(
          children: [
            Icon(
              icon,
              size: 24,
              color: unlocked ? theme.colorScheme.primary : theme.colorScheme.outline,
            ),
            const SizedBox(height: 6),
            Text(
              title,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: unlocked ? theme.colorScheme.onSurface : theme.colorScheme.outline,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 2),
            Text(
              desc,
              style: TextStyle(
                fontSize: 9,
                color: theme.colorScheme.outline,
              ),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
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
