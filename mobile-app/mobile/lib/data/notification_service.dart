import 'dart:developer' as developer;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:lifestyle_mobile/data/smart_task_parser.dart';
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

  static const String quickChannelId = 'lifestyle_quick_input_channel';
  static const String quickChannelName = 'LifeStyle Quick LockScreen Input';
  static const String quickChannelDesc =
      'Lockscreen and shade quick voice/text appointment setter';

  static const String normalChannelId = 'lifestyle_general_channel';
  static const String normalChannelName = 'LifeStyle Reminders';
  static const String normalChannelDesc =
      'General alerts and notification reminders';

  static const String calendarChannelId =
      'lifestyle_calendar_reminders_channel';
  static const String calendarChannelName = 'LifeStyle Calendar Reminders';
  static const String calendarChannelDesc = 'Reminders before calendar events';

  static const int pinnedNotificationId = 777;

  final ValueNotifier<bool> quickVoiceTrigger = ValueNotifier(false);

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

        // 2. LockScreen Quick Input Channel
        await androidPlugin.createNotificationChannel(
          const AndroidNotificationChannel(
            quickChannelId,
            quickChannelName,
            description: quickChannelDesc,
            importance: Importance.low,
            playSound: false,
            enableVibration: false,
          ),
        );

        // 3. Normal Notifications Channel
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

        // 4. Calendar reminders (scheduled when an event or its reminders are saved)
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

        await androidPlugin.requestNotificationsPermission();
        await androidPlugin.requestExactAlarmsPermission();
      }

      _isInitialized = true;

      // Show the persistent quick input widget in lockscreen and shade
      await showPinnedQuickInputNotification();
    } catch (e, stack) {
      developer.log(
        'Failed to initialize NotificationService: $e',
        name: 'NotificationService',
        error: e,
        stackTrace: stack,
      );
    }
  }

  /// Whether the device language is Arabic. Notification text is built without a BuildContext.
  static bool get isDeviceArabic => _isDeviceArabic;

  static bool get _isDeviceArabic {
    try {
      final loc = WidgetsBinding.instance.platformDispatcher.locale;
      return loc.languageCode == 'ar';
    } catch (_) {
      return true;
    }
  }

  Future<void> handleNotificationAction(NotificationResponse response) async {
    developer.log(
      'Notification Action: actionId=${response.actionId}, payload=${response.payload}',
      name: 'NotificationService',
    );

    // Quick Voice trigger from pinned notification
    if (response.payload == 'quick_voice' ||
        response.actionId == 'quick_voice_action') {
      quickVoiceTrigger.value = true;
      return;
    }

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
        scheduleAlarm(
          id: response.id!,
          title: _isDeviceArabic
              ? '(غفوة) تذكير بموعدك'
              : '(Snooze) Appointment Reminder',
          body: _isDeviceArabic
              ? 'حان الوقت لإنجاز مهمتك المجدولة'
              : 'Time for your scheduled task',
          scheduledDateTime: DateTime.now().add(const Duration(minutes: 5)),
        );
      }
      return;
    }

    // 3. Quick Input from LockScreen or Notification Shade
    if (response.actionId == 'quick_voice_action' && response.input != null) {
      final text = response.input!.trim();
      if (text.isEmpty) return;

      final parsed = await SmartTaskParser.parseAsync(text);
      DateTime? scheduledTime = parsed.scheduledDateTime;

      // Default to 1 hour from now if time was not parsed
      scheduledTime ??= DateTime.now().add(const Duration(hours: 1));

      final alarmId = parsed.title.hashCode;
      await scheduleAlarm(
        id: alarmId,
        title:
            _isDeviceArabic ? 'موعد: ${parsed.title}' : 'Task: ${parsed.title}',
        body: _isDeviceArabic
            ? 'حان الوقت لإنجاز مهمتك المجدولة'
            : 'Time for your scheduled task',
        scheduledDateTime: scheduledTime,
      );

      // Update the pinned notification to confirm
      await showPinnedQuickInputNotification(
        lastAddedTitle: parsed.title,
        lastAddedTime: '${parsed.dueDate ?? ""} ${parsed.dueTime ?? ""}'.trim(),
      );
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
      );

      const details = NotificationDetails(android: androidDetails);
      await _notificationsPlugin.show(id, title, body, details,
          payload: payload);
    } catch (e) {
      developer.log('showInstantNotification error: $e');
    }
  }

  static const MethodChannel _nativeChannel =
      MethodChannel('com.example.lifestyle_mobile/native_voice');

  /// Pinned Quick Input in lockscreen and notification shade
  Future<void> showPinnedQuickInputNotification({
    String? lastAddedTitle,
    String? lastAddedTime,
  }) async {
    try {
      await _nativeChannel.invokeMethod('refreshPinnedNotification');
    } catch (e) {
      developer.log('refreshPinnedNotification error: $e');
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
        fullScreenIntent: true,
        ongoing: true,
        autoCancel: false,
        additionalFlags:
            Int32List.fromList([4]), // FLAG_INSISTENT: loops continuously
        actions: [
          AndroidNotificationAction(
            'dismiss_alarm',
            _isDeviceArabic ? 'إيقاف المنبه' : 'Dismiss',
            cancelNotification: true,
            showsUserInterface: true,
          ),
          AndroidNotificationAction(
            'snooze_alarm',
            _isDeviceArabic ? 'غفوة 5 دقائق' : 'Snooze 5 min',
            cancelNotification: true,
          ),
        ],
      );

      final details = NotificationDetails(android: androidDetails);

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
        fullScreenIntent: true,
        ongoing: true,
        autoCancel: false,
        additionalFlags: Int32List.fromList([4]),
        actions: [
          AndroidNotificationAction(
            'dismiss_alarm',
            _isDeviceArabic ? 'إيقاف المنبه' : 'Dismiss',
            cancelNotification: true,
            showsUserInterface: true,
          ),
          AndroidNotificationAction(
            'snooze_alarm',
            _isDeviceArabic ? 'غفوة 5 دقائق' : 'Snooze 5 min',
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
