import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';

class DashboardOverview {
  const DashboardOverview({
    required this.date,
    required this.timezone,
    required this.tasksDueToday,
    required this.tasksDoneToday,
    required this.tasksOverdue,
    required this.habitsDueToday,
    required this.habitsCompletedToday,
    required this.eventsToday,
    required this.subscriptionsDueCount,
    required this.activeSubscriptions,
    required this.hasActiveTimer,
  });

  final String date;
  final String timezone;
  final int tasksDueToday;
  final int tasksDoneToday;
  final int tasksOverdue;
  final int habitsDueToday;
  final int habitsCompletedToday;
  final int eventsToday;
  final int subscriptionsDueCount;
  final int activeSubscriptions;
  final bool hasActiveTimer;

  factory DashboardOverview.fromJson(Map<String, dynamic> json) {
    final tasks = jsonObject(json['tasks'], 'tasks');
    final habits = jsonObject(json['habits'], 'habits');
    final subsDue = jsonObject(
      json['subscriptionsDueNext7Days'],
      'subscriptionsDueNext7Days',
    );
    return DashboardOverview(
      date: jsonString(json, 'date'),
      timezone: jsonString(json, 'timezone'),
      tasksDueToday: jsonOptionalInt(tasks, 'dueToday') ?? 0,
      tasksDoneToday: jsonOptionalInt(tasks, 'doneToday') ?? 0,
      tasksOverdue: jsonOptionalInt(tasks, 'overdue') ?? 0,
      habitsDueToday: jsonOptionalInt(habits, 'dueToday') ?? 0,
      habitsCompletedToday: jsonOptionalInt(habits, 'completedToday') ?? 0,
      eventsToday: jsonOptionalInt(json, 'eventsToday') ?? 0,
      subscriptionsDueCount: jsonOptionalInt(subsDue, 'count') ?? 0,
      activeSubscriptions: jsonOptionalInt(json, 'activeSubscriptions') ?? 0,
      hasActiveTimer: json['activeTimer'] is Map<String, dynamic>,
    );
  }
}

class DayPlanTaskItem {
  const DayPlanTaskItem({
    required this.id,
    required this.title,
    required this.status,
    required this.priority,
    this.dueDate,
    this.dueTime,
  });

  final String id;
  final String title;
  final String status;
  final int priority;
  final String? dueDate;
  final String? dueTime;

  bool get isDone => status == 'done';

  factory DayPlanTaskItem.fromJson(Map<String, dynamic> json) =>
      DayPlanTaskItem(
        id: jsonString(json, 'id'),
        title: jsonString(json, 'title'),
        status: jsonString(json, 'status'),
        priority: jsonOptionalInt(json, 'priority') ?? 0,
        dueDate: jsonOptionalString(json, 'dueDate'),
        dueTime: jsonOptionalString(json, 'dueTime'),
      );
}

class DayPlanHabitItem {
  const DayPlanHabitItem({
    required this.id,
    required this.name,
    required this.completedOn,
    required this.dueOn,
  });

  final String id;
  final String name;
  final bool completedOn;
  final bool dueOn;

  factory DayPlanHabitItem.fromJson(Map<String, dynamic> json) =>
      DayPlanHabitItem(
        id: jsonString(json, 'id'),
        name: jsonString(json, 'name'),
        completedOn: json['completedOn'] == true,
        dueOn: json['dueOn'] == true,
      );
}

class DayPlanEventItem {
  const DayPlanEventItem({
    required this.id,
    required this.title,
    required this.startAt,
    required this.endAt,
    required this.allDay,
    this.location,
  });

  final String id;
  final String title;
  final String startAt;
  final String endAt;
  final bool allDay;
  final String? location;

  factory DayPlanEventItem.fromJson(Map<String, dynamic> json) =>
      DayPlanEventItem(
        id: jsonString(json, 'id'),
        title: jsonString(json, 'title'),
        startAt: jsonString(json, 'startAt'),
        endAt: jsonString(json, 'endAt'),
        allDay: json['allDay'] == true,
        location: jsonOptionalString(json, 'location'),
      );
}

class DayPlanSubscriptionItem {
  const DayPlanSubscriptionItem({
    required this.id,
    required this.name,
    required this.amountMinor,
    required this.currencyExponent,
    required this.currency,
    required this.billingUnit,
    required this.nextBillingDate,
  });

  final String id;
  final String name;
  final String amountMinor;
  final int currencyExponent;
  final String currency;
  final String billingUnit;
  final String nextBillingDate;

  String get formattedAmount {
    final value = BigInt.parse(amountMinor);
    final sign = value.isNegative ? '-' : '';
    final digits = value.abs().toString().padLeft(currencyExponent + 1, '0');
    if (currencyExponent == 0) return '$sign$digits';
    final split = digits.length - currencyExponent;
    return '$sign${digits.substring(0, split)}.${digits.substring(split)}';
  }

  factory DayPlanSubscriptionItem.fromJson(Map<String, dynamic> json) =>
      DayPlanSubscriptionItem(
        id: jsonString(json, 'id'),
        name: jsonString(json, 'name'),
        amountMinor: jsonString(json, 'amountMinor'),
        currencyExponent: jsonOptionalInt(json, 'currencyExponent') ?? 2,
        currency: jsonString(json, 'currency'),
        billingUnit: jsonString(json, 'billingUnit'),
        nextBillingDate: jsonString(json, 'nextBillingDate'),
      );
}

