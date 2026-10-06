import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/notification_service.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class FocusTimerScreen extends ConsumerStatefulWidget {
  const FocusTimerScreen({super.key});

  @override
  ConsumerState<FocusTimerScreen> createState() => _FocusTimerScreenState();
}

class _FocusTimerScreenState extends ConsumerState<FocusTimerScreen> {
  static const int focusDurationSeconds = 25 * 60; // 25 min
  static const int breakDurationSeconds = 5 * 60; // 5 min

  bool _isBreak = false;
  late int _remainingSeconds;
  Timer? _timer;
  bool _isRunning = false;
  Task? _selectedTask;
  String _selectedAmbient = 'quiet';

  Widget _buildAmbientChip(String key, IconData icon) {
    final l10n = AppLocalizations.of(context);
    final isSelected = _selectedAmbient == key;
    final theme = Theme.of(context);
    return ChoiceChip(
      avatar: Icon(
        icon,
        size: 14,
        color: isSelected ? theme.colorScheme.onPrimary : theme.colorScheme.onSurfaceVariant,
      ),
      label: Text(l10n.ambientLabel(key), style: const TextStyle(fontSize: 12)),
      selected: isSelected,
      onSelected: (_) {
        setState(() => _selectedAmbient = key);
      },
    );
  }

  @override
  void initState() {
    super.initState();
    _remainingSeconds = focusDurationSeconds;
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _toggleTimer() {
    if (_isRunning) {
      _timer?.cancel();
      setState(() => _isRunning = false);
    } else {
      setState(() => _isRunning = true);
      _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (_remainingSeconds > 0) {
          setState(() => _remainingSeconds--);
        } else {
          _onTimerComplete();
        }
      });
    }
  }

  void _resetTimer() {
    _timer?.cancel();
    setState(() {
      _isRunning = false;
      _remainingSeconds =
          _isBreak ? breakDurationSeconds : focusDurationSeconds;
    });
  }

  void _switchMode(bool isBreak) {
    _timer?.cancel();
    setState(() {
      _isBreak = isBreak;
      _isRunning = false;
      _remainingSeconds =
          _isBreak ? breakDurationSeconds : focusDurationSeconds;
    });
  }

  Future<void> _onTimerComplete() async {
    _timer?.cancel();
    setState(() => _isRunning = false);

    final l10n = AppLocalizations.of(context);
    final title = _isBreak ? l10n.breakFinished : l10n.timerFinished;
    final taskName = _selectedTask?.title;
    final body = taskName ?? l10n.focusTimer;

    await NotificationService.instance.showInstantNotification(
      id: 999,
      title: title,
      body: body,
    );

    if (mounted) {
      showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(_isBreak ? l10n.breakSession : l10n.focusSession),
          content: Text(title),
          actions: [
            FilledButton(
              onPressed: () {
                Navigator.of(ctx).pop();
                _switchMode(!_isBreak);
              },
              child: Text(
                _isBreak ? l10n.focusSession : l10n.breakSession,
              ),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final tasksAsync = ref.watch(tasksProvider);

    final totalSeconds =
        _isBreak ? breakDurationSeconds : focusDurationSeconds;
    final progress = _remainingSeconds / totalSeconds;

    final minutes = (_remainingSeconds ~/ 60).toString().padLeft(2, '0');
    final seconds = (_remainingSeconds % 60).toString().padLeft(2, '0');

    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.focusTimer),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            children: [
              // Segmented Button: Focus vs Break
              SegmentedButton<bool>(
                segments: [
                  ButtonSegment(
                    value: false,
                    label: Text(l10n.focusSession),
                    icon: const Icon(Icons.timer_outlined),
                  ),
                  ButtonSegment(
                    value: true,
                    label: Text(l10n.breakSession),
                    icon: const Icon(Icons.coffee_outlined),
                  ),
                ],
                selected: {_isBreak},
                onSelectionChanged: (set) => _switchMode(set.first),
              ),
              const SizedBox(height: 24),

              // Task Selector Dropdown
              tasksAsync.when(
                loading: () => const SizedBox.shrink(),
                error: (_, __) => const SizedBox.shrink(),
                data: (tasks) {
                  final activeTasks =
                      tasks.where((t) => !t.isDone).toList();
                  return DropdownButtonFormField<Task?>(
                    initialValue: _selectedTask,
                    decoration: InputDecoration(
                      labelText: l10n.selectTask,
                      prefixIcon: const Icon(Icons.check_circle_outline),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    items: [
                      DropdownMenuItem<Task?>(
                        value: null,
                        child: Text(l10n.noTaskSelected),
                      ),
                      ...activeTasks.map(
                        (t) => DropdownMenuItem<Task?>(
                          value: t,
                          child: Text(
                            t.title,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                    ],
                    onChanged: _isRunning
                        ? null
                        : (val) {
                            setState(() => _selectedTask = val);
                          },
                  );
                },
              ),
              const Spacer(),

              // Circular Countdown Timer
              Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    width: 240,
                    height: 240,
                    child: CircularProgressIndicator(
                      value: progress,
                      strokeWidth: 12,
                      backgroundColor: colorScheme.surfaceContainerHighest,
                      color: _isBreak
                          ? Colors.teal
                          : colorScheme.primary,
                    ),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '$minutes:$seconds',
                        style: TextStyle(
                          fontSize: 48,
                          fontWeight: FontWeight.bold,
                          color: colorScheme.onSurface,
                          letterSpacing: 2,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _isBreak ? l10n.breakSession : l10n.focusSession,
                        style: TextStyle(
                          fontSize: 16,
                          color: colorScheme.outline,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Ambient Soundscapes Selector
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _buildAmbientChip('quiet', Icons.volume_off_outlined),
                    const SizedBox(width: 8),
                    _buildAmbientChip('rain', Icons.water_drop_outlined),
                    const SizedBox(width: 8),
                    _buildAmbientChip('cafe', Icons.coffee_outlined),
                    const SizedBox(width: 8),
                    _buildAmbientChip('waves', Icons.waves_outlined),
                    const SizedBox(width: 8),
                    _buildAmbientChip('white_noise', Icons.graphic_eq_outlined),
                  ],
                ),
              ),

              const Spacer(),

              // Timer Controls
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  OutlinedButton.icon(
                    onPressed: _resetTimer,
                    icon: const Icon(Icons.refresh),
                    label: Text(l10n.reset),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 20,
                        vertical: 14,
                      ),
                    ),
                  ),
                  const SizedBox(width: 20),
                  FilledButton.icon(
                    onPressed: _toggleTimer,
                    icon: Icon(_isRunning ? Icons.pause : Icons.play_arrow),
                    label: Text(_isRunning ? l10n.pause : l10n.start),
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 32,
                        vertical: 14,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }
}
