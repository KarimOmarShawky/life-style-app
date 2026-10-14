import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_screen.dart';
import 'dart:async';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/notification_service.dart';
import 'package:lifestyle_mobile/features/timer/data/timer_sessions_repository.dart';
import 'package:lifestyle_mobile/features/timer/presentation/focus_history_screen.dart';
import 'package:lifestyle_mobile/features/timer/state/timer_sessions_provider.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/features/timer/data/session_audio_player.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class FocusTimerScreen extends ConsumerStatefulWidget {
  const FocusTimerScreen({super.key});

  @override
  ConsumerState<FocusTimerScreen> createState() => _FocusTimerScreenState();
}

class _FocusTimerScreenState extends ConsumerState<FocusTimerScreen> {
  static const int focusDurationSeconds = 25 * 60; // 25 min
  static const int breakDurationSeconds = 5 * 60; // 5 min

  static const String _prefAmbient = 'focus.ambient';
  static const String _prefSongPath = 'focus.song.path';
  static const String _prefSongName = 'focus.song.name';

  bool _isBreak = false;
  late int _remainingSeconds;
  Timer? _timer;
  bool _isRunning = false;
  Task? _selectedTask;
  String _selectedAmbient = 'quiet';
  String? _songPath;
  String? _songName;
  late final TimerSessionsRepository _sessionsRepository;
  late final FocusShieldController _focusController;
  Future<void> _focusQueue = Future<void>.value();
  Future<void> _syncQueue = Future<void>.value();
  String? _runningSessionId;
  bool _disposed = false;

  Widget _buildAmbientChip(String key, IconData icon) {
    final l10n = AppLocalizations.of(context);
    final isSelected = _selectedAmbient == key;
    final theme = Theme.of(context);
    return ChoiceChip(
      avatar: Icon(
        icon,
        size: 14,
        color: isSelected
            ? theme.colorScheme.onPrimary
            : theme.colorScheme.onSurfaceVariant,
      ),
      label: Text(l10n.ambientLabel(key), style: const TextStyle(fontSize: 12)),
      selected: isSelected,
      onSelected: (_) => _selectAmbient(key),
    );
  }

  @override
  void initState() {
    super.initState();
    _sessionsRepository = ref.read(timerSessionsRepositoryProvider);
    _focusController = ref.read(focusShieldProvider.notifier);
    _remainingSeconds = focusDurationSeconds;
    _loadPrefs();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _stopSessionSync();
    SessionAudioPlayer.instance.stop();
    super.dispose();
  }

  /// Backend sync runs as a queue, so a start can never overtake the stop that follows it.
  /// Each step is isolated: a failed step is reported and the queue keeps going.
  void _enqueueSync(Future<void> Function() step) {
    _syncQueue = _syncQueue.then((_) => step()).catchError((Object _) {});
  }

  /// Opens a backend session for a focus period. The task is optional.
  /// Breaks are not tracked on the server.
  void _startSessionSync() {
    if (_isBreak) return;
    final taskId = _selectedTask?.id;
    final id = 'timer-${DateTime.now().microsecondsSinceEpoch}';
    final title = _selectedTask?.title ?? 'Focus';
    final seconds = _remainingSeconds;
    _focusQueue = _focusQueue
        .then((_) => _focusController.beginTimer(
            id: id, taskTitle: title, seconds: seconds, taskId: taskId))
        .catchError((Object error) {
      _reportSyncError(error);
    });
    _enqueueSync(() async {
      _runningSessionId = await _openSession(taskId);
      if (_runningSessionId != null) {
        await _focusController.attachBackendSession(id, _runningSessionId!);
      }
    });
  }

  void _stopSessionSync({bool completed = false}) {
    _focusQueue = _focusQueue
        .then((_) => _focusController.finishTimer(completed: completed))
        .catchError((Object error) {
      _reportSyncError(error);
    });
    _enqueueSync(() async {
      final sessionId = _runningSessionId;
      _runningSessionId = null;
      if (sessionId != null) await _closeSession(sessionId);
    });
  }

  Future<String?> _openSession(String? taskId) async {
    try {
      try {
        return (await _sessionsRepository.startSession(taskId)).id;
      } on ApiException catch (error) {
        if (error.code != 'TIMER_ALREADY_RUNNING') rethrow;
        // A session left open earlier (for example, the app was closed mid-focus) blocks the new one.
        final stale = await _sessionsRepository.getActiveSession();
        if (stale != null) await _sessionsRepository.stopSession(stale.id);
        return (await _sessionsRepository.startSession(taskId)).id;
      }
    } catch (error) {
      _reportSyncError(error);
      return null;
    }
  }

  Future<void> _closeSession(String sessionId) async {
    try {
      await _sessionsRepository.stopSession(sessionId);
    } on ApiException catch (error) {
      // Already closed on the server (for example by the 12-hour auto-close): nothing to do.
      if (error.code == 'TIMER_NOT_RUNNING') return;
      _reportSyncError(error);
    } catch (error) {
      _reportSyncError(error);
    }
  }

