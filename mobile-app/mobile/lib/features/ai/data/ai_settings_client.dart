import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';

/// Version of the consent text the app shows (`aiEgressDescription`,
/// Hybrid AI AI-2). Bump it together with that text in all six catalogs and
/// the server's `AI_EGRESS_CONSENT_VERSION`. The app only records the
/// version whose text it showed; the server rejects any other version.
const int aiEgressConsentVersion = 1;

/// The account's AI settings as far as the app uses them (AI-2c).
class AiSettingsSnapshot {
  const AiSettingsSnapshot({
    required this.consentVersion,
    required this.currentConsentVersion,
    required this.available,
  });

  /// Parses the `GET` / `PATCH /ai/settings` view. Throws a
  /// [FormatException] when the shape is not the expected one.
  factory AiSettingsSnapshot.fromJson(Object? json) {
    if (json is Map<String, dynamic>) {
      final settings = json['settings'];
      final current = json['currentConsentVersion'];
      final available = json['available'];
      if (settings is Map<String, dynamic> &&
          current is int &&
          available is bool) {
        final version = settings['egressConsentVersion'];
        return AiSettingsSnapshot(
          consentVersion: version is int ? version : null,
          currentConsentVersion: current,
          available: available,
        );
      }
    }
    throw const FormatException('Unexpected AI settings response');
  }

  /// The consent version stored for the account; null = never or withdrawn.
  final int? consentVersion;

  /// The consent version the server requires today.
  final int currentConsentVersion;

  /// False until the owner-run SQL has created the settings table; then
  /// nothing can be stored and app data cannot be used.
  final bool available;

  /// True when the account agreed to the consent text the server requires.
  bool get hasCurrentConsent =>
      available &&
      consentVersion != null &&
      consentVersion == currentConsentVersion;

  /// True when this app version shows the consent text the server requires,
  /// so it may record the user's agreement. An older app facing a newer
  /// consent version must not record a consent to a text it never showed.
  bool get canRecordConsent =>
      available && currentConsentVersion == aiEgressConsentVersion;

  /// True when app data may be offered: the current consent is stored, or
  /// this app can ask for it.
  bool get canUseAppData => hasCurrentConsent || canRecordConsent;
}

/// Reads and stores the durable AI consent (`/ai/settings`, AI-2).
abstract interface class AiSettingsClient {
  Future<AiSettingsSnapshot> fetch();

  /// Records the consent to [aiEgressConsentVersion] for the account.
  Future<AiSettingsSnapshot> grantConsent();

  /// Withdraws the stored consent; the assistant asks again before sending.
  Future<AiSettingsSnapshot> withdrawConsent();
}

class ApiAiSettingsClient implements AiSettingsClient {
  ApiAiSettingsClient(this._api);

  final ApiClient _api;

  @override
  Future<AiSettingsSnapshot> fetch() async =>
      AiSettingsSnapshot.fromJson(await _api.get('ai/settings'));

  @override
  Future<AiSettingsSnapshot> grantConsent() async =>
      AiSettingsSnapshot.fromJson(
        await _api.patch(
          'ai/settings',
          body: const <String, Object?>{
            'egressConsentVersion': aiEgressConsentVersion,
          },
        ),
      );

  @override
  Future<AiSettingsSnapshot> withdrawConsent() async =>
      AiSettingsSnapshot.fromJson(
        await _api.patch(
          'ai/settings',
          body: const <String, Object?>{'egressConsentVersion': null},
        ),
      );
}

final aiSettingsClientProvider = Provider<AiSettingsClient>(
  (ref) => ApiAiSettingsClient(ref.watch(apiClientProvider)),
);

/// Counts withdrawals of the stored AI consent made outside the assistant
/// (Profile). The assistant stays alive in the home shell, so it listens
/// and forgets the consent it had read.
class AiConsentRevision extends Notifier<int> {
  @override
  int build() => 0;

  void bump() => state++;
}

final aiConsentRevisionProvider = NotifierProvider<AiConsentRevision, int>(
  AiConsentRevision.new,
);
