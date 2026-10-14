import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';

/// Reads a cursor-paginated list (`{data: [...], meta: {nextCursor}}`) page by page.
///
/// [maxPages] bounds the number of requests, so a list can never loop forever.
Future<List<Map<String, dynamic>>> fetchAllPages(
  ApiClient api,
  String path, {
  Map<String, String>? query,
  int maxPages = 10,
  bool requireComplete = false,
}) async {
  final items = <Map<String, dynamic>>[];
  String? cursor;
  for (var page = 0; page < maxPages; page++) {
    final pageQuery = <String, String>{
      ...?query,
      'limit': '100',
      if (cursor != null) 'cursor': cursor,
    };
    final response = jsonObject(
      await api.get(path, query: pageQuery),
      '$path list',
    );
    items.addAll(jsonObjectList(response['data'], '$path list'));
    final meta = response['meta'];
    final next = meta is Map<String, dynamic> ? meta['nextCursor'] : null;
    if (next is! String || next.isEmpty) break;
    cursor = next;
    if (requireComplete && page == maxPages - 1) {
      throw StateError(
          'The result exceeds the safe pagination limit. Narrow the date range.');
    }
  }
  return items;
}
