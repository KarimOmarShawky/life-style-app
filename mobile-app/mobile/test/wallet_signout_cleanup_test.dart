import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';

import 'support/fake_secure_storage.dart';

class _EmptyTokens implements TokenStore {
  @override
  Future<SessionTokens?> read() async => null;
  @override
  Future<void> write(SessionTokens tokens) async {}
  @override
  Future<void> clear() async {}
}

class _MemoryTokens implements TokenStore {
  SessionTokens? tokens = SessionTokens(
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    accessTokenExpiresAt: DateTime.utc(2035),
    refreshTokenExpiresAt: DateTime.utc(2035),
  );

  @override
  Future<SessionTokens?> read() async => tokens;
  @override
  Future<void> write(SessionTokens value) async {
    tokens = value;
  }

  @override
  Future<void> clear() async {
    tokens = null;
  }
}

class _RealTransitionRepository extends AuthRepository {
  _RealTransitionRepository({required super.api, required super.tokens});

  @override
  Future<AppUser?> restoreSession() async => const AppUser(
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: 'account@example.test',
        displayName: 'Account',
        timezone: 'UTC',
        locale: 'en',
        defaultCurrency: 'EGP',
        status: 'active',
      );
}

class _SlowLogoutRepository extends AuthRepository {
  _SlowLogoutRepository()
      : super(
          api: ApiClient(
            baseUri: Uri.parse('https://api.example.test/api/v1/'),
            tokenStore: _EmptyTokens(),
          ),
          tokens: _EmptyTokens(),
        );

  final logoutStarted = Completer<void>();
  final finishLogout = Completer<void>();

  @override
  Future<AppUser?> restoreSession() async => const AppUser(
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: 'account@example.test',
        displayName: 'Account',
        timezone: 'UTC',
        locale: 'en',
        defaultCurrency: 'EGP',
        status: 'active',
      );

  @override
  Future<void> logout() async {
    logoutStarted.complete();
    await finishLogout.future;
  }
}

const _accountB = AppUser(
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'other@example.test',
  displayName: 'Other',
  timezone: 'UTC',
  locale: 'en',
  defaultCurrency: 'EGP',
  status: 'active',
);

class _RacingAuthRepository extends _SlowLogoutRepository {
  final loginStarted = Completer<void>();
  final finishLogin = Completer<AppUser>();

  @override
  Future<AppUser> login({required String email, required String password}) {
    loginStarted.complete();
    return finishLogin.future;
  }
}

class _RacingProfileRepository extends _RacingAuthRepository {
  final updateStarted = Completer<void>();
  final finishUpdate = Completer<AppUser>();

  @override
  Future<AppUser> updateProfile({
    String? displayName,
    String? timezone,
    String? defaultCurrency,
  }) {
    updateStarted.complete();
    return finishUpdate.future;
  }
}

class _RacingDeletionRepository extends _RacingAuthRepository {
  final actionStarted = Completer<void>();
  final finishAction = Completer<void>();
  var profileCalls = 0;

  @override
  Future<DateTime?> scheduleAccountDeletion(String currentPassword) async {
    actionStarted.complete();
    await finishAction.future;
    return null;
  }

  @override
  Future<void> cancelAccountDeletion() async {
    actionStarted.complete();
    await finishAction.future;
  }

  @override
  Future<AppUser> getProfile() async {
    profileCalls++;
    return _accountB;
  }
}

class _RacingRestoreRepository extends _SlowLogoutRepository {
  int restoreCalls = 0;
  final restoreStarted = Completer<void>();
  final finishRestore = Completer<AppUser?>();

  @override
  Future<AppUser?> restoreSession() {
    restoreCalls++;
    if (restoreCalls == 1) return super.restoreSession();
    restoreStarted.complete();
    return finishRestore.future;
  }
}

