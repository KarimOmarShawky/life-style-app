import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/data/ai_task_parsing_pref.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';

class _Auth extends AuthController {
  _Auth(this._user);

  final AppUser? _user;

  @override
  Future<AppUser?> build() async => _user;
}

AppUser _user(String id) => AppUser.fromJson({
      'id': id,
      'email': '$id@example.test',
      'displayName': 'Mona',
      'timezone': 'Africa/Cairo',
      'locale': 'en',
      'defaultCurrency': 'EGP',
      'status': 'active',
    });

Future<bool> _aiParsing(AppUser? user) async {
  final container = ProviderContainer(
    overrides: [authProvider.overrideWith(() => _Auth(user))],
  );
  addTearDown(container.dispose);
  // Keep the providers alive while the account resolves.
  container.listen(aiTaskParsingProvider, (_, __) {});
  await container.read(authProvider.future);
  return container.read(aiTaskParsingProvider.future);
}

void main() {
  test('AI help for Smart Quick Add needs the opt-in and 18+ (D9)', () async {
    SharedPreferences.setMockInitialValues({
      'ai_task_parsing.v1.both': true,
      'ai_age_confirmed.v1.both': true,
      // Turned on before the 18+ question existed: parsed on the device.
      'ai_task_parsing.v1.legacy': true,
      'ai_age_confirmed.v1.adult': true,
    });

    expect(await _aiParsing(_user('both')), isTrue);
    expect(await _aiParsing(_user('legacy')), isFalse);
    expect(await _aiParsing(_user('adult')), isFalse);
    expect(await _aiParsing(_user('nobody')), isFalse);
    expect(await _aiParsing(null), isFalse);
  });

  test('Turning it on after confirming 18+ takes effect at once', () async {
    SharedPreferences.setMockInitialValues({
      'ai_age_confirmed.v1.adult': true,
    });
    final container = ProviderContainer(
      overrides: [authProvider.overrideWith(() => _Auth(_user('adult')))],
    );
    addTearDown(container.dispose);
    container.listen(aiTaskParsingProvider, (_, __) {});
    await container.read(authProvider.future);
    expect(await container.read(aiTaskParsingProvider.future), isFalse);

    await container.read(aiTaskParsingProvider.notifier).setEnabled(true);
    expect(container.read(aiTaskParsingProvider).valueOrNull, isTrue);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('ai_task_parsing.v1.adult'), isTrue);
  });
}
