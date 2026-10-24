/// Reminder delivery channels the shipped reminder worker can actually use.
///
/// The worker has no push provider: a `push` row retries five times and then
/// fails with PUSH_UNAVAILABLE, so the reminder is never delivered and the row
/// occupies the dispatch loop. Until a real provider is integrated and
/// configured, every client path must request [inApp] (F-04).
class CalendarReminderChannel {
  const CalendarReminderChannel._();

  /// Delivered through the API listing; the client shows a local notification.
  static const String inApp = 'in_app';

  /// Reserved for a future configured provider. Not selectable by the client
  /// today: requesting it produces rows the worker cannot deliver.
  static const String push = 'push';
}
