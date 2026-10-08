import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/goals/data/goal_model.dart';
import 'package:lifestyle_mobile/features/goals/presentation/goal_labels.dart';
import 'package:lifestyle_mobile/features/goals/state/goals_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

final RegExp _decimalPattern = RegExp(r'^\d+(\.\d{1,4})?$');

/// Creates a goal (when [goal] is null) or edits an existing one.
/// Pops with `true` after a successful save.
class GoalFormScreen extends ConsumerStatefulWidget {
  const GoalFormScreen({super.key, this.goal});

  final Goal? goal;

  @override
  ConsumerState<GoalFormScreen> createState() => _GoalFormScreenState();
}

class _GoalFormScreenState extends ConsumerState<GoalFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _targetController;
  late final TextEditingController _currentController;
  late final TextEditingController _unitController;
  late String _progressType;
  late String _status;
  DateTime? _startDate;
  DateTime? _targetDate;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.goal != null;

  @override
  void initState() {
    super.initState();
    final goal = widget.goal;
    _titleController = TextEditingController(text: goal?.title ?? '');
    _descriptionController = TextEditingController(
      text: goal?.description ?? '',
    );
    _targetController = TextEditingController(
      text: formatDecimal(goal?.targetValue),
    );
    _currentController = TextEditingController(
      text: formatDecimal(goal?.currentValue),
    );
    _unitController = TextEditingController(text: goal?.unit ?? '');
    _progressType = goal?.progressType ?? goalProgressMilestones;
    _status = goal?.status ?? goalStatuses.first;
    _startDate = goal?.startDate;
    _targetDate = goal?.targetDate;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _targetController.dispose();
    _currentController.dispose();
    _unitController.dispose();
    super.dispose();
  }

  Future<void> _pickDate(
    DateTime? current,
    ValueChanged<DateTime?> onPicked,
  ) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() => onPicked(dateOnly(picked)));
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final start = _startDate;
    final target = _targetDate;
    if (start != null && target != null && target.isBefore(start)) {
      setState(() => _error = l10n.dateOrderError);
      return;
    }

    final isNumeric = _progressType == goalProgressNumeric;
    final title = _titleController.text.trim();
    final description = _descriptionController.text.trim();
    final unit = _unitController.text.trim();
    final targetText = _targetController.text.trim();
    final currentText = _currentController.text.trim();
    final currentValue = currentText.isEmpty ? '0' : currentText;

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final repository = ref.read(goalsRepositoryProvider);
      final existing = widget.goal;
      if (existing == null) {
        await repository.createGoal({
          'title': title,
          'progressType': _progressType,
          if (description.isNotEmpty) 'description': description,
          if (start != null) 'startDate': formatApiDate(start),
          if (target != null) 'targetDate': formatApiDate(target),
          if (isNumeric) ...{
            'targetValue': targetText,
            'currentValue': currentValue,
            if (unit.isNotEmpty) 'unit': unit,
          },
        });
      } else {
        await repository.updateGoal(existing.id, {
          'title': title,
          'description': description.isEmpty ? null : description,
          'status': _status,
          'startDate': start == null ? null : formatApiDate(start),
          'targetDate': target == null ? null : formatApiDate(target),
          'version': existing.version,
          if (isNumeric) ...{
            'targetValue': targetText,
            'currentValue': currentValue,
            'unit': unit.isEmpty ? null : unit,
          },
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
    final isNumeric = _progressType == goalProgressNumeric;
    final error = _error;

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? l10n.editGoal : l10n.addGoal)),
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
                  labelText: l10n.goalTitleLabel,
                  border: const OutlineInputBorder(),
                ),
                validator: (value) =>
                    (value ?? '').trim().isEmpty ? l10n.goalTitleRequired : null,
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
              const SizedBox(height: 8),
              if (!_isEdit) ...[
                Text(
                  l10n.goalTypeLabel,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment<String>(
                      value: goalProgressMilestones,
                      label: Text(l10n.goalTypeMilestones),
                      icon: const Icon(Icons.flag_outlined),
                    ),
                    ButtonSegment<String>(
                      value: goalProgressNumeric,
                      label: Text(l10n.goalTypeNumeric),
                      icon: const Icon(Icons.format_list_numbered),
                    ),
                  ],
                  selected: {_progressType},
                  onSelectionChanged: (selection) {
                    setState(() => _progressType = selection.first);
                  },
                ),
                const SizedBox(height: 12),
              ],
              if (isNumeric) ...[
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: _targetController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: l10n.goalTargetLabel,
                          border: const OutlineInputBorder(),
                        ),
                        validator: (value) {
                          final text = (value ?? '').trim();
                          final number = double.tryParse(text) ?? 0;
                          if (!_decimalPattern.hasMatch(text) || number <= 0) {
                            return l10n.goalTargetInvalid;
                          }
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextFormField(
                        controller: _currentController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: l10n.goalCurrentLabel,
                          border: const OutlineInputBorder(),
                        ),
                        validator: (value) {
                          final text = (value ?? '').trim();
                          if (text.isEmpty) return null;
                          return _decimalPattern.hasMatch(text)
                              ? null
                              : l10n.goalCurrentInvalid;
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _unitController,
                  maxLength: 30,
                  decoration: InputDecoration(
                    labelText: l10n.goalUnitLabel,
                    border: const OutlineInputBorder(),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              if (_isEdit) ...[
                DropdownButtonFormField<String>(
                  initialValue: _status,
                  decoration: InputDecoration(
                    labelText: l10n.statusFieldLabel,
                    border: const OutlineInputBorder(),
                  ),
                  items: [
                    for (final status in goalStatuses)
                      DropdownMenuItem<String>(
                        value: status,
                        child: Text(goalStatusLabel(l10n, status)),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => _status = value);
                  },
                ),
                const SizedBox(height: 12),
              ],
              PickerField(
                label: l10n.startDateLabel,
                valueText: formatDisplayDate(
                  context,
                  _startDate,
                  emptyText: l10n.notSet,
                ),
                onTap: () => _pickDate(_startDate, (value) => _startDate = value),
                onClear: _startDate == null
                    ? null
                    : () => setState(() => _startDate = null),
              ),
              const SizedBox(height: 12),
              PickerField(
                label: l10n.goalTargetDateLabel,
                valueText: formatDisplayDate(
                  context,
                  _targetDate,
                  emptyText: l10n.notSet,
                ),
                onTap: () =>
                    _pickDate(_targetDate, (value) => _targetDate = value),
                onClear: _targetDate == null
                    ? null
                    : () => setState(() => _targetDate = null),
              ),
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

/// Opens the goal form and refreshes the list when a goal was saved.
Future<void> openGoalForm(BuildContext context, WidgetRef ref, {Goal? goal}) async {
  final saved = await Navigator.of(context).push<bool>(
    MaterialPageRoute<bool>(builder: (_) => GoalFormScreen(goal: goal)),
  );
  if (saved == true) {
    ref.invalidate(goalsProvider);
  }
}
