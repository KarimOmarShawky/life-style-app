import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = 'mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/';
const bridge = readFileSync(path + 'FocusShieldBridge.kt', 'utf8');

test('starting Focus Shield and Digital Detox requires a connected Accessibility service', () => {
  for (const [start, next] of [['startDetox', 'stopDetox'], ['startShield', 'stopShield']]) {
    const block = bridge.split(`"${start}" -> {`)[1]?.split(`"${next}" -> {`)[0];
    assert.ok(block, `${start} handler must exist`);
    const sharedGuard = block.indexOf('canStartAccessibilityShield()');
    const directGuard = block.indexOf('FocusShieldAccessibilityService.isConnected()');
    const guard = sharedGuard >= 0 ? sharedGuard : directGuard;
    const startCall = block.indexOf('store.start(');
    assert.ok(guard >= 0 && startCall > guard, `${start} must check service availability first`);
    if (sharedGuard < 0) {
      const permission = block.indexOf('permissionStatus()["accessibility"] == true');
      assert.ok(permission >= 0 && permission < startCall, `${start} must check permission first`);
    }
  }
  if (bridge.includes('canStartAccessibilityShield()')) {
    assert.match(bridge, /permissionStatus\(\)\["accessibility"\] == true,\s*FocusShieldAccessibilityService\.isConnected\(\)/);
  }
});
