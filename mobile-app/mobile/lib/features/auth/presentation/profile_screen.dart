import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/settings_provider.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';

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

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({required this.user, super.key});

  final AppUser user;

  Future<void> _changeCurrency(BuildContext context, WidgetRef ref) async {
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
          final isCurrent = curr['code'] == user.defaultCurrency;
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

    if (selected != null && selected != user.defaultCurrency) {
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

  Future<void> _changeLanguage(BuildContext context, WidgetRef ref) async {
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

  Future<void> _changeThemeMode(BuildContext context, WidgetRef ref) async {
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final localization = AppLocalizations.of(context);
    final settings = ref.watch(settingsProvider);

    String themeLabel = localization.themeSystem;
    if (settings.themeMode == ThemeMode.light) themeLabel = localization.themeLight;
    if (settings.themeMode == ThemeMode.dark) themeLabel = localization.themeDark;

    final langLabel = settings.locale.languageCode == 'ar' ? 'العربية' : 'English';

    return Scaffold(
      appBar: AppBar(title: Text(localization.profile)),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          CircleAvatar(
            radius: 36,
            child: Text(
              user.displayName.isEmpty
                  ? '?'
                  : user.displayName.characters.first.toUpperCase(),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            user.displayName,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          Text(user.email, textAlign: TextAlign.center),
          const SizedBox(height: 20),

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
          _ProfileRow(label: localization.timeZone, value: user.timezone),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(localization.language),
            subtitle: Text(langLabel),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () => _changeLanguage(context, ref),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(localization.themeMode),
            subtitle: Text(themeLabel),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () => _changeThemeMode(context, ref),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(localization.defaultCurrency),
            subtitle: Text(user.defaultCurrency),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () => _changeCurrency(context, ref),
          ),
          _ProfileRow(label: localization.accountStatus, value: localization.activeStatus),
          const SizedBox(height: 24),
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
