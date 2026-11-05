import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/FocusShieldSessionStore.kt', 'utf8');

test('Focus Shield does not report a start or bypass after a failed persistence commit', () => {
  const start = source.split('    fun start(')[1].split('    fun stop(')[0];
  assert.match(start, /val saved = prefs\.edit\(\)/);
  assert.match(start, /if \(!saved\)/);
  assert.ok(start.indexOf('if (!saved)') < start.indexOf('scheduleExpiration(end)'));
  assert.match(start, /putBoolean\("active", false\)/);
  const bypass = source.split('    fun grantTemporaryBypass(')[1].split('    fun safePackages(')[0];
  assert.match(bypass, /val saved = prefs\.edit\(\)/);
  assert.match(bypass, /if \(!saved\)/);
  assert.ok(bypass.indexOf('if (!saved)') < bypass.indexOf('scheduleBypassRecheck'));
  assert.match(bypass, /remove\("tempBypassPackage"\)/);
});

test('Focus Shield cancels alarms and notifications before reporting a failed stop commit', () => {
  const stop = source.split('    fun stop(')[1].split('    private fun snapshotWithoutExpiry')[0];
  assert.match(stop, /val saved = prefs\.edit\(\)/);
  const cancellation = stop.indexOf('.cancel(expiryIntent())');
  const notification = stop.indexOf('.cancel(NOTIFICATION_ID)');
  const check = stop.indexOf('check(saved)');
  assert.ok(cancellation >= 0 && notification >= 0 && check > cancellation && check > notification);
});
