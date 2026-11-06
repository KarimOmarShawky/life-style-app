import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('mobile-app/mobile/lib/features/digital_detox/detox_session.dart', 'utf8');

test('a lost restriction cannot silently continue as an unenforced timer without consent', () => {
  const reconcile = source.split('  Future<void> _reconcile() async {')[1].split('  Future<void> pause()')[0];
  const query = reconcile.indexOf('observed = await enforcer.query(id)');
  const release = reconcile.indexOf('!await _release()', query);
  const consent = reconcile.indexOf('if (!allowUnenforced)', release);
  const fail = reconcile.indexOf('await _fail(', consent);
  const transition = reconcile.indexOf('await _move(actual)', consent);
  assert.ok(query >= 0 && release > query && consent > release && fail > consent && transition > fail);
  assert.ok(reconcile.includes('final focusExpired = endAt != null && !now().isBefore(endAt!)'));
  assert.ok(reconcile.includes("phase == 'focus' && !focusExpired"));
  const begin = source.split('  Future<void> _beginFocus(')[1].split('  DetoxState _focusState(')[0];
  assert.ok(begin.indexOf('!await _release()') < begin.indexOf('_move(_focusState(restriction))'));
  assert.ok(begin.indexOf('!allowUnenforced') < begin.indexOf('_move(_focusState(restriction))'));
});
