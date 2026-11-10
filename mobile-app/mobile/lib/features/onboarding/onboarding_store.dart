import 'package:shared_preferences/shared_preferences.dart';

/// Device-side record that an account finished or skipped first-run
/// onboarding (feature guide G1). The server flag is the source of truth;
/// this only covers the moment when it could not be saved, for example
/// offline. Keyed by account id; it holds no other data.
const String _onboardingDonePrefix = 'onboarding.done.v1.';

Future<bool> isOnboardingDoneLocally(String userId) async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getBool('$_onboardingDonePrefix$userId') ?? false;
}

Future<void> markOnboardingDoneLocally(String userId) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool('$_onboardingDonePrefix$userId', true);
}
