import 'package:lifestyle_mobile/data/json_fields.dart';

/// Status values accepted by the goals API.
const List<String> goalStatuses = ['active', 'paused', 'achieved', 'abandoned'];

const String goalProgressMilestones = 'milestones';
const String goalProgressNumeric = 'numeric';

class GoalMilestone {
  const GoalMilestone({
    required this.id,
    required this.goalId,
    required this.title,
    required this.completed,
    required this.dueDate,
    required this.version,
  });

  final String id;
  final String goalId;
  final String title;
  final bool completed;
  final DateTime? dueDate;
  final int version;

  factory GoalMilestone.fromJson(Map<String, dynamic> json) {
    return GoalMilestone(
      id: jsonString(json, 'id'),
      goalId: jsonString(json, 'goalId'),
      title: jsonString(json, 'title'),
      completed: jsonBool(json, 'completed'),
      dueDate: jsonOptionalDate(json, 'dueDate'),
      version: jsonInt(json, 'version'),
    );
  }
}

class Goal {
  const Goal({
    required this.id,
    required this.title,
    required this.description,
    required this.status,
    required this.progressType,
    required this.targetValue,
    required this.currentValue,
    required this.unit,
    required this.progressPercentage,
    required this.totalMilestones,
    required this.completedMilestones,
    required this.milestones,
    required this.startDate,
    required this.targetDate,
    required this.version,
  });

  final String id;
  final String title;
  final String? description;
  final String status;
  final String progressType;
  final String? targetValue;
  final String? currentValue;
  final String? unit;
  final double progressPercentage;
  final int totalMilestones;
  final int completedMilestones;
  final List<GoalMilestone> milestones;
  final DateTime? startDate;
  final DateTime? targetDate;
  final int version;

  bool get isMilestoneGoal => progressType == goalProgressMilestones;

  factory Goal.fromJson(Map<String, dynamic> json) {
    final rawMilestones = json['milestones'];
    return Goal(
      id: jsonString(json, 'id'),
      title: jsonString(json, 'title'),
      description: jsonOptionalString(json, 'description'),
      status: jsonString(json, 'status'),
      progressType: jsonString(json, 'progressType'),
      targetValue: jsonOptionalString(json, 'targetValue'),
      currentValue: jsonOptionalString(json, 'currentValue'),
      unit: jsonOptionalString(json, 'unit'),
      progressPercentage: jsonDouble(json, 'progressPercentage'),
      totalMilestones: jsonOptionalInt(json, 'totalMilestones') ?? 0,
      completedMilestones: jsonOptionalInt(json, 'completedMilestones') ?? 0,
      milestones: rawMilestones is List<dynamic>
          ? jsonObjectList(rawMilestones, 'milestones')
              .map(GoalMilestone.fromJson)
              .toList(growable: false)
          : const <GoalMilestone>[],
      startDate: jsonOptionalDate(json, 'startDate'),
      targetDate: jsonOptionalDate(json, 'targetDate'),
      version: jsonInt(json, 'version'),
    );
  }
}
