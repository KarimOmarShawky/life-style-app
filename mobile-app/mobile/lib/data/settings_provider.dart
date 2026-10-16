import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class SettingsState {
  const SettingsState({
    this.themeMode = ThemeMode.system,
    this.locale = const Locale('en'),
    this.smsSyncEnabled = false,
  });

  final ThemeMode themeMode;
  final Locale locale;
  final bool smsSyncEnabled;

  SettingsState copyWith({
    ThemeMode? themeMode,
    Locale? locale,
    bool? smsSyncEnabled,
  }) {
    return SettingsState(
      themeMode: themeMode ?? this.themeMode,
      locale: locale ?? this.locale,
      smsSyncEnabled: smsSyncEnabled ?? this.smsSyncEnabled,
    );
  }
}

class SettingsNotifier extends StateNotifier<SettingsState> {
  SettingsNotifier() : super(const SettingsState()) {
    _loadSettings();
  }

  static const _themeKey = 'app_theme_mode';
  static const _localeKey = 'app_locale';
  static const _smsSyncKey = 'sms_sync_enabled';

  /// Android's SharedPreferences store every Flutter key under a `flutter.`
  /// prefix, so the native side reads these as:
  ///   `flutter.sms_sync_enabled` and `flutter.lifestyle.api_base_url`.
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
      // First launch: default to English per D-23 / ADR-043 unless an explicit
      // supported locale is configured.
      final Locale device = WidgetsBinding.instance.platformDispatcher.locale;
      loc = AppLocalizations.isLocaleSupported(device)
          ? Locale(device.languageCode)
          : const Locale('en');
    }
    if (!AppLocalizations.isLocaleSupported(loc)) {
      loc = const Locale('en');
    }

    final bool smsSync = prefs.getBool(_smsSyncKey) ?? false;

    state = SettingsState(
      themeMode: mode,
      locale: loc,
      smsSyncEnabled: smsSync,
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

  /// Toggles automatic wallet/banking SMS capture. The flag is persisted in
  /// SharedPreferences, which the native broadcast receiver reads as
  /// `flutter.sms_sync_enabled` — no running Flutter engine required.
  Future<void> setSmsSyncEnabled(bool enabled) async {
    state = state.copyWith(smsSyncEnabled: enabled);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_smsSyncKey, enabled);
  }
}

final settingsProvider = StateNotifierProvider<SettingsNotifier, SettingsState>(
  (ref) => SettingsNotifier(),
);
