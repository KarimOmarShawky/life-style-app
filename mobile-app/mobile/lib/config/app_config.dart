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

  // Google Play requires a privacy-policy link inside the app. Signed builds
  // get the published page from CI (android-release variable
  // ANDROID_PRIVACY_POLICY_URL); the repository holds no URL. Without it the
  // Profile hides the link.
  static const privacyPolicyUrl = String.fromEnvironment('PRIVACY_POLICY_URL');

  static Uri? get privacyPolicyUri => httpsLinkOrNull(privacyPolicyUrl);

  /// The link as a plain absolute https URL, or null (other schemes, user
  /// info, spaces or more than 2048 characters).
  static Uri? httpsLinkOrNull(String raw) {
    final value = raw.trim();
    if (value.isEmpty ||
        value.length > 2048 ||
        value.contains(RegExp(r'[\s\x00-\x1f\x7f]'))) {
      return null;
    }
    final uri = Uri.tryParse(value);
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      return null;
    }
    return uri;
  }

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
