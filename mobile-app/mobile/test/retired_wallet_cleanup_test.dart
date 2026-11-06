import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/data/retired_wallet_cleanup.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  Future<void> noNativeCleanup() async {}

  test('removes only retired keys and retries safely', () async {
    SharedPreferences.setMockInitialValues({
      'pending_wallet_tx.one': 'old transaction',
      'pending_wallet_candidate.two': 'old candidate',
      'pending_wallet_review.three': 'old review',
      'pending_wallet_quarantine.four': 'old quarantine',
      'wallet_legacy_hold.five': 'hold',
      'wallet_tx_rejected.six': 'rejected',
      'lifestyle.wallet_ingest_token.v1': 'old token',
      'sms_sync_enabled': true,
      'wallet_trusted_senders': 'retired',
      'app_locale': 'ar',
      'subscription_reminders': 'keep',
      'pending_wallet_tx_extra': 'keep',
    });
    final prefs = await SharedPreferences.getInstance();
    var secureToken = 'old token';
    Future<void> deleteToken() async {
      secureToken = '';
    }

    expect(
        await RetiredWalletCleanup.run(
            deleteSecureToken: deleteToken, cleanupNative: noNativeCleanup),
        true);
    expect(secureToken, isEmpty);
    expect(prefs.getKeys().where(RetiredWalletCleanup.isRetiredKey), isEmpty);
    expect(prefs.getString('app_locale'), 'ar');
    expect(prefs.getString('subscription_reminders'), 'keep');
    expect(prefs.getString('pending_wallet_tx_extra'), 'keep');
    expect(
        await RetiredWalletCleanup.run(
            deleteSecureToken: deleteToken, cleanupNative: noNativeCleanup),
        true);
  });

  test('tries secure token even when preferences fail, then retries later',
      () async {
    var secureDeleted = false;
    expect(
      await RetiredWalletCleanup.run(
        cleanupNative: noNativeCleanup,
        preferences: () async => throw StateError('unavailable'),
        deleteSecureToken: () async {
          secureDeleted = true;
        },
      ),
      false,
    );
    expect(secureDeleted, true);
    SharedPreferences.setMockInitialValues({'pending_wallet_tx.one': 'old'});
    expect(
      await RetiredWalletCleanup.run(
          deleteSecureToken: () async {}, cleanupNative: noNativeCleanup),
      true,
    );
    expect((await SharedPreferences.getInstance()).getKeys(), isEmpty);
  });

  test('reports secure storage failure without undoing preference cleanup',
      () async {
    SharedPreferences.setMockInitialValues(
        {'pending_wallet_review.one': 'old'});
    expect(
      await RetiredWalletCleanup.run(
        cleanupNative: noNativeCleanup,
        deleteSecureToken: () async => throw StateError('unavailable'),
      ),
      false,
    );
    expect((await SharedPreferences.getInstance()).getKeys(), isEmpty);
  });

  test('reports a native cleanup failure and retries on the next call',
      () async {
    SharedPreferences.setMockInitialValues({});
    var attempts = 0;
    Future<void> nativeCleanup() async {
      attempts++;
      if (attempts == 1) throw StateError('unavailable');
    }

    expect(
      await RetiredWalletCleanup.run(
          deleteSecureToken: () async {}, cleanupNative: nativeCleanup),
      false,
    );
    expect(
      await RetiredWalletCleanup.run(
          deleteSecureToken: () async {}, cleanupNative: nativeCleanup),
      true,
    );
    expect(attempts, 2);
  });
}
