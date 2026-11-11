import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/auth/data/sessions_client.dart';
import 'package:lifestyle_mobile/features/auth/presentation/current_password_dialog.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Placeholder name older app versions sent for every device.
const _legacyDeviceName = 'Arena Mobile Client';

/// Profile → Signed-in devices (feature guide G6, ADR-047). Lists where the
/// account is signed in and signs one device out after confirmation and the
/// current password. Signing out this device is a normal sign-out: it clears
/// local data, widget data and scheduled reminders.
class SignedInDevicesScreen extends ConsumerStatefulWidget {
  const SignedInDevicesScreen({super.key});

  @override
  ConsumerState<SignedInDevicesScreen> createState() =>
      _SignedInDevicesScreenState();
}

class _SignedInDevicesScreenState extends ConsumerState<SignedInDevicesScreen> {
  late Future<SignedInDevices> _devices;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _devices = ref.read(sessionsClientProvider).list();
  }

  void _reload() {
    setState(() {
      _devices = ref.read(sessionsClientProvider).list();
    });
  }

  Future<void> _signOut(SignedInDevice device) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final name = deviceLabel(l10n, device);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.signedInDevicesSignOut),
        content: Text(
          device.current
              ? l10n.signedInDevicesConfirmCurrent
              : l10n.signedInDevicesConfirmOther(name),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.signedInDevicesSignOut),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final password = await showDialog<String>(
      context: context,
      builder: (_) => const CurrentPasswordDialog(),
    );
    if (password == null || !mounted) return;
    setState(() => _busyId = device.id);
    try {
      final client = ref.read(sessionsClientProvider);
      final wasCurrent = await client.revoke(device.id, password);
      if (!mounted) return;
      if (wasCurrent || device.current) {
        await ref.read(authProvider.notifier).signOut();
        return;
      }
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.signedInDevicesSignedOutOther(name))),
      );
      _reload();
    } on ApiException catch (error) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text(_errorText(l10n, error))),
      );
      if (error.statusCode == 404) _reload();
    } catch (_) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.signedInDevicesSignOutFailed)),
      );
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.signedInDevicesTitle)),
      body: FutureBuilder<SignedInDevices>(
        future: _devices,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return Center(
              child: CircularProgressIndicator(
                semanticsLabel: l10n.signedInDevicesLoading,
              ),
            );
          }
          final data = snapshot.data;
          if (snapshot.hasError || data == null) {
            return _LoadError(onRetry: _reload);
          }
          final others = data.devices.where((device) => !device.current);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              for (final device in data.devices)
                _DeviceCard(
                  device: device,
                  busy: _busyId == device.id,
                  enabled: _busyId == null,
                  onSignOut: () => _signOut(device),
                ),
              if (others.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    l10n.signedInDevicesEmpty,
                    textAlign: TextAlign.center,
                  ),
                ),
              if (data.truncated)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    l10n.signedInDevicesMore,
                    textAlign: TextAlign.center,
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// The device name the user sees: the stored name, or the platform when no
/// real name was stored.
String deviceLabel(AppLocalizations l10n, SignedInDevice device) {
  final name = device.deviceName?.trim();
  if (name != null && name.isNotEmpty && name != _legacyDeviceName) {
    return name;
  }
  switch (device.platform) {
    case 'android':
      return l10n.signedInDevicesPlatformAndroid;
    case 'ios':
      return l10n.signedInDevicesPlatformIos;
  }
  return l10n.signedInDevicesPlatformUnknown;
}

String _errorText(AppLocalizations l10n, ApiException error) {
  if (error.code == 'REAUTHENTICATION_FAILED') {
    return l10n.signedInDevicesWrongPassword;
  }
  if (error.statusCode == 429) return l10n.signedInDevicesTooManyAttempts;
  if (error.statusCode == 404) return l10n.signedInDevicesAlreadySignedOut;
  return l10n.signedInDevicesSignOutFailed;
}

IconData _platformIcon(String platform) {
  switch (platform) {
    case 'android':
      return Icons.phone_android;
    case 'ios':
      return Icons.phone_iphone;
  }
  return Icons.devices_other;
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({
    required this.device,
    required this.busy,
    required this.enabled,
    required this.onSignOut,
  });

  final SignedInDevice device;
  final bool busy;
  final bool enabled;
  final VoidCallback onSignOut;

  String _when(BuildContext context, DateTime at) {
    final material = MaterialLocalizations.of(context);
    final date = material.formatMediumDate(at);
    final time = material.formatTimeOfDay(TimeOfDay.fromDateTime(at));
    return '$date $time';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final name = deviceLabel(l10n, device);
    final version = device.appVersion;
    final when = device.current
        ? l10n.signedInDevicesSignedInAt(_when(context, device.createdAt))
        : l10n.signedInDevicesLastActive(_when(context, device.lastUsedAt));
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(_platformIcon(device.platform)),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(name, style: theme.textTheme.titleMedium),
                ),
              ],
            ),
            if (device.current) ...[
              const SizedBox(height: 8),
              Text(
                l10n.signedInDevicesThisDevice,
                style: theme.textTheme.labelLarge?.copyWith(
                  color: theme.colorScheme.primary,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              when,
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
            if (version != null && version.isNotEmpty)
              Text(
                l10n.signedInDevicesAppVersion(version),
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
              ),
            const SizedBox(height: 8),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: busy
                  ? Padding(
                      padding: const EdgeInsets.all(12),
                      child: SizedBox.square(
                        dimension: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          semanticsLabel: l10n.signedInDevicesSignOut,
                        ),
                      ),
                    )
                  : Tooltip(
                      message: l10n.signedInDevicesSignOutDevice(name),
                      child: TextButton.icon(
                        onPressed: enabled ? onSignOut : null,
                        icon: const Icon(Icons.logout),
                        label: Text(l10n.signedInDevicesSignOut),
                      ),
                    ),
            ),
          ],
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
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.signedInDevicesLoadFailed, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: Text(l10n.retry)),
          ],
        ),
      ),
    );
  }
}
