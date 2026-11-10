import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = 'mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/';
const service = readFileSync(base + 'FocusShieldAccessibilityService.kt', 'utf8');
const bridge = readFileSync(base + 'FocusShieldBridge.kt', 'utf8');

test('lost Accessibility service stops its active shield instead of claiming enforcement', () => {
  const destroy = service.split('override fun onDestroy()')[1]?.split('    companion object')[0];
  assert.ok(destroy);
  assert.match(destroy, /instance === this/);
  assert.match(destroy, /stop\("accessibility_lost"\)/);
  assert.ok(destroy.indexOf('instance === this') < destroy.indexOf('stop("accessibility_lost")'));
});

test('native status and completion reconcile an inactive Accessibility connection', () => {
  assert.match(bridge, /private fun reconcileAccessibilityConnection\(/);
  for (const [start, end] of [['getShieldState', 'startShield'], ['stopShield', 'grantTemporaryBypass']]) {
    const block = bridge.split(`"${start}" -> {`)[1]?.split(`"${end}" -> {`)[0];
    assert.ok(block && block.includes('reconcileAccessibilityConnection()'), `${start} must reconcile`);
  }
  const detoxStatus = bridge.split('private fun detoxStatus(')[1].split('fun onPermissionResult(')[0];
  assert.ok(detoxStatus.includes('reconcileAccessibilityConnection()'));
});
