import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Error state with a retry action, shared by the planning screens.
class FeatureErrorView extends StatelessWidget {
  const FeatureErrorView({
    super.key,
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colorScheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 40, color: colorScheme.error),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.tonal(onPressed: onRetry, child: Text(l10n.retry)),
          ],
        ),
      ),
    );
  }
}

/// Empty state with an icon and a short explanation.
class FeatureEmptyView extends StatelessWidget {
  const FeatureEmptyView(
      {super.key, required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.outline;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: color),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(color: color),
            ),
          ],
        ),
      ),
    );
  }
}

/// Red background shown behind a swipe-to-delete row.
class DeleteSwipeBackground extends StatelessWidget {
  const DeleteSwipeBackground({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: Colors.red.shade700,
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Icon(Icons.delete_outline, color: Colors.white),
    );
  }
}

/// Asks the user to confirm a destructive action. Returns true only when confirmed.
Future<bool> confirmDestructiveAction(
  BuildContext context, {
  required String title,
  String? detail,
}) async {
  final l10n = AppLocalizations.of(context);
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: detail == null ? null : Text(detail),
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
  return confirmed ?? false;
}

/// A read-only form field that opens a picker when tapped.
class PickerField extends StatelessWidget {
  const PickerField({
    super.key,
    required this.label,
    required this.valueText,
    required this.onTap,
    this.onClear,
  });

  final String label;
  final String valueText;
  final VoidCallback onTap;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final clear = onClear;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          suffixIcon: clear == null
              ? const Icon(Icons.arrow_drop_down)
              : IconButton(
                  icon: const Icon(Icons.clear),
                  tooltip: l10n.clearValue,
                  onPressed: clear,
                ),
        ),
        child: Text(valueText),
      ),
    );
  }
}

/// Localized medium date (for example "8 Oct 2026"), or [emptyText] when there is no date.
String formatDisplayDate(
  BuildContext context,
  DateTime? value, {
  required String emptyText,
}) {
  if (value == null) return emptyText;
  return MaterialLocalizations.of(context).formatMediumDate(value);
}

/// Localized clock time of day, following the device's 12 or 24-hour setting.
String formatDisplayTimeOfDay(BuildContext context, TimeOfDay time) {
  return MaterialLocalizations.of(context).formatTimeOfDay(
    time,
    alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
  );
}

/// Localized clock time of an instant (local time).
String formatDisplayTime(BuildContext context, DateTime value) {
  return formatDisplayTimeOfDay(context, TimeOfDay.fromDateTime(value));
}

/// Converts a 0-100 percentage into the 0.0-1.0 range that progress indicators expect.
double progressFraction(double percentage) {
  return (percentage / 100).clamp(0.0, 1.0).toDouble();
}

/// Runs a mutation and shows any failure in a snackbar instead of crashing the screen.
Future<void> runWithErrorSnackBar(
  BuildContext context,
  Future<void> Function() action,
) async {
  try {
    await action();
  } catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(error.toString())));
  }
}
