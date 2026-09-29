import 'api_client.dart';
import 'models.dart';

class HabitsRepository {
  const HabitsRepository(this._api);

  final ApiClient _api;

  Future<List<Habit>> listHabits() async {
    final response = await _api.get('habits');
    if (response is! Map<String, dynamic> ||
        response['habits'] is! List<dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid habits list.',
      );
    }
    return (response['habits'] as List<dynamic>)
        .map((item) => Habit.fromJson(item as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<void> checkinHabit(
    String habitId,
    String date, {
    String status = 'done',
  }) async {
    await _api.post(
      'habits/$habitId/checkin',
      body: {'date': date, 'status': status},
    );
  }

  Future<Habit> createHabit({
    required String name,
    String? description,
    required String startDate,
  }) async {
    final response = await _api.post(
      'habits',
      body: {
        'name': name.trim(),
        if (description != null) 'description': description.trim(),
        'startDate': startDate,
        'recurrence': {'freq': 'daily', 'interval': 1},
      },
    );
    if (response is! Map<String, dynamic> ||
        response['habit'] is! Map<String, dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid habit.',
      );
    }
    return Habit.fromJson(response['habit'] as Map<String, dynamic>);
  }
}
