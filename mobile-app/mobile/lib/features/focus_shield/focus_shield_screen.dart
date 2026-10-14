import 'package:lifestyle_mobile/features/timer/presentation/focus_timer_screen.dart';
import 'weekly_review_screen.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'focus_shield_models.dart';
import 'focus_shield_provider.dart';

class FocusShieldScreen extends ConsumerStatefulWidget {
  const FocusShieldScreen({super.key});
  @override
  ConsumerState<FocusShieldScreen> createState() => _FocusShieldScreenState();
}

class _FocusShieldScreenState extends ConsumerState<FocusShieldScreen>
    with WidgetsBindingObserver {
  final _drafts = <String, TextEditingController>{};
  final _messages = <String, FocusInboxMessage>{};
  final _failed = <String>{};
  final _sending = <String>{};
  Timer? _ticker;
  bool _busy = false;
  String? _error;
  Map<String, dynamic> _permissions = const {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    for (final draft in _drafts.values) {
      draft.dispose();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    await _run(() async {
      await ref.read(focusShieldProvider.notifier).refreshNative();
      final permissions = await ref
          .read(focusShieldPlatformProvider)
          .invoke('getPermissionStatus');
      if (mounted) setState(() => _permissions = permissions);
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Could not complete the action. Your reply draft is preserved.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _enable(bool enabled) => _run(() async {
        if (enabled) {
          final consent = await showDialog<bool>(
              context: context,
              builder: (context) => AlertDialog(
                    title: const Text('Enable Focus Shield?'),
                    content: const Text(
                        'LifeStyle can return you from selected apps during focus and read message notifications from supported messaging apps into a temporary inbox. Messages stay in memory, are never sent to AI, and are cleared when the session ends. You can end the shield at any time. Android permissions are optional and can be revoked in Settings.'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: const Text('Cancel')),
                      FilledButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: const Text('Enable'))
                    ],
                  ));
          if (consent != true) return;
          // The native implementation requests POST_NOTIFICATIONS here on API 33+.
          await ref
              .read(focusShieldPlatformProvider)
              .invoke('getPermissionStatus', {'requestNotifications': true});
        }
        await ref.read(focusShieldProvider.notifier).setEnabled(enabled);
      });
  Future<void> _pickApp() => _run(() async {
        final result = await ref
            .read(focusShieldPlatformProvider)
            .invoke('getInstalledApps');
        final apps =
            (result['apps'] as List<dynamic>).cast<Map<dynamic, dynamic>>();
        if (!mounted) return;
        final selected = await showDialog<String>(
            context: context,
            builder: (context) => SimpleDialog(
                  title: const Text('Installed launchable apps'),
                  children: [
                    for (final app in apps)
                      SimpleDialogOption(
                          onPressed: () => Navigator.pop(
                              context, app['packageName'] as String),
                          child: Text('${app['label']}\n${app['packageName']}'))
                  ],
                ));
        if (selected != null) {
          await ref
              .read(focusShieldProvider.notifier)
              .setBlocked(selected, true);
        }
      });
  Future<void> _customPackage() => _run(() async {
        final input = TextEditingController();
        final packageName = await showDialog<String>(
            context: context,
            builder: (context) => AlertDialog(
                  title: const Text('Custom package'),
                  content: TextField(
                      controller: input,
                      decoration:
                          const InputDecoration(hintText: 'com.example.app')),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: () =>
                            Navigator.pop(context, input.text.trim()),
                        child: const Text('Add'))
                  ],
                ));
        input.dispose();
        if (packageName != null) {
          await ref
              .read(focusShieldProvider.notifier)
              .setBlocked(packageName, true);
        }
      });
  Future<void> _reply(FocusInboxMessage message) async {
    setState(() => _sending.add(message.key));
    final draft = _drafts[message.key]!;
    final text = draft.text;
    final result =
        await ref.read(focusShieldProvider.notifier).reply(message.key, text);
    if (!mounted || _drafts[message.key] != draft) return;
    setState(() {
      _sending.remove(message.key);
      if (result == ReplyResult.sent) {
        if (draft.text == text) draft.clear();
        _failed.remove(message.key);
      } else {
        _failed.add(message.key);
      }
    });
  }

  Future<void> _copyAndOpen(FocusInboxMessage message) => _run(() async {
        final text = _drafts[message.key]?.text ?? '';
        await Clipboard.setData(ClipboardData(text: text));
        await ref
            .read(focusShieldProvider.notifier)
            .grantTemporaryBypass(message.packageName);
        // Native grantTemporaryBypass opens ONLY the exempted package for 60s.
      });

  @override
  Widget build(BuildContext context) {
    final asyncData = ref.watch(focusShieldProvider);
    ref.listen(focusShieldProvider, (previous, next) {
      final data = next.asData?.value;
      if (data != null && !data.shield.active && _drafts.isNotEmpty) {
        for (final draft in _drafts.values) {
          draft.dispose();
        }
        _drafts.clear();
        _messages.clear();
        _failed.clear();
        _sending.clear();
      }
    });
    return Scaffold(
      appBar: AppBar(title: const Text('Focus Shield'), actions: [
        IconButton(
            tooltip: 'Weekly Brain Report',
            icon: const Icon(Icons.insights),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => const WeeklyReviewScreen())))
      ]),
      body: Column(children: [
        // Safety exit is outside async loading/error branches and never hidden.
        Padding(
            padding: const EdgeInsets.all(12),
            child: FilledButton.icon(
                onPressed: () async {
                  try {
                    await ref.read(focusShieldProvider.notifier).endShieldNow();
                  } catch (_) {
                    // Even if local persistence is unavailable, try the native exit.
                    try {
                      await ref
                          .read(focusShieldPlatformProvider)
                          .invoke('stopShield');
                    } catch (_) {
                      if (mounted) {
                        setState(() => _error =
                            'Open Android Settings to disable LifeStyle accessibility.');
                      }
                    }
                  }
                },
                icon: const Icon(Icons.stop_circle_outlined),
                label: const Text('End shield now'))),
        if (_error != null)
          Padding(padding: const EdgeInsets.all(12), child: Text(_error!)),
        Expanded(
            child: asyncData.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, __) =>
              const Center(child: Text('Could not load productivity data.')),
          data: (data) {
            final remaining = ((data.shield.endTimestampMs -
                        DateTime.now().millisecondsSinceEpoch) ~/
                    1000)
                .clamp(0, 86400);
            for (final message in data.inbox.values) {
              _messages[message.key] = message;
              _drafts.putIfAbsent(message.key, TextEditingController.new);
            }
            for (final key in _messages.keys.toList()) {
              if (!data.inbox.containsKey(key)) {
                final old = _messages[key]!;
                if (_drafts[key]?.text.isNotEmpty ?? false) {
                  _messages[key] = FocusInboxMessage(
                      key: key,
                      packageName: old.packageName,
                      sender: '',
                      text: 'Notification removed or stale');
                } else {
                  _messages.remove(key);
                  _drafts.remove(key)?.dispose();
                }
              }
            }
            final visibleMessages = _messages.values.where((m) =>
                data.inbox.containsKey(m.key) ||
                (_drafts[m.key]?.text.isNotEmpty ?? false));
            return ListView(padding: const EdgeInsets.all(16), children: [
              SwitchListTile(
                  title: const Text('Focus Shield (off by default)'),
                  subtitle: const Text(
                      'Enable permissions first, then start a focus timer.'),
                  value: data.enabled,
                  onChanged: _busy ? null : _enable),
              Text(
                  'Lv.${data.ledger.level} ${data.ledger.rank} · ${data.ledger.totalXp} XP'),
              Wrap(spacing: 8, children: [
                for (final badge in data.badges) Chip(label: Text(badge.title))
              ]),
              if (data.platformError != null) Text(data.platformError!),
              if (data.enabled) ...[
                for (final item in <(String, String)>[
                  ('openAccessibilitySettings', 'Accessibility settings'),
                  (
                    'openNotificationListenerSettings',
                    'Notification access settings'
                  ),
                  (
                    'openBatteryOptimizationSettings',
                    'Battery optimization settings'
                  ),
                ])
                  OutlinedButton(
                      onPressed: () => _run(() async {
                            await ref
                                .read(focusShieldPlatformProvider)
                                .invoke(item.$1);
                          }),
                      child: Text(item.$2)),
                if (_permissions['notifications'] == false)
                  const Text(
                      'Notification control is unavailable. Use End shield now on this screen.'),
                if (_permissions['notificationListener'] == false)
                  const Text(
                      'Notification access is off. Focus Inbox is unavailable; blocking can still work.'),
              ],
              if (data.shield.active)
                Card(
                    child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(
                            '${data.shield.taskTitle}\n${remaining ~/ 60}:${(remaining % 60).toString().padLeft(2, '0')} remaining\nBlocked Distraction Attempts: ${data.shield.blockedAttemptsCount}\n${data.lastInterceptPackage ?? ''}'))),
              OutlinedButton(
                  onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                          builder: (_) => const FocusTimerScreen())),
                  child: const Text('Open focus timer')),
              const Divider(),
              const Text('Focus Inbox'),
              if (visibleMessages.isEmpty)
                const Text(
                    'No messages. Notifications are kept only during an active shield session.'),
              for (final message in visibleMessages)
                Card(
                    child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                  '${message.sender} · ${message.packageName}'),
                              Text(message.text),
                              TextField(
                                  controller: _drafts[message.key],
                                  decoration: const InputDecoration(
                                      labelText: 'Reply inside LifeStyle')),
                              TextButton(
                                  onPressed: _sending.contains(message.key)
                                      ? null
                                      : () => _reply(message),
                                  child: const Text('Send reply')),
                              if (_failed.contains(message.key) ||
                                  !data.inbox.containsKey(message.key)) ...[
                                const Text(
                                    'Reply unavailable or stale. Your draft has not been cleared.'),
                                OutlinedButton(
                                    onPressed: () => _copyAndOpen(message),
                                    child:
                                        const Text('Copy & open app for 60s')),
                              ],
                            ]))),
              const Divider(),
              const Text('Blocked apps (toggle each app)'),
              Row(children: [
                TextButton(
                    onPressed: data.shield.active ? null : _pickApp,
                    child: const Text('Installed apps')),
                TextButton(
                    onPressed: data.shield.active ? null : _customPackage,
                    child: const Text('Custom package'))
              ]),
              for (final packageName
                  in {...defaultBlockedPackages, ...data.blockedPackages}
                      .toList()
                    ..sort())
                CheckboxListTile(
                    title: Text(packageName),
                    value: data.blockedPackages.contains(packageName),
                    onChanged: _busy || data.shield.active
                        ? null
                        : (value) => _run(() => ref
                            .read(focusShieldProvider.notifier)
                            .setBlocked(packageName, value ?? false))),
            ]);
          },
        )),
      ]),
    );
  }
}
