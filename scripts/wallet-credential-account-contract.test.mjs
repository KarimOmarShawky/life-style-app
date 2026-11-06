import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = 'mobile-app/mobile/';
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
  assert.ok(signOut.indexOf('retiredDataCleanupProvider') < signOut.indexOf('await _serializeAuth('));
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

test('retired wallet queues are not flushed or issued tokens by the home shell', () => {
  const home = readFileSync(root + 'lib/features/home/presentation/home_shell.dart', 'utf8');
  assert.ok(!home.includes('_flushWalletQueue'));
  assert.ok(!home.includes('_ensureWalletIngestToken'));
  assert.ok(!home.includes('PendingWalletTransactions('));
  assert.ok(!home.includes('PendingWalletCandidates('));
});
