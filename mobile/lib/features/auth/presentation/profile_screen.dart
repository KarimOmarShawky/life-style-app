import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../data/models.dart';
import '../../../l10n/app_localizations.dart';
import '../../state/providers.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({required this.user, super.key});

  final AppUser user;

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
          _ProfileRow(label: 'Default currency', value: user.defaultCurrency),
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
