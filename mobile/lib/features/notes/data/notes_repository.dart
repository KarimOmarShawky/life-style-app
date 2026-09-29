import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/models.dart';

class NotesRepository {
  const NotesRepository(this._api);

  final ApiClient _api;

  Future<List<Note>> listNotes({String? tag}) async {
    final response = await _api.get(
      'notes',
      query: {if (tag != null) 'tag': tag},
    );
    if (response is! Map<String, dynamic> ||
        response['notes'] is! List<dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid notes list.',
      );
    }
    return (response['notes'] as List<dynamic>)
        .map((item) => Note.fromJson(item as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<Note> createNote({
    required String title,
    required String body,
    List<String> tags = const [],
  }) async {
    final response = await _api.post(
      'notes',
      body: {'title': title.trim(), 'body': body.trim(), 'tags': tags},
    );
    if (response is! Map<String, dynamic> ||
        response['note'] is! Map<String, dynamic>) {
      throw const ApiException(
        statusCode: 502,
        code: 'INVALID_API_RESPONSE',
        message: 'The server returned an invalid note.',
      );
    }
    return Note.fromJson(response['note'] as Map<String, dynamic>);
  }
}