class _SlowCleanup {
  _SlowCleanup({this.fail = false});
  final bool fail;
  final clearStarted = Completer<void>();
  final finishClear = Completer<void>();
  bool cleared = false;

  Future<void> clear() async {
    clearStarted.complete();
    await finishClear.future;
    if (fail) throw StateError('wallet cleanup failed');
    cleared = true;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
      'wallet cleanup starts while logout is pending and its failure is reported',
      () async {
    FakeSecureStorage().install();

    Future<void> scenario({required bool fail}) async {
      final repo = _SlowLogoutRepository();
      final credentials = _SlowCleanup(fail: fail);
      final container = ProviderContainer(overrides: [
        authRepositoryProvider.overrideWithValue(repo),
        retiredDataCleanupProvider.overrideWithValue(credentials.clear),
        signOutAiServiceProvider.overrideWithValue(AiService.forTesting()),
      ]);
      addTearDown(container.dispose);
      await container.read(authProvider.future);
      final controller = container.read(authProvider.notifier);
      expect(controller.activeAccount, isNotNull);

      final signalBefore = container.read(authTransitionSignalProvider);
      final signingOut = controller.signOut();
      expect(container.read(authTransitionSignalProvider), signalBefore + 1);
      // Attach an error handler before releasing either asynchronous operation.
      final expectation =
          fail ? expectLater(signingOut, throwsStateError) : null;
      expect(controller.activeAccount, isNull);
      await repo.logoutStarted.future.timeout(const Duration(seconds: 1));
      // The network response has not returned, but cleanup must already run.
      await credentials.clearStarted.future.timeout(const Duration(seconds: 1));
      expect(credentials.cleared, isFalse);
      credentials.finishClear.complete();
      repo.finishLogout.complete();
      if (expectation != null) {
        await expectation;
        expect(credentials.cleared, isFalse);
      } else {
        await signingOut;
        expect(credentials.cleared, isTrue);
      }
      expect(container.read(authProvider).asData?.value, isNull);
    }

    await scenario(fail: false);
    await scenario(fail: true);
  });
  test('an old profile response cannot replace the new account', () async {
    final repo = _RacingProfileRepository();
    final container = ProviderContainer(overrides: [
      authRepositoryProvider.overrideWithValue(repo),
    ]);
    addTearDown(container.dispose);
    final accountA = (await container.read(authProvider.future))!;
    final auth = container.read(authProvider.notifier);
    final update = auth.updateCurrency('USD');
    final rejected = expectLater(update, throwsStateError);
    await repo.updateStarted.future.timeout(const Duration(seconds: 1));
    final login = auth.signIn(email: _accountB.email, password: 'password');
    await repo.loginStarted.future.timeout(const Duration(seconds: 1));
    repo.finishLogin.complete(_accountB);
    await login;
    repo.finishUpdate.complete(accountA);
    await rejected;
    expect(auth.activeAccount, _accountB.id);
    expect(container.read(authProvider).asData?.value?.id, _accountB.id);
  });

  test('stale deletion actions do not request a new account profile', () async {
    for (final cancel in [false, true]) {
      final repo = _RacingDeletionRepository();
      final container = ProviderContainer(overrides: [
        authRepositoryProvider.overrideWithValue(repo),
      ]);
      addTearDown(container.dispose);
      await container.read(authProvider.future);
      final auth = container.read(authProvider.notifier);
      final action = cancel
          ? auth.cancelAccountDeletion()
          : auth.scheduleAccountDeletion('password');
      final rejected = expectLater(action, throwsStateError);
      await repo.actionStarted.future.timeout(const Duration(seconds: 1));
      final login = auth.signIn(email: _accountB.email, password: 'password');
      await repo.loginStarted.future.timeout(const Duration(seconds: 1));
      repo.finishLogin.complete(_accountB);
      await login;
      repo.finishAction.complete();
      await rejected;
      expect(repo.profileCalls, 0);
      expect(auth.activeAccount, _accountB.id);
    }
  });

