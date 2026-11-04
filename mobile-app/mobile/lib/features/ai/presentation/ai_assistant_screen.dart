import 'dart:async';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/presentation/gemini_key_dialog.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class AiAssistantScreen extends ConsumerStatefulWidget {
  const AiAssistantScreen({super.key});

  @override
  ConsumerState<AiAssistantScreen> createState() => _AiAssistantScreenState();
}

class _AiAssistantScreenState extends ConsumerState<AiAssistantScreen> {
  final _messages = <ChatMessage>[];

  final _textController = TextEditingController();
  final _scrollController = ScrollController();
  bool _isGenerating = false;
  bool _consentedToEgress = false;
  bool _isListening = false;
  bool _isSpeaking = false;

  StreamSubscription<String>? _streamSub;
  AudioPlayer? _audioPlayer;

  static const _nativeVoiceChannel =
      MethodChannel('com.example.lifestyle_mobile/native_voice');

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_messages.isEmpty) {
      final l10n = AppLocalizations.of(context);
      _messages.add(
        ChatMessage(
          role: 'model',
          text: l10n.aiWelcomeMessage,
        ),
      );
    }
  }

  @override
  void dispose() {
    _streamSub?.cancel();
    _audioPlayer?.dispose();
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _handleSend([String? presetText]) async {
    final text = (presetText ?? _textController.text).trim();
    if (text.isEmpty || _isGenerating) return;

    if (!_consentedToEgress) {
      final approved = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Send conversation to Google Gemini?'),
          content: const Text(
            'Your typed text, conversation history, display name and task/habit counts are sent to Google using your API key. '
            'Financial records are not included automatically. Do not type secrets or sensitive information. Google applies its own data policies.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Agree and send'),
            ),
          ],
        ),
      );
      if (approved != true || !mounted) return;
      _consentedToEgress = true;
    }
    if (!mounted) return;
    final l10n = AppLocalizations.of(context);

    _textController.clear();
    setState(() {
      _messages.add(
        ChatMessage(
          role: 'user',
          text: text,
          timestamp: DateTime.now(),
        ),
      );
      _isGenerating = true;
      _isListening = false;
    });
    _scrollToBottom();

    // Use streaming: add an empty model placeholder, then fill it in
    // token-by-token as the stream yields chunks.
    final placeholder = ChatMessage(
      role: 'model',
      text: '',
      timestamp: DateTime.now(),
    );
    setState(() {
      _messages.add(placeholder);
    });
    _scrollToBottom();

    final buffer = StringBuffer();
    _streamSub?.cancel();
    _streamSub = AiService.instance
        .streamMessage(
      conversationHistory: _messages.sublist(0, _messages.length - 1),
      newMessage: text,
      languageName: l10n.promptLanguageName,
    )
        .listen(
      (chunk) {
        if (!mounted) return;
        buffer.write(chunk);
        final idx = _messages.lastIndexOf(placeholder);
        if (idx != -1) {
          _messages[idx] = ChatMessage(
            role: 'model',
            text: buffer.toString(),
            timestamp: placeholder.timestamp,
          );
          setState(() {});
          _scrollToBottom();
        }
      },
      onError: (Object _) {
        if (!mounted) return;
        final l10n = AppLocalizations.of(context);
        setState(() {
          final idx = _messages.lastIndexOf(placeholder);
          if (idx != -1) {
            _messages[idx] = ChatMessage(
              role: 'model',
              text: l10n.aiErrorMessage,
              timestamp: placeholder.timestamp,
            );
          }
          _isGenerating = false;
        });
        _scrollToBottom();
      },
      onDone: () {
        if (!mounted) return;
        setState(() {
          final idx = _messages.lastIndexOf(placeholder);
          if (idx != -1 && buffer.toString().isEmpty) {
            _messages[idx] = ChatMessage(
              role: 'model',
              text: l10n.aiErrorMessage,
              timestamp: placeholder.timestamp,
            );
          }
          _isGenerating = false;
        });
        _scrollToBottom();
      },
    );
  }

  Future<void> _toggleVoiceInput() async {
    if (_isListening) {
      setState(() => _isListening = false);
      return;
    }
    setState(() => _isListening = true);
    try {
      final l10n = AppLocalizations.of(context);
      final spokenText = await _nativeVoiceChannel.invokeMethod<String>(
        'startVoiceRecognition',
        <String, String>{
          'languageTag': l10n.locale.toLanguageTag(),
        },
      );
      if (!mounted) return;
      if (spokenText != null && spokenText.trim().isNotEmpty) {
        _textController.text = spokenText.trim();
        _textController.selection = TextSelection.fromPosition(
          TextPosition(offset: _textController.text.length),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.noSpeechDetected)),
        );
      }
    } catch (_) {
      // Speech recognition failed; fall back silently.
    } finally {
      if (mounted) setState(() => _isListening = false);
    }
  }

  Future<void> _speakLastResponse() async {
    if (_isSpeaking) {
      await _stopSpeaking();
      return;
    }
    // Find the last model message to speak.
    final lastModel = [..._messages].reversed.firstWhere(
          (m) => m.role == 'model',
          orElse: () => ChatMessage(role: 'model', text: ''),
        );
    if (lastModel.text.trim().isEmpty) return;

    final l10n = AppLocalizations.of(context);
    setState(() => _isSpeaking = true);
    try {
      final bytes = await AiService.instance.speakText(
        text: lastModel.text,
        languageName: l10n.promptLanguageName,
      );
      if (!mounted || bytes.isEmpty) {
        if (mounted) setState(() => _isSpeaking = false);
        return;
      }
      // audioplayers 6.x plays from a file path, so write the audio
      // bytes to a temporary file first.
      final tempFile = File(
        '${Directory.systemTemp.path}/lifestyle_tts_${DateTime.now().millisecondsSinceEpoch}.mp3',
      );
      await tempFile.writeAsBytes(bytes);
      final player = AudioPlayer();
      _audioPlayer = player;
      await player.play(DeviceFileSource(tempFile.path));
      player.onPlayerComplete.listen((_) {
        if (mounted) setState(() => _isSpeaking = false);
        tempFile.delete();
      });
    } catch (_) {
      if (mounted) setState(() => _isSpeaking = false);
    }
  }

  Future<void> _stopSpeaking() async {
    try {
      await _audioPlayer?.stop();
    } catch (_) {
      // Already stopped.
    }
    if (mounted) setState(() => _isSpeaking = false);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    final suggestions = [
      l10n.aiSuggestion1,
      l10n.aiSuggestion2,
      l10n.aiSuggestion3,
      l10n.aiSuggestion4,
      l10n.aiSuggestionAnalyzeTasks,
      l10n.aiSuggestionHabitInsights,
      l10n.aiSuggestionPlanGoal,
      l10n.aiSuggestionSummarizeNote,
    ];

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Icon(Icons.auto_awesome,
                size: 20, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text(l10n.aiAssistant),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Gemini API Key',
            icon: const Icon(Icons.key_outlined),
            onPressed: () => showGeminiApiKeyDialog(context),
          ),
          IconButton(
            tooltip: l10n.aiClearChatTooltip,
            icon: const Icon(Icons.refresh_outlined),
            onPressed: () {
              _streamSub?.cancel();
              setState(() {
                _messages.clear();
                _messages.add(
                  ChatMessage(
                    role: 'model',
                    text: l10n.aiClearedResetMessage,
                  ),
                );
                _isGenerating = false;
              });
            },
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Quick suggestions chips
            Container(
              height: 48,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: suggestions.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  return ActionChip(
                    label: Text(
                      suggestions[index],
                      style: const TextStyle(fontSize: 12),
                    ),
                    onPressed: () => _handleSend(suggestions[index]),
                  );
                },
              ),
            ),
            const Divider(height: 1),
            // Chat Messages List
            Expanded(
              child: ListView.builder(
                controller: _scrollController,
                padding: const EdgeInsets.all(16),
                itemCount: _messages.length,
                itemBuilder: (context, index) {
                  final message = _messages[index];
                  final isUser = message.role == 'user';
                  return Align(
                    alignment: isUser
                        ? (l10n.isRTL
                            ? Alignment.centerLeft
                            : Alignment.centerRight)
                        : (l10n.isRTL
                            ? Alignment.centerRight
                            : Alignment.centerLeft),
                    child: Container(
                      margin: const EdgeInsets.symmetric(vertical: 6),
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.of(context).size.width * 0.82,
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: isUser
                            ? theme.colorScheme.primary
                            : theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.only(
                          topLeft: const Radius.circular(16),
                          topRight: const Radius.circular(16),
                          bottomLeft: Radius.circular(isUser ? 16 : 4),
                          bottomRight: Radius.circular(isUser ? 4 : 16),
                        ),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: SelectableText(
                              message.text,
                              style: TextStyle(
                                fontSize: 14.5,
                                height: 1.45,
                                color: isUser
                                    ? theme.colorScheme.onPrimary
                                    : theme.colorScheme.onSurface,
                              ),
                            ),
                          ),
                          if (!isUser && message.text.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(left: 8),
                              child: IconButton(
                                tooltip: l10n.aiSpeakTooltip,
                                icon: Icon(
                                  _isSpeaking
                                      ? Icons.volume_up
                                      : Icons.volume_off,
                                  size: 18,
                                  color: _isSpeaking
                                      ? theme.colorScheme.primary
                                      : theme.colorScheme.outline,
                                ),
                                onPressed: _isSpeaking
                                    ? _stopSpeaking
                                    : () => _speakLastResponse(),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            if (_isGenerating) ...[
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Row(
                  children: [
                    const SizedBox.square(
                      dimension: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      l10n.aiThinkingMessage,
                      style: TextStyle(
                        fontSize: 12,
                        color: theme.colorScheme.outline,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            // Voice listening banner if active
            if (_isListening) ...[
              Container(
                padding:
                    const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                color: Colors.red.withAlpha(20),
                child: Row(
                  children: [
                    const Icon(Icons.mic, color: Colors.red, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        l10n.aiVoiceListening,
                        style: const TextStyle(
                          color: Colors.red,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () => setState(() => _isListening = false),
                    ),
                  ],
                ),
              ),
            ],
            // Input Row
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  IconButton(
                    tooltip: l10n.voiceMicPrompt,
                    icon: Icon(
                      _isListening ? Icons.mic : Icons.mic_none,
                      color:
                          _isListening ? Colors.red : theme.colorScheme.primary,
                    ),
                    onPressed: () => _toggleVoiceInput(),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _textController,
                      minLines: 1,
                      maxLines: 4,
                      decoration: InputDecoration(
                        hintText: l10n.aiInputHint,
                        hintStyle: const TextStyle(fontSize: 13),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 10,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                        ),
                      ),
                      onSubmitted: (_) => _handleSend(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _isGenerating ? null : () => _handleSend(),
                    icon: const Icon(Icons.send_rounded, size: 18),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
