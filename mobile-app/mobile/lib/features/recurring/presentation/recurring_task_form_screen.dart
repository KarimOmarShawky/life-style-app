import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/projects/data/project_model.dart';
import 'package:lifestyle_mobile/features/projects/state/projects_provider.dart';
import 'package:lifestyle_mobile/features/recurring/data/recurring_task_model.dart';
import 'package:lifestyle_mobile/features/recurring/presentation/recurring_labels.dart';
import 'package:lifestyle_mobile/features/recurring/state/recurring_tasks_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Reminder offsets (minutes before the due time) offered in the form.
const List<int> _reminderOffsetOptions = [0, 10, 30, 60];

/// Creates a recurring task (when [task] is null) or edits an existing one.
/// Pops with `true` after a successful save.
class RecurringTaskFormScreen extends ConsumerStatefulWidget {
  const RecurringTaskFormScreen({super.key, this.task});

  final RecurringTask? task;

  @override
  ConsumerState<RecurringTaskFormScreen> createState() =>
      _RecurringTaskFormScreenState();
}

class _RecurringTaskFormScreenState
    extends ConsumerState<RecurringTaskFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _estimateController;
  late final TextEditingController _intervalController;
  late String _priority;
  late String _status;
  late String _freq;
  String? _projectId;
  TimeOfDay? _dueTime;
  int? _reminderOffset;
  late Set<int> _weekdays;
  late DateTime _startDate;
  DateTime? _endDate;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.task != null;

  @override
  void initState() {
    super.initState();
    final task = widget.task;
    final rule = task?.recurrence;
    _titleController = TextEditingController(text: task?.title ?? '');
    _descriptionController = TextEditingController(
      text: task?.description ?? '',
    );
    _estimateController = TextEditingController(
      text: task?.estimateMinutes?.toString() ?? '',
    );
    _intervalController = TextEditingController(
      text: '${rule?.interval ?? 1}',
    );
    _priority = task?.priority ?? taskPriorities.first;
    _status = task?.status ?? recurringStatuses.first;
    _freq = rule?.freq ?? recurrenceFrequencies.first;
    _projectId = task?.projectId;
    _dueTime = parseApiTime(task?.dueTime);
    _reminderOffset = task?.reminderOffsetMinutes;
    _weekdays = <int>{...?rule?.byWeekday};
    _startDate = rule?.startDate ?? dateOnly(DateTime.now());
    _endDate = rule?.endDate;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _estimateController.dispose();
    _intervalController.dispose();
    super.dispose();
  }

  Future<void> _pickStartDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _startDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() => _startDate = dateOnly(picked));
  }

  Future<void> _pickEndDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _endDate ?? _startDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() => _endDate = dateOnly(picked));
  }

  Future<void> _pickDueTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _dueTime ?? const TimeOfDay(hour: 9, minute: 0),
    );
    if (picked == null || !mounted) return;
    setState(() => _dueTime = picked);
  }

  Map<String, Object?> _recurrenceFields(int interval) {
    final end = _endDate;
    final weekdays = _weekdays.toList()..sort();
    return {
      'freq': _freq,
      'interval': interval,
      'byWeekday': _freq == 'weekly' && weekdays.isNotEmpty ? weekdays : null,
      'startDate': formatApiDate(_startDate),
      'endDate': end == null ? null : formatApiDate(end),
    };
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final start = _startDate;
    final end = _endDate;
    if (end != null && end.isBefore(start)) {
      setState(() => _error = l10n.dateOrderError);
      return;
    }

    final interval = int.tryParse(_intervalController.text.trim()) ?? 1;
    final estimateText = _estimateController.text.trim();
    final estimate = estimateText.isEmpty ? null : int.tryParse(estimateText);
    final description = _descriptionController.text.trim();
    final dueTime = _dueTime;
    final title = _titleController.text.trim();

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final repository = ref.read(recurringTasksRepositoryProvider);
      final existing = widget.task;
      if (existing == null) {
        await repository.createRecurringTask({
          'title': title,
          'priority': _priority,
          if (description.isNotEmpty) 'description': description,
          'projectId': _projectId,
          'estimateMinutes': estimate,
          'dueTime': dueTime == null ? null : formatApiTime(dueTime),
          'reminderOffsetMinutes': dueTime == null ? null : _reminderOffset,
          'recurrence': _recurrenceFields(interval),
        });
      } else {
        await repository.updateRecurringTask(existing.id, {
          'title': title,
          'description': description.isEmpty ? null : description,
          'priority': _priority,
          'projectId': _projectId,
          'estimateMinutes': estimate,
          'dueTime': dueTime == null ? null : formatApiTime(dueTime),
          'reminderOffsetMinutes': dueTime == null ? null : _reminderOffset,
          'status': _status,
          'recurrence': _recurrenceFields(interval),
          'version': existing.version,
        });
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colorScheme = Theme.of(context).colorScheme;
    final projects = ref.watch(projectsProvider).valueOrNull ?? const <Project>[];
    final selectedProjectId = _projectId;
    final selectedIsListed =
        selectedProjectId == null ||
        projects.any((project) => project.id == selectedProjectId);
    final error = _error;
    final endDate = _endDate;
    final reminderOffset = _reminderOffset;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? l10n.editRecurringTask : l10n.addRecurringTask),
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
                maxLength: 300,
                decoration: InputDecoration(
                  labelText: l10n.taskTitleLabel,
                  border: const OutlineInputBorder(),
                ),
                validator: (value) =>
                    (value ?? '').trim().isEmpty ? l10n.taskTitleRequired : null,
              ),
              TextFormField(
                controller: _descriptionController,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: l10n.description,
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _priority,
                decoration: InputDecoration(
                  labelText: l10n.priorityFieldLabel,
                  border: const OutlineInputBorder(),
                ),
                items: [
                  for (final priority in taskPriorities)
                    DropdownMenuItem<String>(
                      value: priority,
                      child: Text(priorityLabel(l10n, priority)),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => _priority = value);
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                initialValue: _projectId,
                decoration: InputDecoration(
                  labelText: l10n.projectLabel,
                  border: const OutlineInputBorder(),
                ),
                items: [
                  DropdownMenuItem<String?>(
                    value: null,
                    child: Text(l10n.notSet),
                  ),
                  if (!selectedIsListed)
                    DropdownMenuItem<String?>(
                      value: selectedProjectId,
                      child: Text(l10n.projectLabel),
                    ),
                  for (final project in projects)
                    DropdownMenuItem<String?>(
                      value: project.id,
                      child: Text(
                        project.name,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: (value) => setState(() => _projectId = value),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _estimateController,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: l10n.estimateMinutesLabel,
                  border: const OutlineInputBorder(),
                ),
                validator: (value) {
                  final text = (value ?? '').trim();
                  if (text.isEmpty) return null;
                  final minutes = int.tryParse(text);
                  return minutes == null || minutes < 1 || minutes > 1440
                      ? l10n.estimateInvalid
                      : null;
                },
              ),
              const SizedBox(height: 12),
              PickerField(
                label: l10n.dueTimeLabel,
                valueText: _dueTime == null
                    ? l10n.notSet
                    : formatDisplayTimeOfDay(context, _dueTime!),
                onTap: _pickDueTime,
                onClear: _dueTime == null
                    ? null
                    : () => setState(() => _dueTime = null),
              ),
              if (_dueTime != null) ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<int?>(
                  initialValue: reminderOffset,
                  decoration: InputDecoration(
                    labelText: l10n.reminderLabel,
                    border: const OutlineInputBorder(),
                  ),
                  items: [
                    DropdownMenuItem<int?>(
                      value: null,
                      child: Text(l10n.noReminder),
                    ),
                    for (final minutes in _reminderOffsetOptions)
                      DropdownMenuItem<int?>(
                        value: minutes,
                        child: Text(
                          minutes == 0
                              ? l10n.reminderAtDueTime
                              : l10n.minutesBefore(minutes),
                        ),
                      ),
                    if (reminderOffset != null &&
                        !_reminderOffsetOptions.contains(reminderOffset))
                      DropdownMenuItem<int?>(
                        value: reminderOffset,
                        child: Text(l10n.minutesBefore(reminderOffset)),
                      ),
                  ],
                  onChanged: (value) => setState(() => _reminderOffset = value),
                ),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _freq,
                      decoration: InputDecoration(
                        labelText: l10n.repeatLabel,
                        border: const OutlineInputBorder(),
                      ),
                      items: [
                        for (final freq in recurrenceFrequencies)
                          DropdownMenuItem<String>(
                            value: freq,
                            child: Text(recurrenceFrequencyLabel(l10n, freq)),
                          ),
                      ],
                      onChanged: (value) {
                        if (value != null) setState(() => _freq = value);
                      },
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    width: 110,
                    child: TextFormField(
                      controller: _intervalController,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(
                        labelText: l10n.everyLabel,
                        border: const OutlineInputBorder(),
                      ),
                      validator: (value) {
                        final number = int.tryParse((value ?? '').trim());
                        return number == null || number < 1
                            ? l10n.intervalInvalid
                            : null;
                      },
                    ),
                  ),
                ],
              ),
              if (_freq == 'weekly') ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final isoDay in const [1, 2, 3, 4, 5, 6, 7])
                      FilterChip(
                        label: Text(isoWeekdayLabel(l10n, isoDay)),
                        selected: _weekdays.contains(isoDay),
                        onSelected: (selected) {
                          setState(() {
                            if (selected) {
                              _weekdays.add(isoDay);
                            } else {
                              _weekdays.remove(isoDay);
                            }
                          });
                        },
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
              PickerField(
                label: l10n.startDateLabel,
                valueText: formatDisplayDate(
                  context,
                  _startDate,
                  emptyText: l10n.notSet,
                ),
                onTap: _pickStartDate,
              ),
              const SizedBox(height: 12),
              PickerField(
                label: l10n.endDateLabel,
                valueText: formatDisplayDate(
                  context,
                  endDate,
                  emptyText: l10n.noEndDate,
                ),
                onTap: _pickEndDate,
                onClear: endDate == null
                    ? null
                    : () => setState(() => _endDate = null),
              ),
              if (_isEdit) ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _status,
                  decoration: InputDecoration(
                    labelText: l10n.statusFieldLabel,
                    border: const OutlineInputBorder(),
                  ),
                  items: [
                    for (final status in recurringStatuses)
                      DropdownMenuItem<String>(
                        value: status,
                        child: Text(recurringStatusLabel(l10n, status)),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => _status = value);
                  },
                ),
              ],
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

/// Opens the recurring task form and refreshes the list when a task was saved.
Future<void> openRecurringTaskForm(
  BuildContext context,
  WidgetRef ref, {
  RecurringTask? task,
}) async {
  final saved = await Navigator.of(context).push<bool>(
    MaterialPageRoute<bool>(
      builder: (_) => RecurringTaskFormScreen(task: task),
    ),
  );
  if (saved == true) {
    ref.invalidate(recurringTasksProvider);
  }
}
