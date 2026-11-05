import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = 'mobile-app/mobile/';
const dart = readFileSync(root + 'lib/features/money/data/wallet_ingest_token.dart', 'utf8');
const native = readFileSync(root + 'android/app/src/main/kotlin/com/example/lifestyle_mobile/MainActivity.kt', 'utf8');

test('the mobile ingest token uses the server-provided owner and does not reuse legacy credentials', () => {
  assert.ok(dart.includes("jsonString(response, 'ownerId')"));
  assert.ok(dart.includes('hasTokenFor(account)'));
  assert.ok(dart.includes('writeBound(token, ownerId)'));
  assert.ok(native.includes('credentials.readBound()?.ownerId'));
  assert.ok(native.includes('credentials.writeBound('));
});

test('sign out invalidates delayed ingest-token issuance before logout begins', () => {
  const auth = readFileSync(root + 'lib/features/auth/state/auth_provider.dart', 'utf8');
  const signOut = auth.split('  Future<void> signOut() async {')[1];
  assert.ok(auth.includes('String? get walletAccount => _signingOut ? null'));
  assert.ok(signOut.indexOf('_signingOut = true;') >= 0);
  assert.ok(signOut.indexOf('_signingOut = true;') < signOut.indexOf('authRepositoryProvider).logout()'));
  assert.ok(signOut.indexOf('WalletIngestToken.invalidatePending()') >= 0);
  assert.ok(signOut.indexOf('WalletIngestToken.invalidatePending()') < signOut.indexOf('authRepositoryProvider).logout()'));
});
