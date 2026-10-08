import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';
import 'package:lifestyle_mobile/data/paged_list.dart';
import 'package:lifestyle_mobile/features/recurring/data/recurring_task_model.dart';

class RecurringTasksRepository {
  const RecurringTasksRepository(this._api);

  final ApiClient _api;

  Future<List<RecurringTask>> listRecurringTasks() async {
    final items = await fetchAllPages(_api, 'recurring-tasks');
    return items.map(RecurringTask.fromJson).toList(growable: false);
  }

  Future<RecurringTask> createRecurringTask(Map<String, Object?> fields) async {
    final response = jsonObject(
      await _api.post('recurring-tasks', body: fields),
      'recurring task',
    );
    return RecurringTask.fromJson(
      jsonObject(response['recurringTask'], 'recurring task'),
    );
  }

  /// [changes] may include `version` for optimistic concurrency.
  Future<RecurringTask> updateRecurringTask(
    String id,
    Map<String, Object?> changes,
  ) async {
    final response = jsonObject(
      await _api.patch('recurring-tasks/$id', body: changes),
      'recurring task',
    );
    return RecurringTask.fromJson(
      jsonObject(response['recurringTask'], 'recurring task'),
    );
  }

  Future<void> deleteRecurringTask(String id) async {
    await _api.delete('recurring-tasks/$id');
  }
}
