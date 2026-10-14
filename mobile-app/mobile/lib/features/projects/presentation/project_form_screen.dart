import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/goals/data/goal_model.dart';
import 'package:lifestyle_mobile/features/goals/state/goals_provider.dart';
import 'package:lifestyle_mobile/features/projects/data/project_model.dart';
import 'package:lifestyle_mobile/features/projects/presentation/project_labels.dart';
import 'package:lifestyle_mobile/features/projects/state/projects_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Creates a project (when [project] is null) or edits an existing one.
/// Pops with `true` after a successful save.
class ProjectFormScreen extends ConsumerStatefulWidget {
  const ProjectFormScreen({super.key, this.project});

  final Project? project;

  @override
  ConsumerState<ProjectFormScreen> createState() => _ProjectFormScreenState();
}

class _ProjectFormScreenState extends ConsumerState<ProjectFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late String _status;
  String? _color;
  String? _goalId;
  DateTime? _dueDate;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.project != null;

  @override
  void initState() {
    super.initState();
    final project = widget.project;
    _nameController = TextEditingController(text: project?.name ?? '');
    _descriptionController = TextEditingController(
      text: project?.description ?? '',
    );
    _status = project?.status ?? projectStatuses.first;
    _color = project?.color;
    _goalId = project?.goalId;
    _dueDate = project?.dueDate;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickDueDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _dueDate ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() => _dueDate = dateOnly(picked));
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final name = _nameController.text.trim();
    final description = _descriptionController.text.trim();
    final due = _dueDate;

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final repository = ref.read(projectsRepositoryProvider);
      final existing = widget.project;
      if (existing == null) {
        await repository.createProject({
          'name': name,
          'status': _status,
          if (description.isNotEmpty) 'description': description,
          if (_color != null) 'color': _color,
          if (_goalId != null) 'goalId': _goalId,
          if (due != null) 'dueDate': formatApiDate(due),
        });
      } else {
        await repository.updateProject(existing.id, {
          'name': name,
          'description': description.isEmpty ? null : description,
          'status': _status,
          'color': _color,
          'goalId': _goalId,
          'dueDate': due == null ? null : formatApiDate(due),
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
    final goals = ref.watch(goalsProvider).valueOrNull ?? const <Goal>[];
    final selectedGoalId = _goalId;
    final selectedIsListed = selectedGoalId == null ||
        goals.any((goal) => goal.id == selectedGoalId);
    final error = _error;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? l10n.editProject : l10n.addProject),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TextFormField(
                controller: _nameController,
                autofocus: !_isEdit,
                maxLength: 120,
                decoration: InputDecoration(
                  labelText: l10n.projectNameLabel,
                  border: const OutlineInputBorder(),
                ),
                validator: (value) => (value ?? '').trim().isEmpty
                    ? l10n.projectNameRequired
                    : null,
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
              DropdownButtonFormField<String>(
                initialValue: _status,
                decoration: InputDecoration(
                  labelText: l10n.statusFieldLabel,
                  border: const OutlineInputBorder(),
                ),
                items: [
                  for (final status in projectStatuses)
                    DropdownMenuItem<String>(
                      value: status,
                      child: Text(projectStatusLabel(l10n, status)),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => _status = value);
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                initialValue: _goalId,
                decoration: InputDecoration(
                  labelText: l10n.linkedGoalLabel,
                  border: const OutlineInputBorder(),
                ),
                items: [
                  DropdownMenuItem<String?>(
                    value: null,
                    child: Text(l10n.notSet),
                  ),
                  if (!selectedIsListed)
                    DropdownMenuItem<String?>(
                      value: selectedGoalId,
                      child: Text(l10n.linkedGoalLabel),
                    ),
                  for (final goal in goals)
                    DropdownMenuItem<String?>(
                      value: goal.id,
                      child: Text(
                        goal.title,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: (value) => setState(() => _goalId = value),
              ),
              const SizedBox(height: 12),
              PickerField(
                label: l10n.dueDate,
                valueText: formatDisplayDate(
                  context,
                  _dueDate,
                  emptyText: l10n.notSet,
                ),
                onTap: _pickDueDate,
                onClear: _dueDate == null
                    ? null
                    : () => setState(() => _dueDate = null),
              ),
              const SizedBox(height: 16),
              Text(
                l10n.colorLabel,
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  _ColorSwatch(
                    hex: null,
                    selected: _color == null,
                    onTap: () => setState(() => _color = null),
                  ),
                  for (final hex in projectColorOptions)
                    _ColorSwatch(
                      hex: hex,
                      selected: _color == hex,
                      onTap: () => setState(() => _color = hex),
                    ),
                ],
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

/// Opens the project form and refreshes the list when a project was saved.
Future<void> openProjectForm(
  BuildContext context,
  WidgetRef ref, {
  Project? project,
}) async {
  final saved = await Navigator.of(context).push<bool>(
    MaterialPageRoute<bool>(
      builder: (_) => ProjectFormScreen(project: project),
    ),
  );
  if (saved == true) {
    ref.invalidate(projectsProvider);
  }
}

class _ColorSwatch extends StatelessWidget {
  const _ColorSwatch({
    required this.hex,
    required this.selected,
    required this.onTap,
  });

  final String? hex;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final value = hex;
    final fill = value == null
        ? colorScheme.surfaceContainerHighest
        : Color(int.parse('FF${value.substring(1)}', radix: 16));
    return InkWell(
      onTap: onTap,
      customBorder: const CircleBorder(),
      child: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          color: fill,
          shape: BoxShape.circle,
          border: Border.all(
            color:
                selected ? colorScheme.onSurface : colorScheme.outlineVariant,
            width: selected ? 3 : 1,
          ),
        ),
        child: value == null
            ? Icon(Icons.block, size: 18, color: colorScheme.outline)
            : null,
      ),
    );
  }
}
