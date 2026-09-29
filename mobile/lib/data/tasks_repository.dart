import 'api_client.dart';
import 'models.dart';

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

  Future<Task> createTask(String title) async {
    final response = await _api.post('tasks', body: {'title': title.trim()});
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
}

Map<String, dynamic> _taskMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  throw const ApiException(
    statusCode: 502,
    code: 'INVALID_API_RESPONSE',
    message: 'The server returned an invalid task.',
  );
}
