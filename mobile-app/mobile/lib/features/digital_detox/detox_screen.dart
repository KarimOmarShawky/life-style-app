import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
import 'detox_app_picker_screen.dart';
import 'detox_provider.dart';
import 'detox_session.dart';

/// Standalone Digital Detox page. The Focus tab embeds [DigitalDetoxPanel]
/// directly; this wrapper only adds the page chrome.
class DigitalDetoxScreen extends StatelessWidget {
  const DigitalDetoxScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.tr('detoxTitle'))),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: const [DigitalDetoxPanel()],
      ),
    );
  }
}

/// Digital Detox setup and session controls.
///
/// App selection is the primary flow: the user explicitly picks the apps
/// to redirect. The selection is the single shared list also used by
/// Focus Shield (stored in `focusShieldProvider`): there are no suggested
/// or pre-filled applications. Strict Focus stays available as an
/// advanced alternative.
class DigitalDetoxPanel extends ConsumerStatefulWidget {
  const DigitalDetoxPanel({super.key});

  @override
  ConsumerState<DigitalDetoxPanel> createState() => _DigitalDetoxPanelState();
}

class _DigitalDetoxPanelState extends ConsumerState<DigitalDetoxPanel>
    with WidgetsBindingObserver {
  DetoxMode _mode = DetoxMode.selectedApps;
  final _focus = TextEditingController(text: '45');
  final _rest = TextEditingController(text: '15');
  final _selected = <String, String>{};
  bool _consent = false;
  bool _timerOnly = false;
  bool _selectionSynced = false;
  String? _selectionError;

  /// Live Android accessibility state: null = not checked yet (or not
  /// Android). Blocking is impossible without it — the OS only lets an
  /// accessibility service notice that a selected app came to the front —
  /// so a session must never silently start while this is known to be off.
  bool? _accessibilityOn;

  /// Set while the user is in Android settings after choosing to enable
  /// blocking, so returning with the switch on can continue the start
  /// flow automatically — the closest Android allows to a permission
  /// prompt: explain, jump to settings, resume where they left off.
  bool _awaitingAccessibilityReturn = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance
        .addPostFrameCallback((_) => _refreshAccessibility());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshAccessibility();
    }
  }

  /// Explain-then-jump: show why the switch is needed (and what it can
  /// never do), then open Android accessibility settings. The resume
  /// hook in [_refreshAccessibility] picks the flow back up on return.
  Future<void> _explainAndOpenAccessibility() async {
    final l10n = AppLocalizations.of(context);
    final go = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.tr('detoxAccessWhyTitle')),
        content: Text(l10n.tr('detoxAccessWhyBody')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(l10n.tr('detoxOpenAccessibility')),
          ),
        ],
      ),
    );
    if (go != true || !mounted) return;
    _awaitingAccessibilityReturn = true;
    final controller = ref.read(detoxProvider);
    await controller.run(() async {
      await controller.enforcer.platform.invoke('openAccessibilitySettings');
    });
  }

  Future<void> _refreshAccessibility() async {
    final controller = ref.read(detoxProvider);
    if (!controller.enforcer.supported) return;
    try {
      final status =
          await controller.enforcer.platform.invoke('getPermissionStatus');
      if (mounted) {
        setState(() => _accessibilityOn = status['accessibility'] == true);
        if (_accessibilityOn == true && _awaitingAccessibilityReturn) {
          _awaitingAccessibilityReturn = false;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted || !_consent) return;
            final sessionState = ref.read(detoxProvider).session?.state;
            if (sessionState == null ||
                sessionState == DetoxState.IDLE ||
                sessionState == DetoxState.STOPPED ||
                sessionState == DetoxState.COMPLETED) {
              _start();
            }
          });
        }
      }
    } catch (_) {
      // Unknown: leave the gate open; the native start still reports its
      // own failure instead of the UI guessing wrongly.
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _focus.dispose();
    _rest.dispose();
    super.dispose();
  }

  /// Adopts the shared Focus Shield selection once it has loaded, resolving
  /// display labels from the installed-apps list. Packages Android no longer
  /// reports fall back to their package name rather than being dropped.
  Future<void> _syncSelectionFromShield(Set<String> packages) async {
    if (packages.isEmpty) return;
    Map<String, String> labels = const {};
    try {
      final apps = await ref.read(detoxProvider).enforcer.apps();
      labels = {
        for (final app in apps)
          (app['packageName'] ?? ''):
              (app['label'] ?? app['packageName'] ?? ''),
      };
    } catch (_) {
      // Labels are cosmetic; keep the packages with their raw names.
    }
    if (!mounted) return;
    setState(() {
      for (final packageName in packages) {
        _selected.putIfAbsent(
            packageName, () => labels[packageName] ?? packageName);
      }
    });
  }

  /// Writes panel changes back into the shared Focus Shield list so both
  /// features always restrict exactly the same applications.
  void _pushSelectionToShield(Set<String> before) {
    final notifier = ref.read(focusShieldProvider.notifier);
    final added = _selected.keys.toSet().difference(before);
    final removed = before.difference(_selected.keys.toSet());
    for (final packageName in added) {
      unawaited(notifier.setBlocked(packageName, true).catchError((_) {}));
    }
    for (final packageName in removed) {
      unawaited(notifier.setBlocked(packageName, false).catchError((_) {}));
    }
  }

  Future<void> _chooseApps() async {
    final before = _selected.keys.toSet();
    final result = await Navigator.of(context).push<Map<String, String>>(
      MaterialPageRoute<Map<String, String>>(
        builder: (_) => DetoxAppPickerScreen(
          loadApps: ref.read(detoxProvider).enforcer.apps,
          initialSelected: Map.of(_selected),
        ),
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      _selected
        ..clear()
        ..addAll(result);
      _selectionError = null;
    });
    _pushSelectionToShield(before);
  }

  void _removeApp(String packageName) {
    final before = _selected.keys.toSet();
    setState(() => _selected.remove(packageName));
    _pushSelectionToShield(before);
  }

  Future<void> _start() async {
    final l10n = AppLocalizations.of(context);
    final focus = int.tryParse(_focus.text);
    final rest = int.tryParse(_rest.text);
    if (focus == null ||
        rest == null ||
        focus < 1 ||
        focus > 180 ||
        rest < 1 ||
        rest > 60) {
      setState(() => _selectionError = l10n.tr('detoxDurationError'));
      return;
    }
    if (_mode == DetoxMode.selectedApps && _selected.isEmpty) {
      setState(() => _selectionError = l10n.tr('detoxSelectError'));
      return;
    }
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.tr('detoxConfirmTitle')),
        content: Text(
          '${l10n.tr('detoxConfirmTiming').replaceAll('{focus}', '$focus').replaceAll('{rest}', '$rest')} '
          '${_mode == DetoxMode.strictFocus ? l10n.tr('detoxConfirmStrict') : l10n.tr('detoxConfirmSelected').replaceAll('{n}', '${_selected.length}')} '
          '${_timerOnly ? l10n.tr('detoxConfirmTimerAllowed') : l10n.tr('detoxConfirmTimerDenied')}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l10n.tr('start')),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    final controller = ref.read(detoxProvider);
    await controller.run(
      () => controller.session!.start(
        selectedMode: _mode,
        focus: focus,
        rest: rest,
        selectedPackages: _selected.keys.toSet(),
        timerOnlyAllowed: _timerOnly,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = ref.watch(detoxProvider);
    final shieldData = ref.watch(focusShieldProvider).asData?.value;
    if (shieldData != null && !_selectionSynced) {
      _selectionSynced = true;
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _syncSelectionFromShield(shieldData.blockedPackages),
      );
    }
    final session = controller.session;
    final configured = session != null &&
        ![
          DetoxState.IDLE,
          DetoxState.STOPPED,
          DetoxState.COMPLETED,
        ].contains(session.state);
    final editable = !configured &&
        !controller.busy &&
        !(shieldData?.shield.active ?? false);
    final remaining = session?.remainingSeconds ?? 0;
    final total = session?.phase == 'break'
        ? (session?.breakMinutes ?? 15) * 60
        : (session?.focusMinutes ?? 45) * 60;
    final selectedEntries = _selected.entries.toList()
      ..sort(
        (a, b) => a.value.toLowerCase().compareTo(b.value.toLowerCase()),
      );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.tr('detoxHeadline'),
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 8),
        Text(l10n.tr('detoxIntro')),
        if (session == null) ...[
          const SizedBox(height: 12),
          Text(l10n.tr('detoxSignIn')),
        ],
        const SizedBox(height: 16),
        _SectionCard(
          children: [
            _SectionHeader(
              icon: Icons.apps_outlined,
              title: l10n.tr('detoxAppsTitle'),
              subtitle: l10n.tr('detoxAppsSubtitle'),
            ),
            const SizedBox(height: 12),
            if (selectedEntries.isEmpty)
              Text(l10n.tr('detoxNoneSelected'))
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final entry in selectedEntries)
                    Chip(
                      label: Text(entry.value),
                      onDeleted: editable ? () => _removeApp(entry.key) : null,
                    ),
                ],
              ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: editable ? _chooseApps : null,
                icon: const Icon(Icons.checklist),
                label: Text(
                  selectedEntries.isEmpty
                      ? l10n.tr('detoxChooseApps')
                      : l10n
                          .tr('detoxReviewApps')
                          .replaceAll('{n}', '${selectedEntries.length}'),
                ),
              ),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<DetoxMode>(
              initialValue: _mode,
              decoration: InputDecoration(
                labelText: l10n.tr('detoxModeLabel'),
                border: const OutlineInputBorder(),
              ),
              items: [
                DropdownMenuItem(
                  value: DetoxMode.selectedApps,
                  child: Text(
                    l10n.tr('detoxModeSelected'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                DropdownMenuItem(
                  value: DetoxMode.strictFocus,
                  child: Text(
                    l10n.tr('detoxModeStrict'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
              onChanged: editable
                  ? (mode) => setState(() {
                        _mode = mode!;
                        _consent = false;
                      })
                  : null,
              isExpanded: true,
            ),
            if (_mode == DetoxMode.strictFocus) ...[
              const SizedBox(height: 8),
              Text(l10n.tr('detoxStrictNote')),
            ],
          ],
        ),
        const SizedBox(height: 16),
        _SectionCard(
          children: [
            _SectionHeader(
              icon: Icons.timer_outlined,
              title: l10n.tr('detoxLengthTitle'),
              subtitle: l10n.tr('detoxLengthSubtitle'),
            ),
            const SizedBox(height: 16),
            _DurationFields(
              focusController: _focus,
              restController: _rest,
              editable: editable,
            ),
          ],
        ),
        const SizedBox(height: 16),
        _SectionCard(
          children: [
            _SectionHeader(
              icon: Icons.verified_user_outlined,
              title: l10n.tr('detoxPermissionTitle'),
              subtitle: l10n.tr('detoxPermissionSubtitle'),
            ),
            const SizedBox(height: 8),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _consent,
              onChanged: editable
                  ? (value) => setState(() => _consent = value!)
                  : null,
              title: Text(l10n.tr('detoxConsent')),
            ),
            SizedBox(
              width: double.infinity,
              child: _accessibilityOn == false
                  ? FilledButton(
                      onPressed: editable && controller.enforcer.supported
                          ? _explainAndOpenAccessibility
                          : null,
                      child: Text(l10n.tr('detoxEnableBlocking')),
                    )
                  : OutlinedButton(
                      onPressed:
                          editable && _consent && controller.enforcer.supported
                              ? () => controller.run(() async {
                                    await controller.enforcer.platform.invoke(
                                      'openAccessibilitySettings',
                                    );
                                  })
                              : null,
                      child: Text(l10n.tr('detoxOpenAccessibility')),
                    ),
            ),
            if (_accessibilityOn != null) ...[
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    _accessibilityOn!
                        ? Icons.verified_user
                        : Icons.warning_amber,
                    size: 18,
                    color: _accessibilityOn!
                        ? Theme.of(context).colorScheme.primary
                        : Theme.of(context).colorScheme.error,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      l10n.tr(
                        _accessibilityOn!
                            ? 'detoxAccessibilityOn'
                            : 'detoxAccessibilityOff',
                      ),
                      style: TextStyle(
                        fontSize: 13,
                        color: _accessibilityOn!
                            ? null
                            : Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                ],
              ),
            ],
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _timerOnly,
              onChanged: editable
                  ? (value) => setState(() => _timerOnly = value!)
                  : null,
              title: Text(l10n.tr('detoxTimerOnly')),
            ),
          ],
        ),
        if (_selectionError != null) ...[
          const SizedBox(height: 12),
          Text(
            _selectionError!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        if (editable && session != null) ...[
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              // A blocking session cannot start while accessibility is
              // known to be off; the explicit timer-only fallback stays
              // available so the choice is the user's, never silent.
              onPressed: _consent && (_accessibilityOn != false || _timerOnly)
                  ? _start
                  : null,
              child: Text(l10n.tr('detoxReviewStart')),
            ),
          ),
        ],
        const Divider(height: 32),
        if (session != null) ...[
          Text(
            l10n
                .tr('detoxSessionLabel')
                .replaceAll('{state}', session.state.name),
            style: Theme.of(context).textTheme.titleLarge,
          ),
          Text(
            l10n.tr('detoxCurrentMode').replaceAll(
                  '{mode}',
                  session.mode == DetoxMode.strictFocus
                      ? l10n.tr('detoxModeStrictShort')
                      : l10n.tr('detoxModeSelectedShort'),
                ),
          ),
          Text(
            l10n
                .tr('detoxPhase')
                .replaceAll(
                  '{phase}',
                  session.phase == 'break'
                      ? l10n.tr('detoxPhaseBreak')
                      : l10n.tr('detoxPhaseFocus'),
                )
                .replaceAll('{n}', '${session.packages.length}'),
          ),
          Text(
            '${remaining ~/ 60}:${(remaining % 60).toString().padLeft(2, '0')}',
            style: Theme.of(context).textTheme.displayMedium,
          ),
          LinearProgressIndicator(
            value: session.running || session.state == DetoxState.PAUSED
                ? (1 - remaining / total).clamp(0.0, 1.0)
                : 0,
          ),
          Text(
            l10n.tr('detoxRestriction').replaceAll(
                  '{status}',
                  session.restriction.status.name.toUpperCase(),
                ),
          ),
          Text(session.restriction.detail),
          if (session.state == DetoxState.FOCUS_PARTIAL ||
              session.state == DetoxState.FOCUS_UNENFORCED)
            Text(l10n.tr('detoxWarningPartial')),
          if (session.error != null)
            Text(
              session.error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          Wrap(
            spacing: 8,
            children: [
              if (session.running)
                OutlinedButton(
                  onPressed: controller.busy
                      ? null
                      : () => controller.run(session.pause),
                  child: Text(l10n.tr('detoxPause')),
                ),
              if (session.state == DetoxState.PAUSED)
                FilledButton(
                  onPressed: controller.busy
                      ? null
                      : () => controller.run(session.resume),
                  child: Text(l10n.tr('detoxResume')),
                ),
              if (configured)
                OutlinedButton(
                  onPressed: controller.busy
                      ? null
                      : () => controller.run(session.stop),
                  child: Text(l10n.tr('detoxStop')),
                ),
              if (session.state == DetoxState.COMPLETED)
                FilledButton(
                  onPressed: controller.busy
                      ? null
                      : () => controller.run(session.continueCycle),
                  child: Text(l10n.tr('detoxContinueCycle')),
                ),
            ],
          ),
          if (session.state == DetoxState.BREAK_ACTIVE)
            Text(l10n.tr('detoxBreakNote')),
          if (session.state == DetoxState.COMPLETED)
            Text(l10n.tr('detoxCompletedNote')),
          if (session.state == DetoxState.STOPPED)
            Text(l10n.tr('detoxStoppedNote')),
        ],
        if (controller.busy) const LinearProgressIndicator(),
        if (controller.operationError != null)
          Text(
            controller.operationError!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
      ],
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: children,
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(subtitle),
            ],
          ),
        ),
      ],
    );
  }
}

