import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class SettingsState {
  const SettingsState({
    this.themeMode = ThemeMode.system,
    this.locale = const Locale('ar'),
  });

  final ThemeMode themeMode;
  final Locale locale;

  SettingsState copyWith({
    ThemeMode? themeMode,
    Locale? locale,
  }) {
    return SettingsState(
      themeMode: themeMode ?? this.themeMode,
      locale: locale ?? this.locale,
    );
  }
}

class SettingsNotifier extends StateNotifier<SettingsState> {
  SettingsNotifier() : super(const SettingsState()) {
    _loadSettings();
  }

  static const _themeKey = 'app_theme_mode';
  static const _localeKey = 'app_locale';

  /// Android's SharedPreferences store every Flutter key under a `flutter.`
  /// prefix, so the native side reads `flutter.lifestyle.api_base_url`.
  static const apiBaseKey = 'lifestyle.api_base_url';

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final themeStr = prefs.getString(_themeKey);
    final localeStr = prefs.getString(_localeKey);

    ThemeMode mode = ThemeMode.system;
    if (themeStr == 'dark') mode = ThemeMode.dark;
    if (themeStr == 'light') mode = ThemeMode.light;

    Locale loc;
    if (localeStr != null && localeStr.isNotEmpty) {
      loc = Locale(localeStr);
    } else {
      // First launch: honour the device language when the app ships a
      // catalog for it, otherwise fall back to Arabic (product default).
      final Locale device = WidgetsBinding.instance.platformDispatcher.locale;
      loc = AppLocalizations.isLocaleSupported(device)
          ? Locale(device.languageCode)
          : const Locale('ar');
    }
    if (!AppLocalizations.isLocaleSupported(loc)) {
      loc = const Locale('ar');
    }

    state = SettingsState(
      themeMode: mode,
      locale: loc,
    );
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = state.copyWith(themeMode: mode);
    final prefs = await SharedPreferences.getInstance();
    final modeStr = mode == ThemeMode.dark
        ? 'dark'
        : mode == ThemeMode.light
            ? 'light'
            : 'system';
    await prefs.setString(_themeKey, modeStr);
  }

  Future<void> setLocale(Locale loc) async {
    if (!AppLocalizations.isLocaleSupported(loc)) return;
    state = state.copyWith(locale: loc);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_localeKey, loc.languageCode);
  }
}

final settingsProvider = StateNotifierProvider<SettingsNotifier, SettingsState>(
  (ref) => SettingsNotifier(),
);
