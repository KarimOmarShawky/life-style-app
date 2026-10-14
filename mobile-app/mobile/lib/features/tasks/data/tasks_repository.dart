import 'package:lifestyle_mobile/data/paged_list.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';

class TasksRepository {
  const TasksRepository(this._api);

  final ApiClient _api;

  Future<List<Task>> listAllTasks() async =>
      (await fetchAllPages(_api, 'tasks', maxPages: 50, requireComplete: true))
          .map(Task.fromJson)
          .toList(growable: false);

  /// One bulk operation at the controller/repository boundary. The existing API
  /// is online-first and has no transactional bulk endpoint: keep per-task
  /// optimistic versions and explicitly report partial failure, never fake it.
  Future<BulkTaskDateResult> bulkUpdateDueDates(
      List<TaskDateChange> changes) async {
    final applied = <AppliedTaskDateChange>[];
    final failedIds = <String>[];
    for (final change in changes) {
      try {
        final response = await _api.patch('tasks/${change.task.id}', body: {
          'version': change.task.version,
          'dueDate': change.dueDate,
          'dueTime': change.dueDate == null ? null : change.dueTime,
        });
        final json = _taskMap(response);
        applied.add(AppliedTaskDateChange(
            change.task, Task.fromJson(_taskMap(json['task']))));
      } catch (_) {
        failedIds.add(change.task.id);
      }
    }
    return BulkTaskDateResult(applied, failedIds);
  }

  Future<List<Task>> listTasks({String? cursor}) async {
    final response = await _api.get(
      'tasks',
      query: {'limit': '50', if (cursor != null) 'cursor': cursor},
    );
    if (response is! Map<String, dynamic> ||
        response['data'] is! List<dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid task list.',
      );
    }
    return (response['data'] as List<dynamic>)
        .map((item) => Task.fromJson(_taskMap(item)))
        .toList(growable: false);
  }

  Future<Task> createTask({
    required String title,
    String? description,
    String? dueDate,
    String? dueTime,
    String? priority,
  }) async {
    final body = <String, dynamic>{
      'title': title.trim(),
      if (description != null && description.trim().isNotEmpty)
        'description': description.trim(),
      if (dueDate != null && dueDate.isNotEmpty) 'dueDate': dueDate,
      if (dueTime != null && dueTime.isNotEmpty) 'dueTime': dueTime,
      if (priority != null) 'priority': priority,
    };
    final response = await _api.post('tasks', body: body);
    if (response is! Map<String, dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid task.',
      );
    }
    return Task.fromJson(_taskMap(response['task']));
  }

  Future<Task> setDone(Task task, bool done) async {
    final response = await _api.patch(
      'tasks/${task.id}',
      body: {'status': done ? 'done' : 'todo', 'version': task.version},
    );
    if (response is! Map<String, dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid task.',
      );
    }
    return Task.fromJson(_taskMap(response['task']));
  }

  Future<void> deleteTask(String taskId) async {
    await _api.delete('tasks/$taskId');
  }

  Future<void> deleteMultipleTasks(List<String> taskIds) async {
    for (final id in taskIds) {
      await deleteTask(id);
    }
  }

  Map<String, dynamic> _taskMap(dynamic raw) {
    if (raw is Map<String, dynamic>) return raw;
    throw const ApiException(
      statusCode: 502,
      code: 'INVALID_API_RESPONSE',
      message: 'The server returned an invalid task payload.',
    );
  }
}

class TaskDateChange {
  const TaskDateChange(this.task, this.dueDate, this.dueTime);
  final Task task;
  final String? dueDate;
  final String? dueTime;
}

class AppliedTaskDateChange {
  const AppliedTaskDateChange(this.before, this.after);
  final Task before;
  final Task after;
}

class BulkTaskDateResult {
  const BulkTaskDateResult(this.applied, this.failedIds);
  final List<AppliedTaskDateChange> applied;
  final List<String> failedIds;
  List<TaskDateChange> get undoChanges => [
        for (final change in applied)
          TaskDateChange(
              change.after, change.before.dueDate, change.before.dueTime)
      ];
}
