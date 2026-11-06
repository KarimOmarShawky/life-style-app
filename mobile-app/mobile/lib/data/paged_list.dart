import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';

/// Reads a cursor-paginated list (`{data: [...], meta: {nextCursor}}`).
///
/// [maxPages] bounds network requests. With [requireComplete], malformed
/// metadata, repeated cursors or IDs and page-limit truncation fail closed.
/// A complete traversal is not a database snapshot under concurrent edits.
Future<List<Map<String, dynamic>>> fetchAllPages(
  ApiClient api,
  String path, {
  Map<String, String>? query,
  int maxPages = 10,
  bool requireComplete = false,
}) async {
  if (requireComplete && maxPages < 1) {
    throw ArgumentError.value(maxPages, 'maxPages');
  }
  final items = <Map<String, dynamic>>[];
  final seenCursors = <String>{};
  final seenIds = <String>{};
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
    final currentItems = jsonObjectList(response['data'], '$path list');
    if (requireComplete) {
      for (final item in currentItems) {
        final id = item['id'];
        if (id is! String || id.isEmpty || !seenIds.add(id)) {
          throw const FormatException('Invalid or duplicate paginated item');
        }
      }
    }
    items.addAll(currentItems);
    final meta = response['meta'];
    if (requireComplete &&
        (meta is! Map<String, dynamic> || !meta.containsKey('nextCursor'))) {
      throw const FormatException('Missing pagination metadata');
    }
    final next = meta is Map<String, dynamic> ? meta['nextCursor'] : null;
    if (next == null) break;
    if (next is! String || next.isEmpty) {
      if (requireComplete) {
        throw const FormatException('Invalid pagination cursor');
      }
      break;
    }
    if (requireComplete && (currentItems.isEmpty || !seenCursors.add(next))) {
      throw const FormatException('Invalid or repeated pagination cursor');
    }
    cursor = next;
    if (requireComplete && page == maxPages - 1) {
      throw StateError(
          'The result exceeds the safe pagination limit. Narrow the date range.');
    }
  }
  return items;
}