  test('profile work is superseded at login start even for the same account',
      () async {
    final repo = _RacingAuthRepository();
    final container = ProviderContainer(overrides: [
      authRepositoryProvider.overrideWithValue(repo),
    ]);
    addTearDown(container.dispose);
    final account = (await container.read(authProvider.future))!;
    final auth = container.read(authProvider.notifier);
    final originalGeneration = auth.sessionGeneration;
    final signalBefore = container.read(authTransitionSignalProvider);
    expect(auth.sessionIsCurrent(account.id, originalGeneration), isTrue);
    final login = auth.signIn(email: account.email, password: 'password');
    expect(container.read(authTransitionSignalProvider), signalBefore + 1);
    expect(auth.activeAccount, isNull);
    expect(auth.sessionIsCurrent(account.id, originalGeneration), isFalse);
    await repo.loginStarted.future.timeout(const Duration(seconds: 1));
    repo.finishLogin.complete(account);
    await login;
    expect(auth.activeAccount, account.id);
    expect(auth.sessionIsCurrent(account.id, originalGeneration), isFalse);
    expect(auth.sessionIsCurrent(account.id, auth.sessionGeneration), isTrue);
  });

  test('sign-out invalidates a pending login before it can publish an account',
      () async {
    FakeSecureStorage().install();
    final repo = _RacingAuthRepository();
    final credentials = _SlowCleanup();
    final container = ProviderContainer(overrides: [
      authRepositoryProvider.overrideWithValue(repo),
      retiredDataCleanupProvider.overrideWithValue(credentials.clear),
      signOutAiServiceProvider.overrideWithValue(AiService.forTesting()),
    ]);
    addTearDown(container.dispose);
    await container.read(authProvider.future);
    final auth = container.read(authProvider.notifier);

    final login =
        auth.signIn(email: 'other@example.test', password: 'password');
    await repo.loginStarted.future.timeout(const Duration(seconds: 1));
    final signOut = auth.signOut();
    expect(auth.activeAccount, isNull);
    await credentials.clearStarted.future.timeout(const Duration(seconds: 1));
    credentials.finishClear.complete();
    // Logout is serialized behind the already-started login, but wallet
    // cleanup began immediately and its result cannot become active in UI.
    expect(repo.logoutStarted.isCompleted, isFalse);
    repo.finishLogin.complete(_accountB);
    await login;
    expect(auth.activeAccount, isNull);
    await repo.logoutStarted.future.timeout(const Duration(seconds: 1));
    repo.finishLogout.complete();
    await signOut;
    expect(container.read(authProvider).asData?.value, isNull);
  });

