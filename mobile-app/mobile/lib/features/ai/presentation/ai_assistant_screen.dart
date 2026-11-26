import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_age_confirmation.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_context_preference.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_memory_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_reports_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_settings_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart'
    show aiMaxTurnChars;
import 'package:lifestyle_mobile/features/ai/data/chat_history_store.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_markdown.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_memory_editor.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_report_sheet.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
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

  /// The account's AI settings from the server (AI-2); null while loading
  /// or when the server could not be asked.
  AiSettingsSnapshot? _settings;
  String? _userId;

  /// The user's "Use my app data" switch (AI-2c), kept per account.
  bool _useAppData = false;

  StreamSubscription<String>? _streamSub;

  final _historyStore = ChatHistoryStore();
  bool _historyLoaded = false;
  String? _historyAccount;
  int? _historySession;
  Future<void> _historyTail = Future<void>.value();

  bool _sessionCurrent(String account, int generation) => mounted &&
      _historyAccount == account && _historySession == generation &&
      ref.read(authProvider.notifier).sessionIsCurrent(account, generation);

  void _invalidateHistory() {
    _streamGeneration++;
    _streamSub?.cancel();
    _historyAccount = null;
    _historySession = null;
    _historyLoaded = false;
    _messages.clear();
    _textController.clear();
    _isGenerating = false;
    _consentedToEgress = false;
    _settings = null;
    _userId = null;
    _useAppData = false;
  }

  void _scheduleAccountSync() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _syncAccount();
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  void _syncAccount() {
    final auth = ref.read(authProvider.notifier);
    final account = auth.activeAccount;
    final generation = auth.sessionGeneration;
    if (account == null) return;
    if (_historyAccount == account && _historySession == generation) return;
    setState(() {
      _invalidateHistory();
      _historyAccount = account;
      _historySession = generation;
    });
    unawaited(_restoreHistory(account, generation));
    unawaited(_loadAiPreferences(account, generation));
  }

  @override
  void initState() {
    super.initState();
    ref.listenManual<int>(authTransitionSignalProvider, (_, __) {
      if (!mounted) return;
      setState(_invalidateHistory);
      _scheduleAccountSync();
    });
    ref.listenManual(authProvider, (_, __) => _scheduleAccountSync());
    _scheduleAccountSync();
  }

  Future<void> _loadAiPreferences(String account, int generation) async {
    final useAppData = await AiContextPreferenceStore.isEnabled(account);
    if (!_sessionCurrent(account, generation)) return;
    setState(() {
      _userId = account;
      _useAppData = useAppData;
    });
    await _fetchSettings();
  }

  Future<AiSettingsSnapshot?> _fetchSettings() async {
    final account = _historyAccount;
    final generation = _historySession;
    if (account == null || generation == null ||
        !_sessionCurrent(account, generation)) return null;
    try {
      final settings = await ref.read(aiSettingsClientProvider).fetch();
      if (!_sessionCurrent(account, generation)) return null;
      setState(() => _settings = settings);
      return settings;
    } on Object {
      return null;
    }
  }

  /// The durable AI consent (Hybrid AI AI-2): asked only when the account
  /// has not agreed to the current consent text, then stored on the server.
  /// When the server cannot store it (older server, no connection, owner
  /// SQL not applied) the answer counts for this screen only, as before.
  Future<bool> _ensureEgressConsent(AppLocalizations l10n,
      String account, int generation) async {
    bool valid() => _sessionCurrent(account, generation);
    if (!valid()) return false;
    if (_consentedToEgress) return true;
    final settings = _settings ?? await _fetchSettings();
    if (!valid()) return false;
    if (settings != null && settings.hasCurrentConsent) {
      _consentedToEgress = true;
      return true;
    }
    final approved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        // Scrolls as a whole, so nothing is cut off at large text (G7).
        scrollable: true,
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
    if (approved != true || !valid()) return false;
    _consentedToEgress = true;
    if (settings != null && settings.canRecordConsent) {
      try {
        final client = ref.read(aiSettingsClientProvider);
        final stored = client is ApiAiSettingsClient
            ? await client.grantConsentForSession(valid)
            : throw StateError('Session-bound settings client required');
        if (valid()) setState(() => _settings = stored);
      } on Object {
        // Kept for this screen only; the next visit asks again.
      }
    }
    return valid();
  }

  /// The stored consent was withdrawn elsewhere (Profile): forget it, so the
  /// next message asks again.
  void _forgetConsent() {
    _consentedToEgress = false;
    setState(() => _settings = null);
    unawaited(_fetchSettings());
  }

  /// "Save to memory" on one of the user's own messages (AI-3): the note
  /// editor opens with the message text, and the note is saved on Save.
  Future<void> _saveToMemory(String text) async {
    final account = _historyAccount;
    final generation = _historySession;
    if (account == null || generation == null ||
        !_sessionCurrent(account, generation)) return;
    bool valid() => _sessionCurrent(account, generation);
    final draft = await showAiMemoryEditor(context, content: text);
    if (draft == null || !valid()) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final client = ref.read(aiMemoryClientProvider);
      if (client is ApiAiMemoryClient) {
        await client.createForSession(
            kind: draft.kind, content: draft.content, sessionIsCurrent: valid);
      } else {
        throw StateError('Session-bound memory client required');
      }
      if (!valid()) return;
      messenger.showSnackBar(SnackBar(content: Text(l10n.aiMemorySaved)));
    } on Object catch (error) {
      if (!valid()) return;
      messenger.showSnackBar(
        SnackBar(content: Text(aiMemoryErrorMessage(l10n, error))),
      );
      // Memory was turned off elsewhere: hide the action.
      if (error is ApiException && error.code == 'AI_MEMORY_DISABLED') {
        unawaited(_fetchSettings());
      }
    }
  }

  /// Turning the switch on explains what is sent first (AI-2c); turning it
  /// off needs no confirmation.
  Future<void> _setUseAppData(bool enable) async {
    final account = _historyAccount;
    final generation = _historySession;
    if (account == null || generation == null ||
        !_sessionCurrent(account, generation)) return;
    if (enable) {
      final l10n = AppLocalizations.of(context);
      final agreed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          scrollable: true,
          title: Text(l10n.aiContextDialogTitle),
          content: Text(l10n.aiContextDialogBody),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(l10n.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(l10n.aiContextDialogConfirm),
            ),
          ],
        ),
      );
      if (agreed != true || !_sessionCurrent(account, generation)) return;
    }
    if (!_sessionCurrent(account, generation)) return;
    setState(() => _useAppData = enable);
    final userId = _userId;
    if (userId != null) {
      await AiContextPreferenceStore.setEnabled(userId, enable);
    }
  }

  String _failureMessage(AppLocalizations l10n, String? code) {
    switch (code) {
      case 'consent_required':
        return l10n.aiConsentRequiredMessage;
      case 'scope_unavailable':
        return l10n.aiContextUnavailableMessage;
      case 'unsupported':
        return l10n.aiUnsupportedMessage;
      default:
        return l10n.aiErrorMessage;
    }
  }

  Future<void> _restoreHistory(String account, int generation) async {
    await _historyTail;
    final saved = await _historyStore.load(account);
    if (!_sessionCurrent(account, generation)) return;
    setState(() {
      _messages.clear();
      if (saved.isNotEmpty) {
        _messages.addAll(saved);
      } else {
        _messages.add(ChatMessage(
          role: 'model', text: AppLocalizations.of(context).aiWelcomeMessage));
      }
      _historyLoaded = true;
    });
    _scrollToBottom();
  }

  void _persistHistory() {
    final account = _historyAccount;
    final generation = _historySession;
    if (account == null || generation == null ||
        !_sessionCurrent(account, generation)) return;
    final snapshot = List<ChatMessage>.of(_messages);
    _historyTail = _historyTail.then((_) => _historyStore.save(account, snapshot));
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
    final account = _historyAccount;
    final authGeneration = _historySession;
    if (text.isEmpty || _isGenerating || !_historyLoaded || account == null ||
        authGeneration == null || !_sessionCurrent(account, authGeneration)) return;
    bool valid() => _sessionCurrent(account, authGeneration);
    final l10n = AppLocalizations.of(context);
    final clientLocale = Localizations.localeOf(context).toLanguageTag();

    // Gemini API terms: AI features are for people aged 18 or older (D9).
    if (!await ensureAiAgeConfirmed(context, ref, sessionIsCurrent: valid)) return;
    if (!valid()) return;

    if (!await _ensureEgressConsent(l10n, account, authGeneration)) return;
    if (!valid()) return;
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

    void showFailure([Object? error]) {
      if (!valid() || generation != _streamGeneration) return;
      final code = error is AiStreamingException ? error.code : null;
      final consentLost = code == 'consent_required';
      setState(() {
        // The text of a failed reply is never kept, not even in part.
        if (placeholderIndex < _messages.length) {
          _messages.removeAt(placeholderIndex);
        }
        _isGenerating = false;
        if (consentLost) {
          // The server has no current consent: ask again on the next send.
          _consentedToEgress = false;
          _settings = null;
        }
      });
      if (consentLost) unawaited(_fetchSettings());
      _persistHistory();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_failureMessage(l10n, code))),
      );
      _scrollToBottom();
    }

    final contextScopes = _useAppData && (_settings?.canUseAppData ?? false)
        ? aiContextScopes
        : const <String>[];
    _streamSub = AiService.instance
        .streamAssistantTurn(
          conversationHistory: history,
          newMessage: text,
          clientLocale: clientLocale,
          languageName: l10n.promptLanguageName,
          contextScopes: contextScopes,
          sessionIsCurrent: valid,
        )
        .listen(
          (chunk) {
            if (!valid() || generation != _streamGeneration) return;
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
          onError: (Object error) => showFailure(error),
          onDone: () {
            if (!valid() || generation != _streamGeneration) return;
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
    ref.listen<int>(aiConsentRevisionProvider, (_, __) => _forgetConsent());
    ref.listen<int>(
      aiSettingsRevisionProvider,
      (_, __) => unawaited(_fetchSettings()),
    );
    final memoryOn = _settings?.memoryOn ?? false;

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
            Flexible(
              child: Text(l10n.aiAssistant, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: l10n.aiClearChatTooltip,
            icon: const Icon(Icons.refresh_outlined),
            onPressed: () {
              final account = _historyAccount;
              final generation = _historySession;
              if (account == null || generation == null ||
                  !_sessionCurrent(account, generation) || !_historyLoaded) return;
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
              _historyTail = _historyTail.then((_) => _historyStore.clear(account));
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
                  // The user's own messages can be saved as a note for
                  // the assistant while memory is on (AI-3).
                  final savable =
                      isUser && memoryOn && message.text.trim().isNotEmpty;
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
                        : savable
                            ? Row(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  IconButton(
                                    tooltip: l10n.aiSaveToMemoryTooltip,
                                    icon: const Icon(
                                      Icons.bookmark_add_outlined,
                                      size: 20,
                                    ),
                                    onPressed: () => unawaited(
                                      _saveToMemory(message.text),
                                    ),
                                  ),
                                  Flexible(child: bubble),
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
            // "Use my app data" (AI-2c): only when the consent for it is
            // stored on the server or this app can ask for it.
            if (_settings?.canUseAppData ?? false)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: FilterChip(
                    key: const ValueKey('ai-context-chip'),
                    avatar: const Icon(Icons.event_note_outlined, size: 18),
                    label: Text(l10n.aiContextChip),
                    selected: _useAppData,
                    onSelected: (value) => unawaited(_setUseAppData(value)),
                  ),
                ),
              ),
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
                    tooltip: l10n.aiSendTooltip,
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
