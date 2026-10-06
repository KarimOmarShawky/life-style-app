import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/settings_provider.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/presentation/auth_screen.dart';
import 'package:lifestyle_mobile/features/auth/presentation/profile_screen.dart';
import 'package:lifestyle_mobile/features/home/presentation/home_shell.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
import 'package:lifestyle_mobile/navigation/deep_link_parser.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';

class LifeStyleApp extends ConsumerWidget {
  const LifeStyleApp({super.key, this.initialLocation});

  final String? initialLocation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final settings = ref.watch(settingsProvider);

    return MaterialApp(
      title: 'LifeStyle',
      debugShowCheckedModeBanner: false,
      locale: settings.locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      themeMode: settings.themeMode,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      onGenerateRoute: (settingsRoute) =>
          _routeFor(settingsRoute, authState, initialLocation),
      home: _authHome(authState),
    );
  }

  Widget _authHome(AsyncValue<AppUser?> authState) => authState.when(
    loading: () => const _LoadingPage(),
    data: (user) => user == null
        ? const AuthScreen()
        : _authenticatedPage(user, DeepLinkParser.routeFor(initialLocation)),
    error: (error, _) {
      if (error is StateError) {
        return _ConfigurationError(message: error.message.toString());
      }
      return AuthScreen(errorMessage: _safeMessage(error));
    },
  );

  Route<dynamic>? _routeFor(
    RouteSettings settings,
    AsyncValue<AppUser?> authState,
    String? initialLocation,
  ) {
    final location = settings.name ?? initialLocation;
    if (location == null || location == '/') return null;
    final path = DeepLinkParser.routeFor(location);
    return MaterialPageRoute<void>(
      settings: RouteSettings(name: path),
      builder: (_) => authState.when(
        loading: () => const _LoadingPage(),
        data: (user) =>
            user == null ? const AuthScreen() : _authenticatedPage(user, path),
        error: (error, _) => error is StateError
            ? _ConfigurationError(message: error.message.toString())
            : AuthScreen(errorMessage: _safeMessage(error)),
      ),
    );
  }

  Widget _authenticatedPage(AppUser user, String path) {
    if (path == '/profile') {
      return ProfileScreen(user: user);
    }
    int initialIndex = 0;
    if (path == '/habits') initialIndex = 1;
    if (path == '/ai') initialIndex = 2;
    if (path == '/money') initialIndex = 3;
    if (path == '/notes') initialIndex = 4;
    return HomeShell(user: user, initialIndex: initialIndex);
  }
}

class _LoadingPage extends StatelessWidget {
  const _LoadingPage();

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator()));
}

class _ConfigurationError extends StatelessWidget {
  const _ConfigurationError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(message, textAlign: TextAlign.center),
      ),
    ),
  );
}

String _safeMessage(Object error) {
  if (error is ApiException) return error.message;
  return 'Could not connect. Check your API configuration and try again.';
}
