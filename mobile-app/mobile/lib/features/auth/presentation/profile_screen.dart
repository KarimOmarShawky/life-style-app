import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
  {'code': 'OMR', 'name': 'Omani Rial (ريال عماني)'},
  {'code': 'JOD', 'name': 'Jordanian Dinar (دينار أردني)'},
  {'code': 'TRY', 'name': 'Turkish Lira (ليرة تركية)'},
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final localization = AppLocalizations.of(context);
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
          _ProfileRow(label: 'Time zone', value: user.timezone),
          _ProfileRow(label: 'Language', value: user.locale),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Default currency'),
            subtitle: Text(user.defaultCurrency),
            trailing: const Icon(Icons.arrow_forward_ios, size: 16),
            onTap: () => _changeCurrency(context, ref),
          ),
          _ProfileRow(label: 'Account status', value: user.status),
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
