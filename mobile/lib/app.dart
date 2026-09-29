import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'data/api_client.dart';
import 'data/models.dart';
import 'l10n/app_localizations.dart';
import 'navigation/deep_link_parser.dart';
import 'state/providers.dart';
import 'ui/auth_screen.dart';
import 'ui/home_shell.dart';

class LifeStyleApp extends ConsumerWidget {
  const LifeStyleApp({super.key, this.initialLocation});

  final String? initialLocation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    return MaterialApp(
      title: 'LifeStyle',
      debugShowCheckedModeBanner: false,
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF315C4C)),
        useMaterial3: true,
      ),
      onGenerateRoute: (settings) =>
          _routeFor(settings, authState, initialLocation),
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
    // Flutter delivers native initial/universal-link routes through route
    // settings. Only the two allowlisted application destinations are routed.
    final location = settings.name ?? initialLocation;
    if (location == null || location == '/') return null;
    final path = DeepLinkParser.routeFor(location);
    return MaterialPageRoute<void>(
      // Do not propagate untrusted query/fragment input (which may contain
      // reset codes or other sensitive values) to RouteSettings or observers.
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
    int initialIndex = 0;
    if (path == '/habits') initialIndex = 1;
    if (path == '/money') initialIndex = 2;
    if (path == '/notes') initialIndex = 3;
    if (path == '/profile') initialIndex = 4;
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