  void _reportSyncError(Object error) {
    if (_disposed || !mounted) return;
    final l10n = AppLocalizations.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('${l10n.focusSyncFailed}: $error')),
    );
  }

  Future<void> _loadPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _selectedAmbient = prefs.getString(_prefAmbient) ?? 'quiet';
      _songPath = prefs.getString(_prefSongPath);
      _songName = prefs.getString(_prefSongName);
      if (_selectedAmbient == 'music' && _songPath == null) {
        _selectedAmbient = 'quiet';
      }
    });
  }

  Future<void> _savePrefs() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefAmbient, _selectedAmbient);
    final path = _songPath;
    if (path == null) {
      await prefs.remove(_prefSongPath);
      await prefs.remove(_prefSongName);
    } else {
      await prefs.setString(_prefSongPath, path);
      await prefs.setString(_prefSongName, _songName ?? '');
    }
  }

  Future<void> _selectAmbient(String key) async {
    setState(() => _selectedAmbient = key);
    await _savePrefs();
    if (key == 'music' && _songPath == null) {
      await _pickSong();
      return;
    }
    if (_isRunning) await _startAudio();
  }

  Future<void> _pickSong() async {
    final picked = await FilePicker.pickFile(type: FileType.audio);
    final path = picked?.path;
    if (path == null) {
      if (mounted && _selectedAmbient == 'music' && _songPath == null) {
        setState(() => _selectedAmbient = 'quiet');
        await _savePrefs();
      }
      return;
    }
    if (!mounted) return;
    setState(() {
      _songPath = path;
      _songName = path.split(RegExp(r'[/\\]')).last;
      _selectedAmbient = 'music';
    });
    await _savePrefs();
    if (_isRunning) await _startAudio();
  }

  Future<void> _clearSong() async {
    setState(() {
      _songPath = null;
      _songName = null;
      if (_selectedAmbient == 'music') _selectedAmbient = 'quiet';
    });
    await _savePrefs();
    if (_isRunning) await _startAudio();
  }

  Future<void> _startAudio() async {
    final player = SessionAudioPlayer.instance;
    if (_selectedAmbient == 'music') {
      final path = _songPath;
      if (path == null) {
        await player.stop();
        return;
      }
      await player.playSong(path);
    } else {
      await player.playAmbient(_selectedAmbient);
    }
  }

  void _stopAudio() => SessionAudioPlayer.instance.stop();

  Future<void> _toggleTimer() async {
    if (_isRunning) {
      _timer?.cancel();
      _stopAudio();
      setState(() => _isRunning = false);
      _stopSessionSync();
    } else {
      setState(() => _isRunning = true);
      _startSessionSync();
      await _startAudio();
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
    _stopAudio();
    setState(() {
      _isRunning = false;
      _remainingSeconds =
          _isBreak ? breakDurationSeconds : focusDurationSeconds;
    });
    _stopSessionSync();
  }

  void _switchMode(bool isBreak) {
    _timer?.cancel();
    _stopAudio();
    setState(() {
      _isBreak = isBreak;
      _isRunning = false;
      _remainingSeconds =
          _isBreak ? breakDurationSeconds : focusDurationSeconds;
    });
    _stopSessionSync();
  }

  Future<void> _onTimerComplete() async {
    _timer?.cancel();
    _stopAudio();
    setState(() => _isRunning = false);
    _stopSessionSync(completed: !_isBreak);

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

    final totalSeconds = _isBreak ? breakDurationSeconds : focusDurationSeconds;
    final progress = _remainingSeconds / totalSeconds;

    final minutes = (_remainingSeconds ~/ 60).toString().padLeft(2, '0');
    final seconds = (_remainingSeconds % 60).toString().padLeft(2, '0');

    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.focusTimer),
        actions: [
          IconButton(
              tooltip: 'Focus Shield',
              icon: const Icon(Icons.shield_outlined),
              onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                      builder: (_) => const FocusShieldScreen()))),
          IconButton(
            tooltip: l10n.focusHistoryTitle,
            icon: const Icon(Icons.history),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const FocusHistoryScreen(),
              ),
            ),
          ),
        ],
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
                  final activeTasks = tasks.where((t) => !t.isDone).toList();
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
                      color: _isBreak ? Colors.teal : colorScheme.primary,
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

              // Ambient Soundscapes + user music selector
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
                    const SizedBox(width: 8),
                    _buildAmbientChip('music', Icons.library_music_outlined),
                  ],
                ),
              ),
              if (_songName != null) ...[
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.music_note_outlined,
                      size: 16,
                      color: colorScheme.outline,
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        _songName!,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          color: colorScheme.outline,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 16),
                      tooltip: l10n.tr('timer.clearSong'),
                      visualDensity: VisualDensity.compact,
                      onPressed: _clearSong,
                    ),
                  ],
                ),
              ],
              TextButton.icon(
                onPressed: _pickSong,
                icon: const Icon(Icons.library_add_outlined, size: 18),
                label: Text(
                  l10n.tr('timer.pickSong'),
                  style: const TextStyle(fontSize: 12),
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
