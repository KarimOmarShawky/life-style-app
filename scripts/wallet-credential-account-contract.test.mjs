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
  assert.ok(auth.includes('if (_signingOut || _pendingWalletTransitions > 0) return null;'));
  assert.ok(signOut.indexOf('_signingOut = true;') >= 0);
  assert.ok(signOut.indexOf('_signingOut = true;') < signOut.indexOf('authRepositoryProvider).logout()'));
  assert.ok(signOut.indexOf('WalletIngestToken.invalidatePending()') >= 0);
  assert.ok(signOut.indexOf('WalletIngestToken.invalidatePending()') < signOut.indexOf('authRepositoryProvider).logout()'));
});

test('sign-out schedules wallet credential cleanup before awaiting remote logout', () => {
  const auth = readFileSync(root + 'lib/features/auth/state/auth_provider.dart', 'utf8');
  const signOut = auth.split('  Future<void> signOut() async {')[1].split('  Future<void> retryRestore()')[0];
  const start = signOut.indexOf('WalletIngestToken.clearLocal(');
  assert.ok(start >= 0);
  assert.ok(start < signOut.indexOf('authRepositoryProvider).logout()'));
  assert.equal(signOut.indexOf('WalletIngestToken.clearLocal(', start + 1), -1);
});

test('authentication transitions are serialized and sign-out supersedes older account results', () => {
  const auth = readFileSync(root + 'lib/features/auth/state/auth_provider.dart', 'utf8');
  assert.ok(auth.includes('Future<T> _serializeAuth<T>('));
  assert.ok(auth.includes('int _authGeneration = 0;'));
  const authenticate = auth.split('Future<void> _authenticate(')[1].split('Future<void> requestPasswordReset')[0];
  assert.ok(authenticate.includes('_serializeAuth('));
  assert.ok(authenticate.includes('generation != _authGeneration'));
  const signOut = auth.split('Future<void> signOut() async {')[1].split('Future<void> retryRestore()')[0];
  assert.ok(signOut.includes('_authGeneration++;'));
  assert.ok(signOut.includes('await _serializeAuth('));
  assert.ok(signOut.indexOf('WalletIngestToken.clearLocal(') < signOut.indexOf('await _serializeAuth('));
  const restore = auth.split('Future<void> retryRestore()')[1];
  assert.ok(restore.includes('_serializeAuth('));
  assert.ok(restore.includes('generation != _authGeneration'));
});

test('expired requests only retry after a known same-client token rotation', () => {
  const api = readFileSync(root + 'lib/data/api_client.dart', 'utf8');
  assert.ok(api.includes('_rotationSuccessors'));
  assert.ok(api.includes('_isRotationSuccessor('));
  assert.ok(api.includes("code: 'SESSION_CHANGED'"));
  const request = api.split('Future<Object?> request(')[1].split('Stream<List<int>> streamAccountArchive')[0];
  assert.ok(request.includes('_isRotationSuccessor('));
  assert.ok(request.indexOf('_isRotationSuccessor(') < request.lastIndexOf('response = await _send('));
  const rotate = api.split('Future<void> _rotate(')[1].split('Future<http.Response> _send(')[0];
  assert.ok(rotate.indexOf('_rotationSuccessors') > rotate.indexOf('_tokenStore.write('));
});

test('session transitions invalidate old client retries and suppress stale credential cleanup', () => {
  const api = readFileSync(root + 'lib/data/api_client.dart', 'utf8');
  const repo = readFileSync(root + 'lib/features/auth/data/auth_repository.dart', 'utf8');
  const auth = readFileSync(root + 'lib/features/auth/state/auth_provider.dart', 'utf8');
  const signOut = auth.split('Future<void> signOut() async {')[1].split('Future<void> retryRestore()')[0];
  assert.ok(signOut.indexOf('invalidateSessionRetries()') < signOut.indexOf('await _serializeAuth('));
  assert.ok(repo.includes("error.code != 'SESSION_CHANGED'"));
  const rotate = api.split('Future<void> _rotate(')[1].split('Future<http.Response> _send(')[0];
  assert.ok(rotate.indexOf('_sameTokenPair(latest, current)') < rotate.indexOf('_tokenStore.write(rotated)'));
  assert.ok(rotate.includes("error.code == 'SESSION_CHANGED'"));
  assert.ok(rotate.includes('generation == _sessionGeneration'));
  assert.ok(api.includes('_rotationSuccessors.clear()'));
});

test('wallet queue work is scoped to the observed auth-transition generation', () => {
  const auth = readFileSync(root + 'lib/features/auth/state/auth_provider.dart', 'utf8');
  const home = readFileSync(root + 'lib/features/home/presentation/home_shell.dart', 'utf8');
  const tx = readFileSync(root + 'lib/features/money/data/pending_wallet_transactions.dart', 'utf8');
  const candidates = readFileSync(root + 'lib/features/money/data/pending_wallet_reviews.dart', 'utf8');
  assert.ok(auth.includes('int _walletGeneration = 0;'));
  assert.ok(auth.includes('bool walletWorkIsCurrent('));
  assert.ok(home.includes('walletWorkIsCurrent('));
  assert.ok(home.includes('stillCurrent: stillCurrent'));
  assert.ok(tx.includes('on WalletWorkEnded'));
  assert.ok(candidates.includes('on WalletWorkEnded'));
  const txFlush = tx.split('Future<int> _flushCurrent()')[1].split('Future<void> _publishStorageFault')[0];
  const txSend = txFlush.indexOf('_repository.createTransaction(');
  assert.ok(txSend > 0);
  assert.ok(txFlush.lastIndexOf('_guard.check();', txSend) >= 0);
  assert.ok(txFlush.indexOf('_guard.check();', txSend) > txSend);
  const candidateFlush = candidates.split('class PendingWalletCandidates')[1].split('Future<CandidateDecision> _applyResult')[0];
  const analyze = candidateFlush.indexOf('_api.post(');
  assert.ok(analyze > 0);
  assert.ok(candidateFlush.lastIndexOf('_guard.check();', analyze) >= 0);
  assert.ok(candidateFlush.indexOf('_guard.check();', analyze) > analyze);
  const flush = home.split('Future<void> _flushWalletQueue()')[1].split('Widget build(')[0];
  assert.ok(flush.indexOf('if (!stillCurrent()) return;', flush.indexOf('PendingWalletTransactions(')) < flush.indexOf('PendingWalletCandidates('));
  const update = auth.split('Future<void> updateCurrency(')[1].split('Future<Map<String, dynamic>> exportUserData')[0];
  assert.ok(update.indexOf('_checkProfileWork(') < update.indexOf('state = AsyncData(updated)'));
});
