import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';

class TasksRepository {
  const TasksRepository(this._api);

  final ApiClient _api;

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
