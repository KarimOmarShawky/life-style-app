import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/money/data/money_repository.dart';
import 'package:lifestyle_mobile/features/money/presentation/money_screen.dart';
import 'package:lifestyle_mobile/features/money/state/money_providers.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _account = AppUser(
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'account@example.test',
  displayName: 'Account',
  timezone: 'UTC',
  locale: 'en',
  defaultCurrency: 'EGP',
  status: 'active',
);

const _key = 'pending_wallet_review.one';
const _merchant = 'Synthetic review merchant';
const _message = 'Synthetic review message';

final _original = jsonEncode({
  'id': 'one',
  'kind': 'expense',
  'amount': '250.00',
  'currency': 'EGP',
  'occurredOn': '2026-10-08',
  'merchant': _merchant,
  'text': _message,
  'createdAt': 1,
});

class _Tokens implements TokenStore {
  @override
  Future<void> clear() async {}

  @override
  Future<SessionTokens?> read() async => SessionTokens(
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        accessTokenExpiresAt: DateTime.utc(2035),
        refreshTokenExpiresAt: DateTime.utc(2035),
      );

  @override
  Future<void> write(SessionTokens tokens) async {}
}

class _SlowAuthRepository extends AuthRepository {
  _SlowAuthRepository({required super.api, required super.tokens});

  final finishLogin = Completer<AppUser>();

  @override
  Future<AppUser?> restoreSession() async => _account;

  @override
  Future<AppUser> login({required String email, required String password}) =>
      finishLogin.future;
}

class _Fixture {
  _Fixture(this.container, this.authRepository);

  final ProviderContainer container;
  final _SlowAuthRepository authRepository;
  int requests = 0;
}

Future<_Fixture> _showReview(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues({'flutter.$_key': _original});
  final tokens = _Tokens();
  late _Fixture fixture;
  final api = ApiClient(
    baseUri: Uri.parse('https://api.example.test/api/v1/'),
    tokenStore: tokens,
    httpClient: MockClient((_) async {
      fixture.requests++;
      return http.Response('', 201);
    }),
  );
  final authRepository = _SlowAuthRepository(api: api, tokens: tokens);
  final container = ProviderContainer(overrides: [
    authRepositoryProvider.overrideWithValue(authRepository),
    moneyRepositoryProvider.overrideWithValue(MoneyRepository(api)),
    budgetsProvider.overrideWith((ref) async => []),
    subscriptionsProvider.overrideWith((ref) async => []),
  ]);
  fixture = _Fixture(container, authRepository);
  addTearDown(container.dispose);
  await container.read(authProvider.future);
  await tester.binding.setSurfaceSize(const Size(1200, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: const MaterialApp(home: MoneyScreen()),
  ));
  await tester.pumpAndSettle();
  expect(find.byIcon(Icons.rate_review_outlined), findsOneWidget);
  await tester.tap(find.byIcon(Icons.rate_review_outlined));
  await tester.pumpAndSettle();
  expect(find.text(_merchant), findsOneWidget);
  expect(find.textContaining(_message), findsOneWidget);
  return fixture;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an observed account transition hides the open review sheet',
      (tester) async {
    final fixture = await _showReview(tester);
    final auth = fixture.container.read(authProvider.notifier);
    final transition =
        auth.signIn(email: _account.email, password: 'synthetic');
    await tester.pump();
    expect(find.text(_merchant), findsNothing);
    expect(find.textContaining(_message), findsNothing);
    final l10n = const AppLocalizations(Locale('en'));
    expect(find.text(l10n.smsReviewDiscard), findsNothing);
    expect(find.text(l10n.smsReviewConfirm), findsNothing);
    expect(fixture.requests, 0);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(_key), _original);
    fixture.authRepository.finishLogin.complete(_account);
    await tester.pump();
    await transition;
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('a stale discard callback cannot remove the review',
      (tester) async {
    final fixture = await _showReview(tester);
    final l10n = const AppLocalizations(Locale('en'));
    final discard = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, l10n.smsReviewDiscard),
    );
    final callback = discard.onPressed!;
    final auth = fixture.container.read(authProvider.notifier);
    final transition =
        auth.signIn(email: _account.email, password: 'synthetic');
    // Simulate a tap already dispatched before Flutter rebuilds the sheet.
    callback();
    await tester.pumpAndSettle();
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(_key), _original);
    expect(fixture.requests, 0);
    fixture.authRepository.finishLogin.complete(_account);
    await tester.pump();
    await transition;
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('a stale confirm callback cannot send or remove the review',
      (tester) async {
    final fixture = await _showReview(tester);
    final l10n = const AppLocalizations(Locale('en'));
    final confirm = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, l10n.smsReviewConfirm),
    );
    final callback = confirm.onPressed!;
    final auth = fixture.container.read(authProvider.notifier);
    final transition =
        auth.signIn(email: _account.email, password: 'synthetic');
    callback();
    await tester.pumpAndSettle();
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(_key), _original);
    expect(fixture.requests, 0);
    fixture.authRepository.finishLogin.complete(_account);
    await tester.pump();
    await transition;
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });
}
