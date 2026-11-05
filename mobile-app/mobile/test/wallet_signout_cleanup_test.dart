import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/money/data/wallet_ingest_token.dart';

import 'support/fake_secure_storage.dart';

class _EmptyTokens implements TokenStore {
  @override
  Future<SessionTokens?> read() async => null;
  @override
  Future<void> write(SessionTokens tokens) async {}
  @override
  Future<void> clear() async {}
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

class _SlowWalletStore implements WalletCredentialStore {
  _SlowWalletStore({this.fail = false});
  final bool fail;
  final clearStarted = Completer<void>();
  final finishClear = Completer<void>();
  bool cleared = false;

  @override
  Future<void> clear() async {
    clearStarted.complete();
    await finishClear.future;
    if (fail) throw StateError('wallet cleanup failed');
    cleared = true;
  }

  @override
  Future<void> clearIfMatches(String token) async {}
  @override
  Future<bool> hasTokenFor(String ownerId) async => false;
  @override
  Future<void> writeBound(String token, String ownerId) async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
      'wallet cleanup starts while logout is pending and its failure is reported',
      () async {
    FakeSecureStorage().install();

    Future<void> scenario({required bool fail}) async {
      final repo = _SlowLogoutRepository();
      final credentials = _SlowWalletStore(fail: fail);
      final container = ProviderContainer(overrides: [
        authRepositoryProvider.overrideWithValue(repo),
        walletCredentialStoreProvider.overrideWithValue(credentials),
      ]);
      addTearDown(container.dispose);
      await container.read(authProvider.future);
      final controller = container.read(authProvider.notifier);
      expect(controller.walletAccount, isNotNull);

      final signingOut = controller.signOut();
      // Attach an error handler before releasing either asynchronous operation.
      final expectation =
          fail ? expectLater(signingOut, throwsStateError) : null;
      expect(controller.walletAccount, isNull);
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
}
