import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/config/app_config.dart';

/// Opens an https page in the user's browser through an Android view intent
/// (MainActivity "openHttpsUrl"). No in-app browser and no extra package.
class ExternalLinkOpener {
  const ExternalLinkOpener();

  static const _channel =
      MethodChannel('com.example.lifestyle_mobile/native_voice');

  /// False when the link is not https or no app on the phone can open it.
  Future<bool> open(Uri link) async {
    final safe = AppConfig.httpsLinkOrNull(link.toString());
    if (safe == null) return false;
    try {
      await _channel.invokeMethod<void>(
        'openHttpsUrl',
        {'url': safe.toString()},
      );
      return true;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}

final externalLinkOpenerProvider = Provider<ExternalLinkOpener>(
  (ref) => const ExternalLinkOpener(),
);

/// The published privacy policy; null hides the Profile link.
final privacyPolicyUriProvider = Provider<Uri?>(
  (ref) => AppConfig.privacyPolicyUri,
);
