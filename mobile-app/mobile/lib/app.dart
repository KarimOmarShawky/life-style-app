import 'package:lifestyle_mobile/features/digital_detox/detox_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/home_widget_sync.dart';
import 'package:lifestyle_mobile/features/more/presentation/daily_plan_screen.dart';
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
import 'package:lifestyle_mobile/features/onboarding/onboarding_screen.dart';
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
    if (authState.asData?.value != null) {
      ref.watch(homeWidgetSyncProvider);
      ref.watch(detoxProvider);
    }
    final rootPath = DeepLinkParser.routeFor(initialLocation);

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
      onGenerateRoute: _routeFor,
      // A cold start from a widget or notification link (also after process
      // death) always begins at the root page, which waits for the session
      // restore and then opens the linked screen (feature guide G3). Flutter
      // does not allow `home` together with this callback; '/' is served by
      // [_routeFor].
      onGenerateInitialRoutes: (_) => [
        MaterialPageRoute<void>(
          settings: const RouteSettings(name: Navigator.defaultRouteName),
          builder: (_) => _SessionPage(path: rootPath, root: true),
        ),
      ],
    );
  }

  Route<dynamic> _routeFor(RouteSettings settings) {
    final location = settings.name;
    final root = location == null || location == Navigator.defaultRouteName;
    final path = DeepLinkParser.routeFor(location);
    return MaterialPageRoute<void>(
      settings: RouteSettings(name: root ? Navigator.defaultRouteName : path),
      builder: (_) => _SessionPage(path: path, root: root),
    );
  }
}

/// Resolves the session for one page: waits while it is restored, shows
/// sign-in when signed out, first-run onboarding for a new account (root
/// page only) and otherwise the screen for [path]. The session is watched
/// here rather than captured when the route is created, so a page opened
/// from a link during start-up never keeps waiting after the restore.
class _SessionPage extends ConsumerWidget {
  const _SessionPage({required this.path, this.root = false});

  final String path;
  final bool root;

  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      ref.watch(authProvider).when(
            loading: () => const _LoadingPage(),
            data: (user) {
              if (user == null) return const AuthScreen();
              if (root && user.onboardingPending) {
                return OnboardingScreen(user: user);
              }
              return _authenticatedPage(user, path);
            },
            error: (error, _) {
              if (error is StateError) {
                return _ConfigurationError(message: error.message.toString());
              }
              return AuthScreen(errorMessage: _safeMessage(error));
            },
          );
}

Widget _authenticatedPage(AppUser user, String path) {
  if (path == '/daily-plan') return const DailyPlanScreen();
  if (path == '/profile') {
    return ProfileScreen(user: user);
  }
  int initialIndex = 0;
  if (path == '/habits') initialIndex = 1;
  if (path == '/ai') initialIndex = 2;
  if (path == '/notes') initialIndex = 3;
  if (path == '/focus') initialIndex = 4;
  return HomeShell(user: user, initialIndex: initialIndex);
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
