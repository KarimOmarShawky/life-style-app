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
      try {
        await ref.read(authProvider.notifier).updateCurrency(selected);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Currency updated to $selected')),
          );
        }
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to update currency: $e')),
          );
        }
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
          ListTile(
            leading: Icon(
              settings.locale.languageCode == 'ar'
                  ? Icons.check_circle
                  : Icons.circle_outlined,
              color: settings.locale.languageCode == 'ar'
                  ? Theme.of(ctx).colorScheme.primary
                  : null,
            ),
            title: const Text('العربية 🇸🇦'),
            onTap: () => Navigator.of(ctx).pop('ar'),
          ),
          const Divider(height: 1),
          ListTile(
            leading: Icon(
              settings.locale.languageCode == 'en'
                  ? Icons.check_circle
                  : Icons.circle_outlined,
              color: settings.locale.languageCode == 'en'
                  ? Theme.of(ctx).colorScheme.primary
                  : null,
            ),
            title: const Text('English 🇺🇸'),
            onTap: () => Navigator.of(ctx).pop('en'),
          ),
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

    final langLabel = settings.locale.languageCode == 'ar' ? 'العربية 🇸🇦' : 'English 🇺🇸';

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
              } catch (_) {}
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