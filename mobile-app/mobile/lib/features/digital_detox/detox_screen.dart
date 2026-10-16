import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'detox_provider.dart';
import 'detox_session.dart';

class DigitalDetoxScreen extends ConsumerStatefulWidget {
  const DigitalDetoxScreen({super.key});
  @override
  ConsumerState<DigitalDetoxScreen> createState() => _DigitalDetoxScreenState();
}

class _DigitalDetoxScreenState extends ConsumerState<DigitalDetoxScreen> {
  DetoxMode _mode = DetoxMode.strictFocus;
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
    try {
      final apps = await ref.read(detoxProvider).enforcer.apps();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => StatefulBuilder(
          builder: (context, update) => AlertDialog(
            title: const Text('Choose distracting applications'),
            content: SizedBox(
              width: 400,
              height: 400,
              child: apps.isEmpty
                  ? const Text(
                      'Android returned no restrictable launchable apps.',
                    )
                  : ListView(
                      children: [
                        for (final app in apps)
                          CheckboxListTile(
                            title: Text(app['label']!),
                            subtitle: Text(app['packageName']!),
                            value: _selected.containsKey(app['packageName']),
                            onChanged: (value) => update(() {
                              if (value == true) {
                                _selected[app['packageName']!] = app['label']!;
                              } else {
                                _selected.remove(app['packageName']);
                              }
                            }),
                          ),
                      ],
                    ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Done'),
              ),
            ],
          ),
        ),
      );
      if (mounted) setState(() => _selectionError = null);
    } catch (_) {
      if (mounted)
        setState(
          () => _selectionError =
              'Application selection is unavailable. No application list has been fabricated.',
        );
    }
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
    return Scaffold(
      appBar: AppBar(title: const Text('Digital Detox')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Deliberate focus, with honest restriction status',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          const Text(
            'Android uses the existing, optional LifeStyle Accessibility Service to redirect distracting app windows. '
            'It does not suspend packages or lock the operating system. Emergency calling, Settings, launcher, keyboards and LifeStyle remain available. '
            'Authorization can be revoked. Other platforms have no restriction integration in this build.',
          ),
          if (session == null)
            const Text('Sign in to create a private session.'),
          const SizedBox(height: 16),
          DropdownButtonFormField<DetoxMode>(
            value: _mode,
            decoration: const InputDecoration(labelText: 'Restriction mode'),
            items: const [
              DropdownMenuItem(
                value: DetoxMode.strictFocus,
                child: Text('Full-device request — Strict Focus alternative'),
              ),
              DropdownMenuItem(
                value: DetoxMode.selectedApps,
                child: Text('Selected applications only'),
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
          if (_mode == DetoxMode.selectedApps) ...[
            OutlinedButton(
              onPressed: editable ? _chooseApps : null,
              child: Text('Select / review applications (${_selected.length})'),
            ),
            Text(_selected.values.join(', ')),
          ],
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _focus,
                  enabled: editable,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Focus minutes (1–180)',
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: TextField(
                  controller: _rest,
                  enabled: editable,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Break minutes (1–60)',
                  ),
                ),
              ),
            ],
          ),
          CheckboxListTile(
            value: _consent,
            onChanged:
                editable ? (value) => setState(() => _consent = value!) : null,
            title: const Text(
              'I understand the scope and consent to the existing accessibility redirect. It can be disabled at any time.',
            ),
          ),
          OutlinedButton(
            onPressed: editable && _consent && controller.enforcer.supported
                ? () => controller.run(() async {
                      await controller.enforcer.platform.invoke(
                        'openAccessibilitySettings',
                      );
                    })
                : null,
            child: const Text('Open Android accessibility authorization'),
          ),
          CheckboxListTile(
            value: _timerOnly,
            onChanged: editable
                ? (value) => setState(() => _timerOnly = value!)
                : null,
            title: const Text(
              'Explicitly allow an UNENFORCED timer if restriction support is unavailable',
            ),
          ),
          if (_selectionError != null)
            Text(
              _selectionError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          if (editable && session != null)
            FilledButton(
              onPressed: _consent ? _start : null,
              child: const Text('Review and start session'),
            ),
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
