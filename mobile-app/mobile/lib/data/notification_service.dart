import 'dart:developer' as developer;
import 'dart:typed_data';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

@pragma('vm:entry-point')
void notificationTapBackground(NotificationResponse response) async {
  await NotificationService.instance.handleNotificationAction(response);
}

class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _notificationsPlugin =
      FlutterLocalNotificationsPlugin();

  static const String alarmChannelId = 'lifestyle_real_alarm_channel';
  static const String alarmChannelName = 'LifeStyle Real Alarms';
  static const String alarmChannelDesc =
      'Continuous loud alarm for tasks, appointments, and schedules';

  static const String normalChannelId = 'lifestyle_general_channel';
  static const String normalChannelName = 'LifeStyle Reminders';
  static const String normalChannelDesc =
      'General alerts and notification reminders';

  static const String calendarChannelId =
      'lifestyle_calendar_reminders_channel';
  static const String calendarChannelName = 'LifeStyle Calendar Reminders';
  static const String calendarChannelDesc = 'Reminders before calendar events';

  /// Set once the exact-alarm settings page has been opened, so a user who
  /// declined is not sent there again on every save.
  static const String _exactAlarmAskedKey =
      'notifications.exact_alarm_asked.v1';

  bool _isInitialized = false;

  Future<void> init() async {
    if (_isInitialized) return;

    try {
      tz.initializeTimeZones();
      try {
        tz.setLocalLocation(tz.getLocation('Africa/Cairo'));
      } catch (_) {
        tz.setLocalLocation(tz.UTC);
      }

      const androidSettings =
          AndroidInitializationSettings('@mipmap/ic_launcher');

      const initSettings = InitializationSettings(
        android: androidSettings,
      );

      await _notificationsPlugin.initialize(
        initSettings,
        onDidReceiveNotificationResponse: (response) {
          handleNotificationAction(response);
        },
        onDidReceiveBackgroundNotificationResponse: notificationTapBackground,
      );

      final androidPlugin =
          _notificationsPlugin.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();

      if (androidPlugin != null) {
        // 1. Loud Continuous Alarm Channel
        await androidPlugin.createNotificationChannel(
          const AndroidNotificationChannel(
            alarmChannelId,
            alarmChannelName,
            description: alarmChannelDesc,
            importance: Importance.max,
            playSound: true,
            enableVibration: true,
            audioAttributesUsage: AudioAttributesUsage.alarm,
          ),
        );

        // 2. Normal Notifications Channel
        await androidPlugin.createNotificationChannel(
          const AndroidNotificationChannel(
            normalChannelId,
            normalChannelName,
            description: normalChannelDesc,
            importance: Importance.high,
            playSound: true,
            enableVibration: true,
          ),
        );

        // 3. Calendar reminders (scheduled when an event or its reminders are saved)
        await androidPlugin.createNotificationChannel(
          const AndroidNotificationChannel(
            calendarChannelId,
            calendarChannelName,
            description: calendarChannelDesc,
            importance: Importance.high,
            playSound: true,
            enableVibration: true,
          ),
        );
        // Permissions are requested from user actions only; see
        // requestPermissionsIfNeeded (feature guide P0-F5).
      }

      _isInitialized = true;
    } catch (e, stack) {
      developer.log(
        'Failed to initialize NotificationService: $e',
        name: 'NotificationService',
        error: e,
        stackTrace: stack,
      );
    }
  }

  /// Asks for notification permission when the user has just done something
  /// that needs it (never at launch and never from background work). The
  /// exact-alarm request opens a system settings page, so it is made only
  /// for a time the user just set, only while that permission is missing,
  /// and at most once per install. Denial is safe: alarms and reminders then
  /// fall back to inexact delivery.
  Future<void> requestPermissionsIfNeeded({bool exactAlarms = false}) async {
    try {
      final androidPlugin =
          _notificationsPlugin.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      if (androidPlugin == null) return;
      if (await androidPlugin.areNotificationsEnabled() != true) {
        await androidPlugin.requestNotificationsPermission();
      }
      if (exactAlarms &&
          await androidPlugin.canScheduleExactNotifications() == false) {
        final prefs = await SharedPreferences.getInstance();
        if (prefs.getBool(_exactAlarmAskedKey) != true) {
          await prefs.setBool(_exactAlarmAskedKey, true);
          await androidPlugin.requestExactAlarmsPermission();
        }
      }
    } catch (e) {
      developer.log('requestPermissionsIfNeeded error: $e',
          name: 'NotificationService');
    }
  }

  /// Copy for notification text built without a BuildContext (alarm actions
  /// and the background snooze): the device language when the app ships it,
  /// otherwise English.
  static AppLocalizations get _deviceL10n {
    try {
      final locale = WidgetsBinding.instance.platformDispatcher.locale;
      return AppLocalizations(Locale(locale.languageCode));
    } catch (_) {
      return const AppLocalizations(Locale('en'));
    }
  }

  /// Device-language copy for notifications scheduled outside a widget tree.
  static AppLocalizations get deviceL10n => _deviceL10n;

  Future<void> handleNotificationAction(NotificationResponse response) async {
    developer.log(
      'Notification Action: actionId=${response.actionId}, payload=${response.payload}',
      name: 'NotificationService',
    );

    // 1. Dismiss Alarm
    if (response.actionId == 'dismiss_alarm') {
      if (response.id != null) {
        _notificationsPlugin.cancel(response.id!);
      }
      return;
    }

    // 2. Snooze Alarm 5 minutes
    if (response.actionId == 'snooze_alarm') {
      if (response.id != null) {
        _notificationsPlugin.cancel(response.id!);
        final l10n = _deviceL10n;
        scheduleAlarm(
          id: response.id!,
          title: l10n.snoozeReminderTitle,
          body: l10n.snoozeReminderBody,
          scheduledDateTime: DateTime.now().add(const Duration(minutes: 5)),
        );
      }
      return;
    }
  }

  /// Standard instant notification used by Money, Timer, and General alerts
  Future<void> showInstantNotification({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    try {
      const androidDetails = AndroidNotificationDetails(
        normalChannelId,
        normalChannelName,
        channelDescription: normalChannelDesc,
        importance: Importance.high,
        priority: Priority.high,
        playSound: true,
        enableVibration: true,
        visibility: NotificationVisibility.private,
      );

      const details = NotificationDetails(android: androidDetails);
      await _notificationsPlugin.show(id, title, body, details,
          payload: payload);
    } catch (e) {
      developer.log('showInstantNotification error: $e');
    }
  }

  /// Persistent Loud Alarm (Repeats audio continuously until user clicks Dismiss or Snooze)
  Future<void> scheduleAlarm({
    required int id,
    required String title,
    required String body,
    required DateTime scheduledDateTime,
    String? payload,
  }) async {
    try {
      final scheduledTz = tz.TZDateTime.from(scheduledDateTime, tz.local);
      final now = tz.TZDateTime.now(tz.local);

      if (scheduledTz.isBefore(now)) {
        developer.log('Scheduled date is in the past, skipping alarm.');
        return;
      }

      final androidDetails = AndroidNotificationDetails(
        alarmChannelId,
        alarmChannelName,
        channelDescription: alarmChannelDesc,
        importance: Importance.max,
        priority: Priority.max,
        playSound: true,
        enableVibration: true,
        audioAttributesUsage: AudioAttributesUsage.alarm,
        category: AndroidNotificationCategory.alarm,
        visibility: NotificationVisibility.private,
        fullScreenIntent: true,
        ongoing: true,
        autoCancel: false,
        additionalFlags:
            Int32List.fromList([4]), // FLAG_INSISTENT: loops continuously
        actions: [
          AndroidNotificationAction(
            'dismiss_alarm',
            _deviceL10n.alarmDismissAction,
            cancelNotification: true,
            showsUserInterface: true,
          ),
          AndroidNotificationAction(
            'snooze_alarm',
            _deviceL10n.alarmSnoozeAction,
            cancelNotification: true,
          ),
        ],
      );

      final details = NotificationDetails(android: androidDetails);

      try {
        await _notificationsPlugin.zonedSchedule(
          id,
          title,
          body,
          scheduledTz,
          details,
          androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
          payload: payload,
        );
      } on PlatformException {
        // Exact alarms not permitted (Android 12+): still remind, inexactly.
        await _notificationsPlugin.zonedSchedule(
          id,
          title,
          body,
          scheduledTz,
          details,
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
          payload: payload,
        );
      }
      developer.log('Persistent Alarm scheduled for $scheduledTz',
          name: 'NotificationService');
    } catch (e) {
      developer.log('scheduleAlarm error: $e');
    }
  }

  /// Schedules one calendar reminder notification. Times that have passed are skipped.
  /// Exact delivery needs the exact-alarm permission. When it is missing, the reminder is still
  /// scheduled, just without an exact time.
  Future<void> scheduleCalendarReminder({
    required int id,
    required String title,
    required String body,
    required DateTime when,
  }) async {
    try {
      final scheduled = tz.TZDateTime.from(when, tz.local);
      if (scheduled.isBefore(tz.TZDateTime.now(tz.local))) {
        return;
      }

      const androidDetails = AndroidNotificationDetails(
        calendarChannelId,
        calendarChannelName,
        channelDescription: calendarChannelDesc,
        importance: Importance.high,
        priority: Priority.high,
        category: AndroidNotificationCategory.reminder,
        visibility: NotificationVisibility.private,
      );
      const details = NotificationDetails(android: androidDetails);

      try {
        await _notificationsPlugin.zonedSchedule(
          id,
          title,
          body,
          scheduled,
          details,
          androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
        );
      } on PlatformException {
        await _notificationsPlugin.zonedSchedule(
          id,
          title,
          body,
          scheduled,
          details,
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
        );
      }
    } catch (e) {
      developer.log('scheduleCalendarReminder error: $e');
    }
  }

  /// Test Persistent Alarm immediately
  Future<void> triggerInstantPersistentAlarm({
    required int id,
    required String title,
    required String body,
  }) async {
    try {
      final androidDetails = AndroidNotificationDetails(
        alarmChannelId,
        alarmChannelName,
        channelDescription: alarmChannelDesc,
        importance: Importance.max,
        priority: Priority.max,
        playSound: true,
        enableVibration: true,
        audioAttributesUsage: AudioAttributesUsage.alarm,
        category: AndroidNotificationCategory.alarm,
        visibility: NotificationVisibility.private,
        fullScreenIntent: true,
        ongoing: true,
        autoCancel: false,
        additionalFlags: Int32List.fromList([4]),
        actions: [
          AndroidNotificationAction(
            'dismiss_alarm',
            _deviceL10n.alarmDismissAction,
            cancelNotification: true,
            showsUserInterface: true,
          ),
          AndroidNotificationAction(
            'snooze_alarm',
            _deviceL10n.alarmSnoozeAction,
            cancelNotification: true,
          ),
        ],
      );

      final details = NotificationDetails(android: androidDetails);
      await _notificationsPlugin.show(id, title, body, details);
    } catch (e) {
      developer.log('triggerInstantPersistentAlarm error: $e');
    }
  }

  Future<void> cancelAlarm(int id) async {
    try {
      await _notificationsPlugin.cancel(id);
    } catch (e) {
      developer.log('cancelAlarm error: $e');
    }
  }

  Future<void> cancelAll() async {
    try {
      await _notificationsPlugin.cancelAll();
    } catch (e) {
      developer.log('cancelAll error: $e');
    }
  }
}
