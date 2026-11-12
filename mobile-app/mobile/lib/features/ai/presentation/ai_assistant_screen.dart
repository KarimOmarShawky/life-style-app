import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_age_confirmation.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_reports_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart'
    show aiMaxTurnChars;
import 'package:lifestyle_mobile/features/ai/data/chat_history_store.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_markdown.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_report_sheet.dart';
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
  int _streamGeneration = 0;

  StreamSubscription<String>? _streamSub;

  final _historyStore = ChatHistoryStore();
  bool _historyLoaded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_historyLoaded) return;
    _historyLoaded = true;
    _restoreHistory();
  }

  /// Restores the on-device conversation; the greeting is only seeded
  /// when there is nothing saved yet.
  Future<void> _restoreHistory() async {
    final saved = await _historyStore.load();
    if (!mounted) return;
    setState(() {
      if (saved.isNotEmpty) {
        _messages
          ..clear()
          ..addAll(saved);
      } else if (_messages.isEmpty) {
        _messages.add(
          ChatMessage(
            role: 'model',
            text: AppLocalizations.of(context).aiWelcomeMessage,
          ),
        );
      }
    });
    _scrollToBottom();
  }

  void _persistHistory() {
    unawaited(_historyStore.save(List<ChatMessage>.of(_messages)));
  }

  @override
  void dispose() {
    _streamGeneration++;
    _streamSub?.cancel();
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
    final l10n = AppLocalizations.of(context);

    // Gemini API terms: AI features are for people aged 18 or older (D9).
    if (!await ensureAiAgeConfirmed(context, ref)) return;
    if (!mounted) return;

    if (!_consentedToEgress) {
      final approved = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l10n.aiEgressTitle),
          content: Text(l10n.aiEgressDescription),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(l10n.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(l10n.aiEgressAgree),
            ),
          ],
        ),
      );
      if (approved != true || !mounted) return;
      _consentedToEgress = true;
    }
    if (!mounted) return;
    final history = List<ChatMessage>.of(_messages);

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
    _persistHistory();
    _scrollToBottom();

    final buffer = StringBuffer();
    final placeholderIndex = _messages.length - 1;
    final generation = ++_streamGeneration;
    _streamSub?.cancel();

    void showFailure() {
      if (!mounted || generation != _streamGeneration) return;
      setState(() {
        if (buffer.isEmpty && placeholderIndex < _messages.length) {
          _messages.removeAt(placeholderIndex);
        }
        _isGenerating = false;
      });
      _persistHistory();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.aiErrorMessage)),
      );
      _scrollToBottom();
    }

    _streamSub = AiService.instance
        .streamMessage(
          conversationHistory: history,
          newMessage: text,
          languageName: l10n.promptLanguageName,
        )
        .listen(
          (chunk) {
            if (!mounted || generation != _streamGeneration) return;
            buffer.write(chunk);
            if (placeholderIndex < _messages.length) {
              setState(() {
                _messages[placeholderIndex] = ChatMessage(
                  role: 'model',
                  text: buffer.toString(),
                  timestamp: placeholder.timestamp,
                );
              });
              _scrollToBottom();
            }
          },
          onError: (Object _) => showFailure(),
          onDone: () {
            if (!mounted || generation != _streamGeneration) return;
            if (buffer.isEmpty) {
              showFailure();
              return;
            }
            setState(() => _isGenerating = false);
            _persistHistory();
            _scrollToBottom();
          },
          cancelOnError: true,
        );
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
            tooltip: l10n.aiClearChatTooltip,
            icon: const Icon(Icons.refresh_outlined),
            onPressed: () {
              _streamGeneration++;
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
              unawaited(_historyStore.clear());
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
                  // Replies from the AI (not the built-in greeting) can be
                  // reported once they finished streaming.
                  final reportable = !isUser &&
                      message.timestamp != null &&
                      message.text.trim().isNotEmpty &&
                      !(_isGenerating && index == _messages.length - 1);
                  final bubble = Container(
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
                          child: isUser
                              ? SelectableText(
                                  message.text,
                                  style: TextStyle(
                                    fontSize: 14.5,
                                    height: 1.45,
                                    color: theme.colorScheme.onPrimary,
                                  ),
                                )
                              : AiMarkdownText(
                                  message.text,
                                  style: TextStyle(
                                    fontSize: 14.5,
                                    height: 1.45,
                                    color: theme.colorScheme.onSurface,
                                  ),
                                ),
                        ),
                      ],
                    ),
                  );
                  return Align(
                    alignment: isUser
                        ? (l10n.isRTL
                            ? Alignment.centerLeft
                            : Alignment.centerRight)
                        : (l10n.isRTL
                            ? Alignment.centerRight
                            : Alignment.centerLeft),
                    child: reportable
                        ? Row(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Flexible(child: bubble),
                              AiReportButton(
                                surface: AiReportSurface.assistant,
                                replyText: message.text,
                              ),
                            ],
                          )
                        : bubble,
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
            // Input Row
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _textController,
                      minLines: 1,
                      maxLines: 4,
                      inputFormatters: [
                        LengthLimitingTextInputFormatter(aiMaxTurnChars),
                      ],
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
