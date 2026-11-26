import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCALES, parseCatalog } from './check-l10n.mjs';

const read = (path) => readFileSync(path, 'utf8');
const mobile = 'mobile-app/mobile/';
const logoPath = 'assets/branding/livora_logo.png';

function pngSize(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('Livora is the display name in every shipped locale and the Android launch labels', () => {
  for (const locale of LOCALES) {
    const catalog = parseCatalog(read(`${mobile}lib/l10n/catalog_${locale}.dart`));
    assert.equal(catalog.get('appTitle'), locale === 'ar' ? 'ليفورا' : 'Livora', locale);
    for (const [key, value] of catalog) {
      assert.ok(!value.includes('LifeStyle'), `${locale}:${key} still carries the old brand`);
    }
  }
  assert.equal(JSON.parse(read(`${mobile}lib/l10n/app_en.arb`)).appTitle, 'Livora');
  assert.match(read(`${mobile}lib/app.dart`), /title: 'Livora'/);

  const gradle = read(`${mobile}android/app/build.gradle.kts`);
  assert.match(gradle, /manifestPlaceholders\["appLabel"\] = "Livora"/);
  assert.match(gradle, /manifestPlaceholders\["appLabel"\] = "Livora Validation"/);
  for (const folder of ['values', 'values-ar', 'values-de', 'values-es', 'values-fr', 'values-tr']) {
    const base = `${mobile}android/app/src/main/res/${folder}/`;
    for (const file of ['strings.xml', 'subscription_reminders.xml', 'widget_strings.xml']) {
      const path = base + file;
      let source;
      try {
        source = read(path);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const match of source.matchAll(/<string\b[^>]*>([\s\S]*?)<\/string>/g)) {
        assert.ok(!match[1].includes('LifeStyle'), path);
      }
    }
  }
});

test('the supplied Livora artwork is bundled and resized for every existing launcher density', () => {
  assert.match(read(`${mobile}pubspec.yaml`), /assets:\s*\n\s*- assets\/branding\/livora_logo\.png/);
  assert.match(read(`${mobile}lib/features/auth/presentation/auth_screen.dart`), /Image\.asset\(\s*'assets\/branding\/livora_logo\.png'/);
  assert.deepEqual(pngSize(`${mobile}${logoPath}`), { width: 800, height: 800 });
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    assert.deepEqual(
      pngSize(`${mobile}android/app/src/main/res/mipmap-${density}/ic_launcher.png`),
      { width: size, height: size },
      density
    );
  }
  assert.match(read(`${mobile}android/app/src/main/AndroidManifest.xml`), /android:icon="@mipmap\/ic_launcher"/);
});

test('the rename preserves package identity, deep links and notification channel IDs', () => {
  const gradle = read(`${mobile}android/app/build.gradle.kts`);
  assert.match(gradle, /namespace = "com\.example\.lifestyle_mobile"/);
  assert.match(gradle, /applicationId = "com\.lifestyle\.app"/);
  assert.match(gradle, /applicationIdSuffix = "\.validation"/);
  assert.match(read(`${mobile}pubspec.yaml`), /name: lifestyle_mobile/);
  assert.match(read(`${mobile}lib/app.dart`), /class LifeStyleApp extends ConsumerWidget/);
  const notifications = read(`${mobile}lib/data/notification_service.dart`);
  for (const id of ['lifestyle_real_alarm_channel', 'lifestyle_general_channel', 'lifestyle_calendar_reminders_channel']) {
    assert.ok(notifications.includes(`'${id}'`), id);
  }
});
