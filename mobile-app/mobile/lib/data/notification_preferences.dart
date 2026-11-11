import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/data/notification_policy.dart';
import 'package:lifestyle_mobile/data/notification_scheduler.dart';

/// Feature guide G2 (ADR-046): the account's notification settings, as
/// GET/PUT /notification-preferences return them.
class NotificationSettings {
  const NotificationSettings({
    required this.preferences,
    required this.timeZone,
    required this.available,
  });

  factory NotificationSettings.fromJson(Map<String, Object?> json) {
    final zone = json['timeZone'];
    return NotificationSettings(
      preferences: NotificationPreferences.fromJson(json),
      timeZone: zone is String && zone.isNotEmpty ? zone : 'UTC',
      available: json['available'] != false,
    );
  }

  final NotificationPreferences preferences;

  /// The account time zone that quiet hours and days are read in.
  final String timeZone;

  /// False until the server's owner-run SQL is applied: saving fails then.
  final bool available;

  NotificationSettings withPreferences(NotificationPreferences next) {
    return NotificationSettings(
      preferences: next,
      timeZone: timeZone,
      available: available,
    );
  }
}

abstract class NotificationPreferencesClient {
  Future<NotificationSettings> fetch();

  Future<NotificationSettings> save(NotificationPreferences preferences);
}

class ApiNotificationPreferencesClient
    implements NotificationPreferencesClient {
  const ApiNotificationPreferencesClient(this._api);

  final ApiClient _api;

  @override
  Future<NotificationSettings> fetch() async {
    final response = await _api.get('notification-preferences');
    return NotificationSettings.fromJson(_asMap(response));
  }

  @override
  Future<NotificationSettings> save(
    NotificationPreferences preferences,
  ) async {
    final response = await _api.put(
      'notification-preferences',
      body: preferences.toJson(),
    );
    return NotificationSettings.fromJson(_asMap(response));
  }
}

Map<String, Object?> _asMap(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map<Object?, Object?>) return value.cast<String, Object?>();
  throw const FormatException('Unexpected notification settings response');
}

final notificationPreferencesClientProvider =
    Provider<NotificationPreferencesClient>((ref) {
  return ApiNotificationPreferencesClient(ref.watch(apiClientProvider));
});

final notificationSettingsProvider = AsyncNotifierProvider.autoDispose<
    NotificationSettingsController,
    NotificationSettings>(NotificationSettingsController.new);

class NotificationSettingsController
    extends AutoDisposeAsyncNotifier<NotificationSettings> {
  @override
  Future<NotificationSettings> build() async {
    final client = ref.read(notificationPreferencesClientProvider);
    final settings = await client.fetch();
    await _apply(settings);
    return settings;
  }

  /// Saves [next]. On failure the previous settings stay and the error is
  /// rethrown for the screen to explain.
  Future<void> save(NotificationPreferences next) async {
    final current = state.valueOrNull;
    if (current == null) return;
    final link = ref.keepAlive();
    final client = ref.read(notificationPreferencesClientProvider);
    state = AsyncData(current.withPreferences(next));
    try {
      final saved = await client.save(next);
      state = AsyncData(saved);
      await _apply(saved);
    } catch (_) {
      state = AsyncData(current);
      rethrow;
    } finally {
      link.close();
    }
  }

  Future<void> _apply(NotificationSettings settings) async {
    try {
      await NotificationScheduler.instance.applyPreferences(
        settings.preferences,
        settings.timeZone,
      );
    } catch (_) {
      /* Re-planning runs again at the next app start. */
    }
  }
}

/// Loads the account's settings and re-plans this device's reminders. Runs
/// at app start and resume. Errors are ignored: the last known settings
/// keep applying.
Future<void> syncNotificationPreferences(WidgetRef ref) async {
  try {
    final client = ref.read(notificationPreferencesClientProvider);
    final settings = await client.fetch();
    await NotificationScheduler.instance.applyPreferences(
      settings.preferences,
      settings.timeZone,
    );
  } catch (_) {
    /* Offline or not signed in: keep the last known settings. */
  }
}
