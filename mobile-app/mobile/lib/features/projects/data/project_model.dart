import 'package:lifestyle_mobile/data/json_fields.dart';

/// Status values accepted by the projects API.
const List<String> projectStatuses = [
  'active',
  'on_hold',
  'completed',
  'archived'
];

/// Preset colors offered in the project form (all valid #RRGGBB values).
const List<String> projectColorOptions = [
  '#2563EB',
  '#16A34A',
  '#F59E0B',
  '#DC2626',
  '#7C3AED',
  '#0891B2',
];

class Project {
  const Project({
    required this.id,
    required this.name,
    required this.description,
    required this.status,
    required this.color,
    required this.goalId,
    required this.dueDate,
    required this.version,
    required this.openTasks,
    required this.doneTasks,
  });

  final String id;
  final String name;
  final String? description;
  final String status;
  final String? color;
  final String? goalId;
  final DateTime? dueDate;
  final int version;
  final int openTasks;
  final int doneTasks;

  factory Project.fromJson(Map<String, dynamic> json) {
    final rawCounts = json['taskCounts'];
    final counts = rawCounts is Map<String, dynamic>
        ? rawCounts
        : const <String, dynamic>{};
    return Project(
      id: jsonString(json, 'id'),
      name: jsonString(json, 'name'),
      description: jsonOptionalString(json, 'description'),
      status: jsonString(json, 'status'),
      color: jsonOptionalString(json, 'color'),
      goalId: jsonOptionalString(json, 'goalId'),
      dueDate: jsonOptionalDate(json, 'dueDate'),
      version: jsonInt(json, 'version'),
      openTasks: jsonOptionalInt(counts, 'open') ?? 0,
      doneTasks: jsonOptionalInt(counts, 'done') ?? 0,
    );
  }
}
