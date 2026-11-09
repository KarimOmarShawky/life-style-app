import 'weekly_review_screen.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
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
        setState(() =>
            _error = AppLocalizations.of(context).tr('shieldActionError'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _enable(bool enabled) => _run(() async {
        if (enabled) {
          final l10n = AppLocalizations.of(context);
          final consent = await showDialog<bool>(
              context: context,
              builder: (context) => AlertDialog(
                    title: Text(l10n.tr('shieldEnableTitle')),
                    content: Text(l10n.tr('shieldEnableBody')),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: Text(l10n.cancel)),
                      FilledButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: Text(l10n.tr('shieldEnable')))
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

  Future<void> _copyAndOpen(FocusInboxMessage message) {
    final text = _drafts[message.key]?.text ?? '';
    return _run(() async {
      await Clipboard.setData(ClipboardData(text: text));
      await ref
          .read(focusShieldProvider.notifier)
          .grantTemporaryBypass(message.packageName);
      // Native grantTemporaryBypass opens ONLY the exempted package for 60s.
    });
  }

  String _rankLabel(AppLocalizations l10n, int level) {
    if (level >= 10) return l10n.tr('shieldRankLegend');
    if (level >= 8) return l10n.tr('shieldRankMaster');
    if (level >= 5) return l10n.tr('shieldRankPractitioner');
    if (level >= 3) return l10n.tr('shieldRankApprentice');
    return l10n.tr('shieldRankWanderer');
  }

  String _badgeLabel(AppLocalizations l10n, FocusBadge badge) =>
      switch (badge) {
        FocusBadge.firstShield => l10n.tr('shieldBadgeFirst'),
        FocusBadge.ironWill => l10n.tr('shieldBadgeIron'),
        FocusBadge.inboxZeroDistraction => l10n.tr('shieldBadgeInboxZero'),
        FocusBadge.deepWorkStreak => l10n.tr('shieldBadgeStreak'),
        FocusBadge.taskCrusher => l10n.tr('shieldBadgeCrusher'),
      };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
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
      appBar: AppBar(title: Text(l10n.tr('shieldTitle')), actions: [
        IconButton(
            tooltip: l10n.tr('shieldWeeklyReport'),
            icon: const Icon(Icons.insights),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => const WeeklyReviewScreen())))
      ]),
      body: Column(children: [
        // Safety exit is outside async loading/error branches and never hidden.
        Padding(
            padding: const EdgeInsets.all(12),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                  onPressed: () async {
                    try {
                      await ref
                          .read(focusShieldProvider.notifier)
                          .endShieldNow();
                    } catch (_) {
                      // Even if local persistence is unavailable, try the native exit.
                      try {
                        await ref
                            .read(focusShieldPlatformProvider)
                            .invoke('stopShield');
                      } catch (_) {
                        if (mounted) {
                          setState(
                              () => _error = l10n.tr('shieldSettingsError'));
                        }
                      }
                    }
                  },
                  icon: const Icon(Icons.stop_circle_outlined),
                  label: Text(l10n.tr('shieldEndNow'))),
            )),
        if (_error != null)
          Padding(padding: const EdgeInsets.all(12), child: Text(_error!)),
        Expanded(
            child: asyncData.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, __) => Center(child: Text(l10n.tr('shieldLoadError'))),
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
                      text: l10n.tr('shieldStaleMessage'));
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
              _ShieldCard(children: [
                SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(l10n.tr('shieldToggleTitle')),
                    subtitle: Text(l10n.tr('shieldToggleSubtitle')),
                    value: data.enabled,
                    onChanged: _busy ? null : _enable),
                const SizedBox(height: 4),
                Text(l10n
                    .tr('shieldLevelLine')
                    .replaceAll('{level}', '${data.ledger.level}')
                    .replaceAll('{rank}', _rankLabel(l10n, data.ledger.level))
                    .replaceAll('{xp}', '${data.ledger.totalXp}')),
                if (data.badges.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    for (final badge in data.badges)
                      Chip(label: Text(_badgeLabel(l10n, badge)))
                  ]),
                ],
                if (data.platformError != null) ...[
                  const SizedBox(height: 8),
                  Text(data.platformError!),
                ],
              ]),
              if (data.enabled) ...[
                const SizedBox(height: 16),
                _ShieldCard(children: [
                  for (final item in <(String, String)>[
                    (
                      'openAccessibilitySettings',
                      l10n.tr('shieldAccessibility')
                    ),
                    (
                      'openNotificationListenerSettings',
                      l10n.tr('shieldNotificationAccess')
                    ),
                    (
                      'openBatteryOptimizationSettings',
                      l10n.tr('shieldBattery')
                    ),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: SizedBox(
                        width: double.infinity,
                        child: OutlinedButton(
                            onPressed: () => _run(() async {
                                  await ref
                                      .read(focusShieldPlatformProvider)
                                      .invoke(item.$1);
                                }),
                            child: Text(item.$2)),
                      ),
                    ),
                  if (_permissions['notifications'] == false)
                    Text(l10n.tr('shieldNotifUnavailable')),
                  if (_permissions['notificationListener'] == false)
                    Text(l10n.tr('shieldNotifAccessOff')),
                ]),
              ],
              if (data.shield.active) ...[
                const SizedBox(height: 16),
                _ShieldCard(children: [
                  Text(data.shield.taskTitle,
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                      '${remaining ~/ 60}:${(remaining % 60).toString().padLeft(2, '0')} ${l10n.tr('shieldRemaining')}'),
                  Text(l10n.tr('shieldBlockedAttempts').replaceAll(
                      '{n}', '${data.shield.blockedAttemptsCount}')),
                  if (data.lastInterceptPackage != null)
                    Text(data.lastInterceptPackage!),
                ]),
              ],
              const SizedBox(height: 16),
              _ShieldCard(children: [
                Text(l10n.tr('shieldSelectedAppsTitle'),
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(data.blockedPackages.isEmpty
                    ? l10n.tr('shieldSelectedAppsEmpty')
                    : l10n
                        .tr('shieldSelectedAppsCount')
                        .replaceAll('{n}', '${data.blockedPackages.length}')),
              ]),
              const SizedBox(height: 16),
              Text(l10n.tr('shieldInboxTitle'),
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              if (visibleMessages.isEmpty) Text(l10n.tr('shieldInboxEmpty')),
              for (final message in visibleMessages)
                Card(
                    margin: const EdgeInsets.only(bottom: 12),
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
                                  decoration: InputDecoration(
                                      labelText: l10n.tr('shieldReplyHint'))),
                              TextButton(
                                  onPressed: _sending.contains(message.key)
                                      ? null
                                      : () => _reply(message),
                                  child: Text(l10n.tr('shieldSendReply'))),
                              if (_failed.contains(message.key) ||
                                  !data.inbox.containsKey(message.key)) ...[
                                Text(l10n.tr('shieldStaleNote')),
                                OutlinedButton(
                                    onPressed: () => _copyAndOpen(message),
                                    child: Text(l10n.tr('shieldCopyOpen'))),
                              ],
                            ]))),
            ]);
          },
        )),
      ]),
    );
  }
}

class _ShieldCard extends StatelessWidget {
  const _ShieldCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: children,
        ),
      ),
    );
  }
}