class DayPlanView {
  const DayPlanView({
    required this.date,
    required this.timezone,
    required this.tasks,
    required this.habits,
    required this.events,
    required this.subscriptionsDue,
  });

  final String date;
  final String timezone;
  final List<DayPlanTaskItem> tasks;
  final List<DayPlanHabitItem> habits;
  final List<DayPlanEventItem> events;
  final List<DayPlanSubscriptionItem> subscriptionsDue;

  factory DayPlanView.fromJson(Map<String, dynamic> json) => DayPlanView(
        date: jsonString(json, 'date'),
        timezone: jsonString(json, 'timezone'),
        tasks: jsonObjectList(json['tasks'], 'tasks')
            .map(DayPlanTaskItem.fromJson)
            .toList(growable: false),
        habits: jsonObjectList(json['habits'], 'habits')
            .map(DayPlanHabitItem.fromJson)
            .toList(growable: false),
        events: jsonObjectList(json['events'], 'events')
            .map(DayPlanEventItem.fromJson)
            .toList(growable: false),
        subscriptionsDue: jsonObjectList(
          json['subscriptionsDue'],
          'subscriptionsDue',
        ).map(DayPlanSubscriptionItem.fromJson).toList(growable: false),
      );
}

class SearchNoteItem {
  const SearchNoteItem({
    required this.id,
    required this.title,
    this.excerpt,
    required this.isPinned,
  });

  final String id;
  final String title;
  final String? excerpt;
  final bool isPinned;

  factory SearchNoteItem.fromJson(Map<String, dynamic> json) => SearchNoteItem(
        id: jsonString(json, 'id'),
        title: jsonOptionalString(json, 'title') ?? '',
        excerpt: jsonOptionalString(json, 'excerpt'),
        isPinned: json['isPinned'] == true,
      );
}

class SearchProjectItem {
  const SearchProjectItem({
    required this.id,
    required this.name,
    this.description,
  });

  final String id;
  final String name;
  final String? description;

  factory SearchProjectItem.fromJson(Map<String, dynamic> json) =>
      SearchProjectItem(
        id: jsonString(json, 'id'),
        name: jsonString(json, 'name'),
        description: jsonOptionalString(json, 'description'),
      );
}

class GlobalSearchResult {
  const GlobalSearchResult({
    required this.query,
    required this.tasks,
    required this.notes,
    required this.habits,
    required this.projects,
    required this.events,
  });

  final String query;
  final List<DayPlanTaskItem> tasks;
  final List<SearchNoteItem> notes;
  final List<DayPlanHabitItem> habits;
  final List<SearchProjectItem> projects;
  final List<DayPlanEventItem> events;

  factory GlobalSearchResult.fromJson(Map<String, dynamic> json) =>
      GlobalSearchResult(
        query: jsonOptionalString(json, 'query') ?? '',
        tasks: jsonObjectList(json['tasks'], 'tasks')
            .map(DayPlanTaskItem.fromJson)
            .toList(growable: false),
        notes: jsonObjectList(json['notes'], 'notes')
            .map(SearchNoteItem.fromJson)
            .toList(growable: false),
        habits: jsonObjectList(json['habits'], 'habits')
            .map(DayPlanHabitItem.fromJson)
            .toList(growable: false),
        projects: jsonObjectList(json['projects'], 'projects')
            .map(SearchProjectItem.fromJson)
            .toList(growable: false),
        events: jsonObjectList(json['events'], 'events')
            .map(DayPlanEventItem.fromJson)
            .toList(growable: false),
      );
}

class DailyPlanRepository {
  const DailyPlanRepository(this._api);

  final ApiClient _api;

  Future<DashboardOverview> getDashboardOverview() async {
    final response = jsonObject(
      await _api.get('dashboard'),
      'dashboard',
    );
    return DashboardOverview.fromJson(
      jsonObject(response['overview'], 'overview'),
    );
  }

  Future<DayPlanView> getDayPlan({String? date}) async {
    final path = (date == null || date.isEmpty) ? 'day/today' : 'day/$date';
    final response = jsonObject(await _api.get(path), 'day');
    return DayPlanView.fromJson(jsonObject(response['day'], 'day'));
  }

  Future<GlobalSearchResult> searchGlobal(
    String query, {
    int limit = 10,
  }) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      return const GlobalSearchResult(
        query: '',
        tasks: <DayPlanTaskItem>[],
        notes: <SearchNoteItem>[],
        habits: <DayPlanHabitItem>[],
        projects: <SearchProjectItem>[],
        events: <DayPlanEventItem>[],
      );
    }
    final response = jsonObject(
      await _api.get(
        'search',
        query: <String, String>{'q': trimmed, 'limit': '$limit'},
      ),
      'search',
    );
    return GlobalSearchResult.fromJson(response);
  }
}

final dailyPlanRepositoryProvider = Provider<DailyPlanRepository>(
  (ref) => DailyPlanRepository(ref.watch(apiClientProvider)),
);
