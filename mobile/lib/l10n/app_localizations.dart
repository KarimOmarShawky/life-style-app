import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// English-only MVP localization API. New locale classes and ARB catalogs can
/// be added without changing feature widgets.
class AppLocalizations {
  const AppLocalizations(this.locale);

  final Locale locale;

  static const supportedLocales = <Locale>[Locale('en')];
  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  static AppLocalizations of(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations)!;

  String get appTitle => 'LifeStyle';
  String get signIn => 'Sign in';
  String get createAccount => 'Create account';
  String get email => 'Email';
  String get password => 'Password';
  String get displayName => 'Display name';
  String get tasks => 'Tasks';
  String get profile => 'Profile';
  String get addTask => 'Add task';
  String get taskTitle => 'What needs to get done?';
  String get noTasks => 'No tasks yet';
  String get retry => 'Try again';
  String get signOut => 'Sign out';
  String get forgotPassword => 'Forgot password?';
  String get sendResetCode => 'Send reset code';
  String get resetCode => 'Six-digit reset code';
  String get newPassword => 'New password';
  String get cancel => 'Cancel';
  String get save => 'Save';
  String get errorTitle => 'Something went wrong';
  String get apiConfigError =>
      'The API address is not configured. Start the app with an API_BASE_URL build setting.';
  String get networkError =>
      'Could not connect. Check your connection and try again.';
  String get passwordLengthError =>
      'Use a password with at least 10 characters.';
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => locale.languageCode == 'en';

  @override
  Future<AppLocalizations> load(Locale locale) =>
      SynchronousFuture<AppLocalizations>(AppLocalizations(locale));

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}
