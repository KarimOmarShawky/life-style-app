/// Restricts external navigation intents to routes that exist in the MVP.
/// No query string or fragment is forwarded to a screen or written to logs.
abstract final class DeepLinkParser {
  static const _routes = {'/tasks', '/habits', '/money', '/notes', '/profile'};

  static String routeFor(String? rawLocation) {
    if (rawLocation == null || rawLocation.isEmpty || rawLocation == '/') {
      return '/tasks';
    }

    final uri = Uri.tryParse(rawLocation);
    if (uri == null) return '/tasks';

    String path;
    if (uri.scheme == 'lifestyle') {
      final hostPath = uri.host.isEmpty ? '' : '/${uri.host}';
      path = '$hostPath${uri.path}';
    } else if (uri.scheme.isEmpty) {
      path = uri.path;
    } else {
      return '/tasks';
    }

    final normalized = path.endsWith('/') && path.length > 1
        ? path.substring(0, path.length - 1)
        : path;
    return _routes.contains(normalized) ? normalized : '/tasks';
  }
}
