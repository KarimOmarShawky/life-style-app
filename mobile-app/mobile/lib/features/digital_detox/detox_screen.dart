import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'detox_app_picker_screen.dart';
import 'detox_provider.dart';
import 'detox_session.dart';

class DigitalDetoxScreen extends ConsumerStatefulWidget {
  const DigitalDetoxScreen({super.key});
  @override
  ConsumerState<DigitalDetoxScreen> createState() => _DigitalDetoxScreenState();
}

class _DigitalDetoxScreenState extends ConsumerState<DigitalDetoxScreen> {
  // App selection is the primary flow: the user explicitly picks the apps
  // to redirect. Strict Focus stays available as an advanced alternative.
  DetoxMode _mode = DetoxMode.selectedApps;
  final _focus = TextEditingController(text: '45');
  final _rest = TextEditingController(text: '15');
  final _selected = <String, String>{};
  bool _consent = false;
  bool _timerOnly = false;
  String? _selectionError;
  @override
  void dispose() {
    _focus.dispose();
    _rest.dispose();
    super.dispose();
  }

  Future<void> _chooseApps() async {
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
  }

  Future<void> _start() async {
    final focus = int.tryParse(_focus.text);
    final rest = int.tryParse(_rest.text);
    if (focus == null ||
        rest == null ||
        focus < 1 ||
        focus > 180 ||
        rest < 1 ||
        rest > 60) {
      setState(
        () => _selectionError = 'Focus: 1–180 minutes. Break: 1–60 minutes.',
      );
      return;
    }
    if (_mode == DetoxMode.selectedApps && _selected.isEmpty) {
      setState(
        () => _selectionError = 'Select at least one application first.',
      );
      return;
    }
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirm Digital Detox session'),
        content: Text(
          '$focus minute focus, $rest minute break. No automatic repeat. '
          '${_mode == DetoxMode.strictFocus ? 'Strict Focus redirects visible launchable non-safety apps; it cannot lock the phone.' : '${_selected.length} selected applications will be requested for accessibility redirect.'} '
          '${_timerOnly ? 'You allow an unenforced timer if restrictions are unavailable.' : 'If restrictions are unavailable, the session will report an error.'}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Start'),
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
    final controller = ref.watch(detoxProvider);
    final session = controller.session;
    final configured = session != null &&
        ![
          DetoxState.IDLE,
          DetoxState.STOPPED,
          DetoxState.COMPLETED,
        ].contains(session.state);
    final editable = !configured && !controller.busy;
    final remaining = session?.remainingSeconds ?? 0;
    final total = session?.phase == 'break'
        ? (session?.breakMinutes ?? 15) * 60
        : (session?.focusMinutes ?? 45) * 60;
    final selectedEntries = _selected.entries.toList()
      ..sort(
        (a, b) => a.value.toLowerCase().compareTo(b.value.toLowerCase()),
      );
    return Scaffold(
      appBar: AppBar(title: const Text('Digital Detox')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          Text(
            'Choose apps. Focus without the clutter.',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          const Text(
            'Pick the distracting applications yourself. LifeStyle can redirect you away from them during focus, but it does not lock the phone: emergency calling, Settings, launcher, keyboards and LifeStyle remain available.',
          ),
          if (session == null) ...[
            const SizedBox(height: 12),
            const Text('Sign in to create a private session.'),
          ],
          const SizedBox(height: 16),
          _SectionCard(
            children: [
              const _SectionHeader(
                icon: Icons.apps_outlined,
                title: '1 · Applications',
                subtitle:
                    'These are the only apps requested for redirection in Selected applications mode.',
              ),
              const SizedBox(height: 12),
              if (selectedEntries.isEmpty)
                const Text('No applications selected yet.')
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final entry in selectedEntries)
                      Chip(
                        label: Text(entry.value),
                        onDeleted: editable
                            ? () => setState(
                                  () => _selected.remove(entry.key),
                                )
                            : null,
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
                        ? 'Choose applications'
                        : 'Review applications (${selectedEntries.length})',
                  ),
                ),
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<DetoxMode>(
                initialValue: _mode,
                decoration: const InputDecoration(
                  labelText: 'Restriction mode',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(
                    value: DetoxMode.selectedApps,
                    child: Text(
                      'Selected applications',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  DropdownMenuItem(
                    value: DetoxMode.strictFocus,
                    child: Text(
                      'Strict Focus — all non-safety apps',
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
                const Text(
                  'Strict Focus does not use the selected-app list above.',
                ),
              ],
            ],
          ),
          const SizedBox(height: 16),
          _SectionCard(
            children: [
              const _SectionHeader(
                icon: Icons.timer_outlined,
                title: '2 · Session length',
                subtitle:
                    'One focus block followed by one break. No automatic repeat.',
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
              const _SectionHeader(
                icon: Icons.verified_user_outlined,
                title: '3 · Permission & consent',
                subtitle:
                    'Restriction uses the optional LifeStyle Accessibility Service and can be revoked in Android Settings.',
              ),
              const SizedBox(height: 8),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _consent,
                onChanged: editable
                    ? (value) => setState(() => _consent = value!)
                    : null,
                title: const Text(
                  'I understand the scope and consent to the existing accessibility redirect. It can be disabled at any time.',
                ),
              ),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed:
                      editable && _consent && controller.enforcer.supported
                          ? () => controller.run(() async {
                                await controller.enforcer.platform.invoke(
                                  'openAccessibilitySettings',
                                );
                              })
                          : null,
                  child: const Text('Open Android accessibility authorization'),
                ),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _timerOnly,
                onChanged: editable
                    ? (value) => setState(() => _timerOnly = value!)
                    : null,
                title: const Text(
                  'Explicitly allow an UNENFORCED timer if restriction support is unavailable',
                ),
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
                onPressed: _consent ? _start : null,
                child: const Text('Review and start session'),
              ),
            ),
          ],
          const Divider(height: 32),
          if (session != null) ...[
            Text(
              'Session: ${session.state.name}',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            Text(
              'Current mode: ${session.mode == DetoxMode.strictFocus ? 'Strict Focus alternative (not device lock)' : 'Selected applications'}',
            ),
            Text(
              'Phase: ${session.phase} • ${session.packages.length} explicitly selected applications',
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
              'Actual restriction: ${session.restriction.status.name.toUpperCase()}',
            ),
            Text(session.restriction.detail),
            if (session.state == DetoxState.FOCUS_PARTIAL ||
                session.state == DetoxState.FOCUS_UNENFORCED)
              const Text(
                'Warning: the requested restriction is NOT fully enforced.',
              ),
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
                    child: const Text('Pause and release'),
                  ),
                if (session.state == DetoxState.PAUSED)
                  FilledButton(
                    onPressed: controller.busy
                        ? null
                        : () => controller.run(session.resume),
                    child: const Text('Resume'),
                  ),
                if (configured)
                  OutlinedButton(
                    onPressed: controller.busy
                        ? null
                        : () => controller.run(session.stop),
                    child: const Text('Stop / retry release'),
                  ),
                if (session.state == DetoxState.COMPLETED)
                  FilledButton(
                    onPressed: controller.busy
                        ? null
                        : () => controller.run(session.continueCycle),
                    child: const Text('Continue another focus cycle'),
                  ),
              ],
            ),
            if (session.state == DetoxState.BREAK_ACTIVE)
              const Text(
                'Restrictions owned by this session were released. The cycle ends after this break; another focus requires Continue.',
              ),
            if (session.state == DetoxState.COMPLETED)
              const Text(
                'Session completed. No automatic repeat. Your device is not locked.',
              ),
            if (session.state == DetoxState.STOPPED)
              const Text('Session stopped and owned restrictions released.'),
          ],
          if (controller.busy) const LinearProgressIndicator(),
          if (controller.operationError != null)
            Text(
              controller.operationError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
        ],
      ),
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
    final focusField = TextField(
      controller: focusController,
      enabled: editable,
      keyboardType: TextInputType.number,
      decoration: const InputDecoration(
        labelText: 'Focus minutes',
        helperText: 'Allowed: 1–180',
        suffixText: 'min',
        border: OutlineInputBorder(),
      ),
    );
    final restField = TextField(
      controller: restController,
      enabled: editable,
      keyboardType: TextInputType.number,
      decoration: const InputDecoration(
        labelText: 'Break minutes',
        helperText: 'Allowed: 1–60',
        suffixText: 'min',
        border: OutlineInputBorder(),
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
