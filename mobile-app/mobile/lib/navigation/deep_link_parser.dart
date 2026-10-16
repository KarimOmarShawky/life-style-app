/// Restricts external navigation intents to routes that exist in the MVP.
/// Supports top-level routes and entity deep links `lifestyle://{section}/{id}`
/// where `{section}` is in the §10.3 allowlist and `{id}` is a valid UUID (§17.5).
/// No query string or fragment is forwarded to a screen or written to logs.
abstract final class DeepLinkParser {
  static const _routes = {
    '/tasks',
    '/habits',
    '/money',
    '/notes',
    '/profile',
    '/focus',
    '/daily-plan',
    '/ai',
  };

  static const Map<String, String> _entitySectionRoutes = {
    '/tasks': '/tasks',
    '/projects': '/tasks',
    '/goals': '/tasks',
    '/events': '/tasks',
    '/habits': '/habits',
    '/notes': '/notes',
    '/money/transactions': '/money',
    '/money/subscriptions': '/money',
  };

  static final RegExp _uuidPattern = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );

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
    if (_routes.contains(normalized)) {
      return normalized;
    }

    final lastSlash = normalized.lastIndexOf('/');
    if (lastSlash > 0) {
      final sectionPrefix = normalized.substring(0, lastSlash);
      final candidateId = normalized.substring(lastSlash + 1);
      final mappedRoute = _entitySectionRoutes[sectionPrefix];
      if (mappedRoute != null && _uuidPattern.hasMatch(candidateId)) {
        return mappedRoute;
      }
    }

    return '/tasks';
  }
}