  test('a later login waits until prior logout and its cleanup finish',
      () async {
    FakeSecureStorage().install();
    final repo = _RacingAuthRepository();
    final credentials = _SlowCleanup();
    final container = ProviderContainer(overrides: [
      authRepositoryProvider.overrideWithValue(repo),
      retiredDataCleanupProvider.overrideWithValue(credentials.clear),
      signOutAiServiceProvider.overrideWithValue(AiService.forTesting()),
    ]);
    addTearDown(container.dispose);
    await container.read(authProvider.future);
    final auth = container.read(authProvider.notifier);

    final signOut = auth.signOut();
    await repo.logoutStarted.future.timeout(const Duration(seconds: 1));
    await credentials.clearStarted.future.timeout(const Duration(seconds: 1));
    final login =
        auth.signIn(email: 'other@example.test', password: 'password');
    await Future<void>.delayed(Duration.zero);
    expect(repo.loginStarted.isCompleted, isFalse);
    repo.finishLogout.complete();
    // Logout cannot finish (and the queued login cannot start) before the
    // wallet cleanup's result has been accounted for.
    await Future<void>.delayed(Duration.zero);
    expect(repo.loginStarted.isCompleted, isFalse);
    credentials.finishClear.complete();
    await signOut;
    await repo.loginStarted.future.timeout(const Duration(seconds: 1));
    repo.finishLogin.complete(_accountB);
    await login;
    expect(auth.activeAccount, _accountB.id);
    expect(container.read(authProvider).asData?.value?.id, _accountB.id);
  });
  test('a pending restore cannot publish an account after sign-out starts',
      () async {
    FakeSecureStorage().install();
    final repo = _RacingRestoreRepository();
    final credentials = _SlowCleanup();
    final container = ProviderContainer(overrides: [
      authRepositoryProvider.overrideWithValue(repo),
      retiredDataCleanupProvider.overrideWithValue(credentials.clear),
      signOutAiServiceProvider.overrideWithValue(AiService.forTesting()),
    ]);
    addTearDown(container.dispose);
    await container.read(authProvider.future);
    final auth = container.read(authProvider.notifier);

    final restore = auth.retryRestore();
    await repo.restoreStarted.future.timeout(const Duration(seconds: 1));
    final signOut = auth.signOut();
    expect(auth.activeAccount, isNull);
    await credentials.clearStarted.future.timeout(const Duration(seconds: 1));
    credentials.finishClear.complete();
    expect(repo.logoutStarted.isCompleted, isFalse);
    repo.finishRestore.complete(_accountB);
    await restore;
    expect(auth.activeAccount, isNull);
    await repo.logoutStarted.future.timeout(const Duration(seconds: 1));
    repo.finishLogout.complete();
    await signOut;
    expect(container.read(authProvider).asData?.value, isNull);
  });
  test('real auth repository cannot clear a newer login behind an older logout',
      () async {
    FakeSecureStorage().install();
    final tokens = _MemoryTokens();
    final logoutStarted = Completer<void>();
    final finishLogout = Completer<void>();
    var loginCalls = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/auth/logout')) {
        expect(request.headers['authorization'], 'Bearer old-access');
        logoutStarted.complete();
        await finishLogout.future;
        return http.Response('', 204);
      }
      if (request.url.path.endsWith('/auth/login')) {
        loginCalls++;
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'user': {
                'id': _accountB.id,
                'email': _accountB.email,
                'displayName': _accountB.displayName,
                'timezone': _accountB.timezone,
                'locale': _accountB.locale,
                'defaultCurrency': _accountB.defaultCurrency,
                'status': _accountB.status,
              },
              'tokens': {
                'accessToken': 'new-access',
                'refreshToken': 'new-refresh',
                'accessTokenExpiresAt': '2035-01-01T00:00:00Z',
                'refreshTokenExpiresAt': '2035-01-01T00:00:00Z',
              },
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      throw StateError('unexpected endpoint');
    });
    addTearDown(client.close);
    final api = ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: tokens,
      httpClient: client,
    );
    final repo = _RealTransitionRepository(api: api, tokens: tokens);
    final credentials = _SlowCleanup();
    final container = ProviderContainer(overrides: [
      authRepositoryProvider.overrideWithValue(repo),
      retiredDataCleanupProvider.overrideWithValue(credentials.clear),
      signOutAiServiceProvider.overrideWithValue(AiService.forTesting()),
    ]);
    addTearDown(container.dispose);
    await container.read(authProvider.future);
    final auth = container.read(authProvider.notifier);
    final signOut = auth.signOut();
    await logoutStarted.future.timeout(const Duration(seconds: 1));
    await credentials.clearStarted.future.timeout(const Duration(seconds: 1));
    final login = auth.signIn(email: _accountB.email, password: 'password');
    await Future<void>.delayed(Duration.zero);
    expect(loginCalls, 0);
    credentials.finishClear.complete();
    finishLogout.complete();
    await signOut;
    await login;
    expect(loginCalls, 1);
    expect(tokens.tokens?.accessToken, 'new-access');
    expect(auth.activeAccount, _accountB.id);
  });
}
