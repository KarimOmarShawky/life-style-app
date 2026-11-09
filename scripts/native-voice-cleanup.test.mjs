import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const base = 'mobile-app/mobile/android/app/src/main/';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const nativePath = (name) => `${base}kotlin/com/example/lifestyle_mobile/${name}.kt`;
const main = read(nativePath('MainActivity'));

// The voice feature (in-app OS speech recognition, pinned quick-voice
// notification, speech-language setting) was removed entirely by owner
// decision after on-device testing. These tests pin the removal so the
// feature — and especially any recording capability — cannot silently
// come back.

test('native voice components are deleted, not merely disabled', () => {
  assert.ok(!existsSync(new URL(`../${nativePath('VoiceRecordingService')}`, import.meta.url)));
  assert.ok(!existsSync(new URL(`../${nativePath('VoiceActionReceiver')}`, import.meta.url)));
  const manifest = read(`${base}AndroidManifest.xml`);
  assert.ok(!manifest.includes('VoiceRecordingService') && !manifest.includes('VoiceActionReceiver'));
  assert.ok(!manifest.includes('RECORD_VOICE'));
});

test('MainActivity hosts no speech recognition or pinned quick-voice notification', () => {
  for (const marker of ['startVoiceRecognition', 'RecognizerIntent', 'VOICE_BUSY', 'VOICE_CANCELLED',
    'showNativePinnedNotification', 'quickVoice', 'EXTRA_QUICK_VOICE', 'PENDING_VOICE']) {
    assert.ok(!main.includes(marker), `unexpected voice remnant: ${marker}`);
  }
  // The one-time cleanup of the legacy pinned notification stays until it
  // has had a release cycle to clear stale notifications on devices.
  assert.ok(main.includes('LEGACY_QUICK_VOICE_NOTIFICATION_ID = 777'));
});

test('no recording capability exists anywhere in the native app', () => {
  const manifest = read(`${base}AndroidManifest.xml`);
  assert.ok(!/RECORD_AUDIO|FOREGROUND_SERVICE_MICROPHONE|foregroundServiceType="microphone"/.test(manifest));
  assert.ok(!/MediaRecorder|RecognizerIntent|SpeechRecognizer/.test(main));
});

test('unrelated native features on the shared bridge remain', () => {
  for (const marker of ['"cleanupRetiredWallet"', '"replaceSubscriptionReminders"',
    '"removeSubscriptionReminder"', '"clearSubscriptionReminders"',
    'accountArchiveBridge?.onActivityResult(', 'focusShieldBridge?.close()']) {
    assert.ok(main.includes(marker), `missing surviving bridge marker: ${marker}`);
  }
  assert.ok(read(`${base}AndroidManifest.xml`).includes('android:name=".AlarmReceiver"'));
  assert.ok(read(nativePath('AlarmReceiver')).includes('class AlarmReceiver'));
  const retired = read('mobile-app/mobile/lib/data/retired_wallet_cleanup.dart');
  const reminders = read('mobile-app/mobile/lib/features/money/data/subscription_reminders.dart');
  assert.ok(retired.includes('com.example.lifestyle_mobile/native_voice'));
  assert.ok(reminders.includes('com.example.lifestyle_mobile/native_voice'));
});

test('Dart side has no voice entry points left', () => {
  for (const file of ['mobile-app/mobile/lib/features/tasks/presentation/tasks_screen.dart',
    'mobile-app/mobile/lib/features/ai/presentation/ai_assistant_screen.dart',
    'mobile-app/mobile/lib/data/notification_service.dart',
    'mobile-app/mobile/lib/data/settings_provider.dart']) {
    const source = read(file);
    for (const marker of ['startVoiceRecognition', 'quickVoice', 'speechLanguage', 'native_voice',
      'showPinnedQuickInputNotification']) {
      assert.ok(!source.includes(marker), `${file} still references ${marker}`);
    }
  }
  assert.ok(!existsSync(new URL('../mobile-app/mobile/lib/l10n/speech_language.dart', import.meta.url)));
});
