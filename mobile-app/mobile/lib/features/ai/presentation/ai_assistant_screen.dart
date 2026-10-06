import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
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
  bool _isListening = false;

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

    _textController.clear();
    setState(() {
      _messages.add(ChatMessage(
        role: 'user',
        text: text,
        timestamp: DateTime.now(),
      ));
      _isGenerating = true;
      _isListening = false;
    });
    _scrollToBottom();

    final response = await AiService.instance.sendMessage(
      conversationHistory: _messages.sublist(0, _messages.length - 1),
      newMessage: text,
      isArabic: l10n.isArabic,
    );

    if (!mounted) return;

    setState(() {
      _messages.add(ChatMessage(
        role: 'model',
        text: response,
        timestamp: DateTime.now(),
      ));
      _isGenerating = false;
    });
    _scrollToBottom();
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
    ];

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Icon(Icons.auto_awesome, size: 20, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text(l10n.aiAssistant),
          ],
        ),
        actions: [
          IconButton(
            tooltip: l10n.aiClearChatTooltip,
            icon: const Icon(Icons.refresh_outlined),
            onPressed: () {
              setState(() {
                _messages.clear();
                _messages.add(
                  ChatMessage(
                    role: 'model',
                    text: l10n.aiClearedResetMessage,
                  ),
                );
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
                        ? (l10n.isArabic ? Alignment.centerLeft : Alignment.centerRight)
                        : (l10n.isArabic ? Alignment.centerRight : Alignment.centerLeft),
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
                  );
                },
              ),
            ),
            if (_isGenerating) ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
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
                padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                color: Colors.red.withAlpha(20),
                child: Row(
                  children: [
                    const Icon(Icons.mic, color: Colors.red, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        l10n.voiceMicPrompt,
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
                      color: _isListening
                          ? Colors.red
                          : theme.colorScheme.primary,
                    ),
                    onPressed: () {
                      setState(() => _isListening = !_isListening);
                    },
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
