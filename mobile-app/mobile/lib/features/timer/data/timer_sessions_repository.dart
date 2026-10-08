import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';
import 'package:lifestyle_mobile/data/paged_list.dart';
import 'package:lifestyle_mobile/features/timer/data/timer_session_model.dart';

class TimerSessionsRepository {
  const TimerSessionsRepository(this._api);

  final ApiClient _api;

  /// Starts a stopwatch session on a task. The backend allows one running session per user.
  Future<TimerSession> startSession(String taskId) async {
    final response = jsonObject(
      await _api.post(
        'timer-sessions',
        body: {'taskId': taskId, 'mode': 'stopwatch'},
      ),
      'timer session',
    );
    return TimerSession.fromJson(
      jsonObject(response['timerSession'], 'timer session'),
    );
  }

  Future<TimerSession> stopSession(String sessionId) async {
    final response = jsonObject(
      await _api.post('timer-sessions/$sessionId/stop'),
      'timer session',
    );
    return TimerSession.fromJson(
      jsonObject(response['timerSession'], 'timer session'),
    );
  }

  /// The currently running session, or null when none is running.
  Future<TimerSession?> getActiveSession() async {
    final response = jsonObject(
      await _api.get('timer-sessions/active'),
      'timer session',
    );
    final raw = response['timerSession'];
    if (raw == null) return null;
    return TimerSession.fromJson(jsonObject(raw, 'timer session'));
  }

  Future<List<TimerSession>> listSessions() async {
    final items = await fetchAllPages(_api, 'timer-sessions', maxPages: 3);
    return items.map(TimerSession.fromJson).toList(growable: false);
  }

  Future<void> deleteSession(String sessionId) async {
    await _api.delete('timer-sessions/$sessionId');
  }
}
