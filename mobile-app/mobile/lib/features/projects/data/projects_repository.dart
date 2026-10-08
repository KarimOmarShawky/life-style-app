import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';
import 'package:lifestyle_mobile/data/paged_list.dart';
import 'package:lifestyle_mobile/features/projects/data/project_model.dart';

class ProjectsRepository {
  const ProjectsRepository(this._api);

  final ApiClient _api;

  Future<List<Project>> listProjects() async {
    final items = await fetchAllPages(_api, 'projects');
    return items.map(Project.fromJson).toList(growable: false);
  }

  Future<Project> createProject(Map<String, Object?> fields) async {
    final response = jsonObject(
      await _api.post('projects', body: fields),
      'project',
    );
    return Project.fromJson(jsonObject(response['project'], 'project'));
  }

  /// [changes] may include `version` for optimistic concurrency.
  Future<Project> updateProject(String id, Map<String, Object?> changes) async {
    final response = jsonObject(
      await _api.patch('projects/$id', body: changes),
      'project',
    );
    return Project.fromJson(jsonObject(response['project'], 'project'));
  }

  Future<void> deleteProject(String id) async {
    await _api.delete('projects/$id');
  }
}
