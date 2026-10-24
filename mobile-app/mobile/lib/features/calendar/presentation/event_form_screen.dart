import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_event_model.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_reminder_notifications.dart';
import 'package:lifestyle_mobile/features/calendar/data/reminder_channel.dart';
import 'package:lifestyle_mobile/features/calendar/presentation/calendar_labels.dart';
import 'package:lifestyle_mobile/features/calendar/state/calendar_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Creates an event (when [event] is null) or edits one, including its reminders.
/// Pops with `true` after a successful save.
class EventFormScreen extends ConsumerStatefulWidget {
  const EventFormScreen({super.key, this.event, this.initialDay});

  final CalendarEvent? event;
  final DateTime? initialDay;

  @override
  ConsumerState<EventFormScreen> createState() => _EventFormScreenState();
}

class _EventFormScreenState extends ConsumerState<EventFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController;
  late final TextEditingController _locationController;
  late final TextEditingController _descriptionController;
  late bool _allDay;
  late DateTime _startDay;
  late DateTime _endDay;
  late TimeOfDay _startTime;
  late TimeOfDay _endTime;
  int? _newEventReminder = 10;
  int _pendingReminder = 10;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.event != null;

  String get _timezone =>
      ref.read(authProvider).asData?.value?.timezone ?? 'UTC';

  DateTime get _start => _allDay
      ? DateTime(_startDay.year, _startDay.month, _startDay.day)
      : DateTime(
          _startDay.year,
          _startDay.month,
          _startDay.day,
          _startTime.hour,
          _startTime.minute,
        );

  DateTime get _end => _allDay
      ? DateTime(_endDay.year, _endDay.month, _endDay.day, 23, 59)
      : DateTime(
          _endDay.year,
          _endDay.month,
          _endDay.day,
          _endTime.hour,
          _endTime.minute,
        );

  @override
  void initState() {
    super.initState();
    final event = widget.event;
    final base = dateOnly(widget.initialDay ?? DateTime.now());
    final start =
        event?.startAt ?? DateTime(base.year, base.month, base.day, 9);
    final end = event?.endAt ?? start.add(const Duration(hours: 1));
    _titleController = TextEditingController(text: event?.title ?? '');
    _locationController = TextEditingController(text: event?.location ?? '');
    _descriptionController = TextEditingController(
      text: event?.description ?? '',
    );
    _allDay = event?.allDay ?? false;
    _startDay = dateOnly(start);
    _endDay = dateOnly(end);
    _startTime = TimeOfDay.fromDateTime(start);
    _endTime = TimeOfDay.fromDateTime(end);
  }

  @override
  void dispose() {
    _titleController.dispose();
    _locationController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickDay({required bool isStart}) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isStart ? _startDay : _endDay,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (isStart) {
        _startDay = dateOnly(picked);
        if (_endDay.isBefore(_startDay)) _endDay = _startDay;
      } else {
        _endDay = dateOnly(picked);
      }
    });
  }

  Future<void> _pickTime({required bool isStart}) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: isStart ? _startTime : _endTime,
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (isStart) {
        _startTime = picked;
      } else {
        _endTime = picked;
      }
    });
  }

  Future<bool> _confirmConflicts(List<CalendarEvent> conflicts) async {
    final l10n = AppLocalizations.of(context);
    final names = conflicts.map((event) => event.title).join(', ');
    final proceed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.conflictTitle),
        content: Text(l10n.conflictMessage(names)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.saveAnyway),
          ),
        ],
      ),
    );
    return proceed ?? false;
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final start = _start;
    final end = _end;
    if (end.isBefore(start)) {
      setState(() => _error = l10n.endBeforeStartError);
      return;
    }

    final title = _titleController.text.trim();
    final location = _locationController.text.trim();
    final description = _descriptionController.text.trim();
    final reminder = _newEventReminder;
    final existing = widget.event;

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final repository = ref.read(calendarRepositoryProvider);
      if (!_allDay) {
        final conflicts = await repository.checkConflicts(
          start: start,
          end: end,
          excludeEventId: existing?.id,
        );
        if (conflicts.isNotEmpty) {
          if (!mounted) return;
          final proceed = await _confirmConflicts(conflicts);
          if (!proceed) return;
        }
      }

      if (existing == null) {
        final created = await repository.createEvent({
          'title': title,
          if (description.isNotEmpty) 'description': description,
          if (location.isNotEmpty) 'location': location,
          'startAt': toApiInstant(start),
          'endAt': toApiInstant(end),
          'allDay': _allDay,
          'timezone': _timezone,
          'reminders': [
            if (reminder != null)
              {
                // The worker has no push provider; every shipped path uses
                // in_app so the reminder is actually deliverable (F-04).
                'channel': CalendarReminderChannel.inApp,
                'offsetMinutes': reminder,
              },
          ],
        });
        await syncCalendarEventReminders(
          event: created,
          reminders: created.reminders,
        );
      } else {
        final updated = await repository.updateEvent(existing.id, {
          'title': title,
          'description': description.isEmpty ? null : description,
          'location': location.isEmpty ? null : location,
          'startAt': toApiInstant(start),
          'endAt': toApiInstant(end),
          'allDay': _allDay,
          'version': existing.version,
        });
        await syncCalendarEventReminders(
          event: updated,
          reminders: updated.reminders,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _reminderTitle(
    BuildContext context,
    AppLocalizations l10n,
    CalendarReminder reminder,
  ) {
    final offset = reminder.offsetMinutes;
    if (offset != null) return reminderOffsetLabel(l10n, offset);
    return formatDisplayTime(context, reminder.remindAt);
  }

  /// Mirrors the event's current reminders into local notifications.
  Future<void> _resyncReminderNotifications(String eventId) async {
    final event = widget.event;
    if (event == null) {
      return;
    }
    final reminders =
        await ref.read(calendarRepositoryProvider).listReminders(eventId);
    await syncCalendarEventReminders(event: event, reminders: reminders);
  }

  Widget _remindersSection(AppLocalizations l10n, String eventId) {
    final remindersAsync = ref.watch(eventRemindersProvider(eventId));
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.remindersTitle, style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        remindersAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: LinearProgressIndicator(),
          ),
          error: (error, _) => Text(error.toString()),
          data: (reminders) => Column(
            children: [
              if (reminders.isEmpty)
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text(l10n.noReminder),
                  ),
                ),
              for (final reminder in reminders)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.notifications_outlined),
                  title: Text(_reminderTitle(context, l10n, reminder)),
                  trailing: IconButton(
                    tooltip: l10n.delete,
                    icon: const Icon(Icons.close),
                    onPressed: () => runWithErrorSnackBar(context, () async {
                      await ref
                          .read(calendarRepositoryProvider)
                          .deleteReminder(eventId, reminder.id);
                      await removeCalendarReminder(eventId, reminder.id);
                      ref.invalidate(eventRemindersProvider(eventId));
                    }),
                  ),
                ),
            ],
          ),
        ),
        Row(
          children: [
            Expanded(
              child: DropdownButton<int>(
                isExpanded: true,
                value: _pendingReminder,
                items: [
                  for (final minutes in reminderOffsetChoices)
                    DropdownMenuItem<int>(
                      value: minutes,
                      child: Text(reminderOffsetLabel(l10n, minutes)),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => _pendingReminder = value);
                },
              ),
            ),
            IconButton(
              tooltip: l10n.addReminder,
              icon: const Icon(Icons.add_alarm_outlined),
              onPressed: () => runWithErrorSnackBar(context, () async {
                await ref
                    .read(calendarRepositoryProvider)
                    .addReminder(eventId, _pendingReminder);
                await _resyncReminderNotifications(eventId);
                ref.invalidate(eventRemindersProvider(eventId));
              }),
            ),
          ],
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colorScheme = Theme.of(context).colorScheme;
    final eventId = widget.event?.id;
    final error = _error;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? l10n.editEvent : l10n.addEvent),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TextFormField(
                controller: _titleController,
                autofocus: !_isEdit,
                maxLength: 200,
                decoration: InputDecoration(
                  labelText: l10n.eventTitleLabel,
                  border: const OutlineInputBorder(),
                ),
                validator: (value) => (value ?? '').trim().isEmpty
                    ? l10n.eventTitleRequired
                    : null,
              ),
              TextFormField(
                controller: _locationController,
                maxLength: 300,
                decoration: InputDecoration(
                  labelText: l10n.eventLocationLabel,
                  border: const OutlineInputBorder(),
                ),
              ),
              TextFormField(
                controller: _descriptionController,
                maxLines: 3,
                maxLength: 5000,
                decoration: InputDecoration(
                  labelText: l10n.description,
                  border: const OutlineInputBorder(),
                ),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l10n.allDayLabel),
                value: _allDay,
                onChanged: (value) => setState(() => _allDay = value),
              ),
              const SizedBox(height: 8),
              PickerField(
                label: l10n.startDateLabel,
                valueText: formatDisplayDate(context, _startDay, emptyText: ''),
                onTap: () => _pickDay(isStart: true),
              ),
              if (!_allDay) ...[
                const SizedBox(height: 12),
                PickerField(
                  label: l10n.startTimeLabel,
                  valueText: formatDisplayTime(context, _start),
                  onTap: () => _pickTime(isStart: true),
                ),
              ],
              const SizedBox(height: 12),
              PickerField(
                label: l10n.endDateLabel,
                valueText: formatDisplayDate(context, _endDay, emptyText: ''),
                onTap: () => _pickDay(isStart: false),
              ),
              if (!_allDay) ...[
                const SizedBox(height: 12),
                PickerField(
                  label: l10n.endTimeLabel,
                  valueText: formatDisplayTime(context, _end),
                  onTap: () => _pickTime(isStart: false),
                ),
              ],
              const SizedBox(height: 16),
              if (eventId == null)
                DropdownButtonFormField<int?>(
                  initialValue: _newEventReminder,
                  decoration: InputDecoration(
                    labelText: l10n.reminderLabel,
                    border: const OutlineInputBorder(),
                  ),
                  items: [
                    DropdownMenuItem<int?>(
                      value: null,
                      child: Text(l10n.noReminder),
                    ),
                    for (final minutes in reminderOffsetChoices)
                      DropdownMenuItem<int?>(
                        value: minutes,
                        child: Text(reminderOffsetLabel(l10n, minutes)),
                      ),
                  ],
                  onChanged: (value) =>
                      setState(() => _newEventReminder = value),
                )
              else
                _remindersSection(l10n, eventId),
              if (error != null) ...[
                const SizedBox(height: 12),
                Text(error, style: TextStyle(color: colorScheme.error)),
              ],
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _saving ? null : _submit,
                child: _saving
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(l10n.save),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Opens the event form and refreshes the agenda when an event was saved.
Future<void> openEventForm(
  BuildContext context,
  WidgetRef ref, {
  CalendarEvent? event,
  DateTime? initialDay,
}) async {
  final saved = await Navigator.of(context).push<bool>(
    MaterialPageRoute<bool>(
      builder: (_) => EventFormScreen(event: event, initialDay: initialDay),
    ),
  );
  if (saved == true) {
    ref.invalidate(calendarAgendaProvider);
  }
}
