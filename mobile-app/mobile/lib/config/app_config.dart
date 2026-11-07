import 'package:flutter/foundation.dart';

/// Runtime configuration is provided at build/run time, never embedded as a
/// production credential or pointed at a developer's localhost by default.
abstract final class AppConfig {
  // The AI assistant runs through the backend proxy with a central
  // server-side key; the app never embeds or stores a provider key.

  // AUD-10: no production default — an unset API_BASE_URL must fail the
  // launch (see apiBaseUri) instead of silently sending dev/validation
  // traffic to the production host.
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL');

  static Uri get apiBaseUri {
    final configured = apiBaseUrl.trim();
    if (configured.isEmpty) {
      throw StateError(
        'API_BASE_URL is required. Pass --dart-define=API_BASE_URL=https://<api-host>/api/v1.',
      );
    }

    final uri = Uri.tryParse(configured);
    if (uri == null ||
        !uri.hasAuthority ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        !uri.path.replaceFirst(RegExp(r'/+$'), '').endsWith('/api/v1')) {
      throw StateError(
        'API_BASE_URL must be an absolute URL ending in /api/v1.',
      );
    }
    if (!kReleaseMode && uri.scheme != 'https' && uri.scheme != 'http') {
      throw StateError('API_BASE_URL must use HTTP(S).');
    }
    if (kReleaseMode && uri.scheme != 'https') {
      throw StateError('Release builds require an HTTPS API_BASE_URL.');
    }
    if (uri.query.isNotEmpty || uri.fragment.isNotEmpty) {
      throw StateError('API_BASE_URL must not contain a query or fragment.');
    }
    return uri.replace(
      path: uri.path.endsWith('/') ? uri.path : '${uri.path}/',
    );
  }
}