class _DurationFields extends StatelessWidget {
  const _DurationFields({
    required this.focusController,
    required this.restController,
    required this.editable,
  });

  final TextEditingController focusController;
  final TextEditingController restController;
  final bool editable;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final focusField = TextField(
      controller: focusController,
      enabled: editable,
      keyboardType: TextInputType.number,
      decoration: InputDecoration(
        labelText: l10n.tr('detoxFocusMinutes'),
        helperText: l10n.tr('detoxAllowedFocus'),
        suffixText: l10n.tr('detoxMin'),
        border: const OutlineInputBorder(),
      ),
    );
    final restField = TextField(
      controller: restController,
      enabled: editable,
      keyboardType: TextInputType.number,
      decoration: InputDecoration(
        labelText: l10n.tr('detoxBreakMinutes'),
        helperText: l10n.tr('detoxAllowedBreak'),
        suffixText: l10n.tr('detoxMin'),
        border: const OutlineInputBorder(),
      ),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        // On phones the old side-by-side fields clipped their labels and
        // looked stacked on top of each other. Keep them side-by-side only
        // when each field has real room to breathe.
        if (constraints.maxWidth < 520) {
          return Column(
            children: [
              focusField,
              const SizedBox(height: 16),
              restField,
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: focusField),
            const SizedBox(width: 16),
            Expanded(child: restField),
          ],
        );
      },
    );
  }
}
