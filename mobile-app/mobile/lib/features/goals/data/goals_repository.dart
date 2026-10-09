import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';
import 'package:lifestyle_mobile/features/goals/data/goal_model.dart';

class GoalsRepository {
  const GoalsRepository(this._api);

  final ApiClient _api;

  Future<List<Goal>> listGoals() async {
    final response = jsonObject(await _api.get('goals'), 'goals list');
    return jsonObjectList(
      response['goals'],
      'goals list',
    ).map(Goal.fromJson).toList(growable: false);
  }

  Future<Goal> getGoal(String id) async {
    final response = jsonObject(await _api.get('goals/$id'), 'goal');
    return Goal.fromJson(jsonObject(response['goal'], 'goal'));
  }

  Future<Goal> createGoal(Map<String, Object?> fields) async {
    final response = jsonObject(
      await _api.post('goals', body: fields),
      'goal',
    );
    return Goal.fromJson(jsonObject(response['goal'], 'goal'));
  }

  /// [changes] may include `version` for optimistic concurrency.
  Future<Goal> updateGoal(String id, Map<String, Object?> changes) async {
    final response = jsonObject(
      await _api.patch('goals/$id', body: changes),
      'goal',
    );
    return Goal.fromJson(jsonObject(response['goal'], 'goal'));
  }

  Future<void> deleteGoal(String id) async {
    await _api.delete('goals/$id');
  }

  Future<GoalMilestone> addMilestone(
    String goalId,
    Map<String, Object?> fields,
  ) async {
    final response = jsonObject(
      await _api.post('goals/$goalId/milestones', body: fields),
      'milestone',
    );
    return GoalMilestone.fromJson(jsonObject(response['milestone'], 'milestone'));
  }

  Future<GoalMilestone> updateMilestone(
    String goalId,
    String milestoneId,
    Map<String, Object?> changes,
  ) async {
    final response = jsonObject(
      await _api.patch('goals/$goalId/milestones/$milestoneId', body: changes),
      'milestone',
    );
    return GoalMilestone.fromJson(jsonObject(response['milestone'], 'milestone'));
  }

  Future<void> deleteMilestone(String goalId, String milestoneId) async {
    await _api.delete('goals/$goalId/milestones/$milestoneId');
  }
}
