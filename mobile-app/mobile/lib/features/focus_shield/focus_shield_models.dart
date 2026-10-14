import 'dart:math' as math;

const estimatedMinutesSavedPerAttempt = 12;
const defaultBlockedPackages = <String>{
  'com.instagram.android',
  'com.zhiliaoapp.musically',
  'com.ss.android.ugc.trill',
  'com.facebook.katana',
  'com.google.android.youtube',
  'com.twitter.android',
  'com.snapchat.android',
  'com.reddit.frontpage',
  'com.whatsapp',
  'org.telegram.messenger',
  'com.facebook.orca',
  'com.whatsapp.w4b',
  'com.facebook.lite',
  'com.instagram.lite',
  'com.facebook.mlite',
};

int calculateBrainClarityScore(int attempts) =>
    math.max(0, 100 - 10 * math.max(0, attempts));

String localDateKey(DateTime date) {
  final local = date.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
}

enum XpType { task, habit, focus, morning, shutdown }

enum FocusBadge {
  firstShield('First Shield'),
  ironWill('Iron Will'),
  inboxZeroDistraction('Inbox Zero Distraction'),
  deepWorkStreak('Deep Work Streak'),
  taskCrusher('Task Crusher');

  const FocusBadge(this.title);
  final String title;
}

class XpEvent {
  const XpEvent(
      {required this.type,
      required this.entityId,
      required this.dateKey,
      required this.xp});
  final XpType type;
  final String entityId;
  final String dateKey;
  final int xp;

  // Tasks and focus sessions have lifetime identity; only rituals/check-ins
  // are daily. Undo/re-complete on another day cannot re-award a task.
  String get key => switch (type) {
        XpType.task || XpType.focus => '${type.name}:$entityId',
        _ => '${type.name}:$entityId:$dateKey',
      };
  Map<String, Object> toJson() => {
        'type': type.name,
        'entityId': entityId,
        'dateKey': dateKey,
        'xp': xp,
      };
  factory XpEvent.fromJson(Map<String, dynamic> json) => XpEvent(
        type: XpType.values.byName(json['type'] as String),
        entityId: json['entityId'] as String,
        dateKey: json['dateKey'] as String,
        xp: json['xp'] as int,
      );
}

/// Immutable ledger. Totals are derived, never maintained as a second counter.
class XpLedger {
  XpLedger([Iterable<XpEvent> events = const []])
      : events =
            Map.unmodifiable({for (final event in events) event.key: event});
  final Map<String, XpEvent> events;
  int get totalXp => events.values.fold(0, (sum, event) => sum + event.xp);
  int get level => (totalXp ~/ 200) + 1;
  String get rank => switch (level) {
        >= 10 => 'Monk Mode Legend',
        >= 8 => 'Dopamine Master',
        >= 5 => 'Deep Work Practitioner',
        >= 3 => 'Focus Apprentice',
        _ => 'Digital Wanderer',
      };
  XpLedger award(XpEvent event) => events.containsKey(event.key)
      ? this
      : XpLedger([...events.values, event]);
}

int xpFor(XpType type,
        {bool shieldCompleted = false, int manualBypasses = 0}) =>
    switch (type) {
      XpType.task => 25,
      XpType.habit => 20,
      XpType.focus => 40 + (shieldCompleted && manualBypasses == 0 ? 15 : 0),
      XpType.morning || XpType.shutdown => 30,
    };

class FocusSessionRecord {
  const FocusSessionRecord(
      {required this.id,
      required this.endedAt,
      required this.durationSeconds,
      required this.attempts,
      required this.shieldCompleted,
      required this.manualBypasses,
      required this.completed,
      required this.clarityScore});
  final String id;
  final DateTime endedAt;
  final int durationSeconds;
  final int attempts;
  final bool shieldCompleted;
  final int manualBypasses;
  final bool completed;
  final int clarityScore;
  Map<String, Object> toJson() => {
        'id': id,
        'endedAt': endedAt.toIso8601String(),
        'durationSeconds': durationSeconds,
        'attempts': attempts,
        'shieldCompleted': shieldCompleted,
        'manualBypasses': manualBypasses,
        'completed': completed,
        'clarityScore': clarityScore,
      };
  factory FocusSessionRecord.fromJson(Map<String, dynamic> json) =>
      FocusSessionRecord(
          id: json['id'] as String,
          endedAt: DateTime.parse(json['endedAt'] as String),
          durationSeconds: json['durationSeconds'] as int,
          attempts: json['attempts'] as int,
          shieldCompleted: json['shieldCompleted'] as bool,
          manualBypasses: json['manualBypasses'] as int,
          completed: json['completed'] as bool,
          clarityScore: json['clarityScore'] as int);
}

Set<FocusBadge> earnedBadges(
    XpLedger ledger, Iterable<FocusSessionRecord> history,
    {bool repliedInline = false}) {
  final completed = history.where((session) => session.completed).toList();
  final shield = completed.where((session) => session.shieldCompleted);
  return {
    if (shield.isNotEmpty) FocusBadge.firstShield,
    if (shield.any((s) => s.durationSeconds >= 25 * 60 && s.attempts == 0))
      FocusBadge.ironWill,
    if (repliedInline) FocusBadge.inboxZeroDistraction,
    if (completed.length >= 3) FocusBadge.deepWorkStreak,
    if (ledger.events.values.where((e) => e.type == XpType.task).length >= 10)
      FocusBadge.taskCrusher,
  };
}

class ShieldState {
  const ShieldState(
      {this.active = false,
      this.sessionId = '',
      this.taskTitle = '',
      this.endTimestampMs = 0,
      this.blockedAttemptsCount = 0,
      this.manualBypassesCount = 0,
      this.endReason = ''});
  final bool active;
  final String sessionId;
  final String taskTitle;
  final int endTimestampMs;
  final int blockedAttemptsCount;
  final int manualBypassesCount;
  final String endReason;
  factory ShieldState.fromJson(Map<String, dynamic> json) => ShieldState(
        active: json['active'] as bool? ?? false,
        sessionId: json['sessionId'] as String? ?? '',
        taskTitle: json['taskTitle'] as String? ?? '',
        endTimestampMs: json['endTimestampMs'] as int? ?? 0,
        blockedAttemptsCount: json['blockedAttemptsCount'] as int? ?? 0,
        manualBypassesCount: json['manualBypassesCount'] as int? ?? 0,
        endReason: json['endReason'] as String? ?? '',
      );
}

/// These objects and drafts must never be included in persisted state.
class FocusInboxMessage {
  const FocusInboxMessage(
      {required this.key,
      required this.packageName,
      required this.sender,
      required this.text});
  final String key;
  final String packageName;
  final String sender;
  final String text;
}

enum ReplyResult { sent, stale, noReplyAction, failed }
