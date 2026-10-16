import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base = 'mobile-app/mobile/android/app/src/main/';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const native = (name) => read(`${base}kotlin/com/example/lifestyle_mobile/${name}.kt`);
const main = native('MainActivity'), service = native('VoiceRecordingService'), receiver = native('VoiceActionReceiver');

test('dead native Gemini credentials and HTTP/inline-audio branches are removed (source only)', () => {
  for (const source of [main, service]) {
    assert.ok(!/readGeminiApiKey|GEMINI_URL|HttpURLConnection|OutputStreamWriter|inlineData|X-goog-api-key|generativelanguage\.googleapis/.test(source));
  }
});

test('native voice entry points no longer record private temporary audio or encode files', () => {
  for (const source of [main, service]) {
    assert.ok(!/MediaRecorder|readBytes\(|Base64|dialog_voice\.m4a|lockscreen_voice\.m4a|cacheDir/.test(source));
  }
});

test('existing in-app speech channel and selected language are preserved, without recording fallback', () => {
  assert.ok(main.includes('com.example.lifestyle_mobile/native_voice') && main.includes('"startVoiceRecognition" ->'));
  assert.ok(main.includes('RecognizerIntent.ACTION_RECOGNIZE_SPEECH') && main.includes('RecognizerIntent.EXTRA_LANGUAGE, tag'));
  assert.ok(main.includes('startRecognizerIntent(result)'));
  assert.ok(!main.includes('startDirectMediaRecording') && !main.includes('stopAndTranscribeGemini'));
});

test('pending speech result has busy/cancel/dispose guards (source contract, not lifecycle execution)', () => {
  for (const marker of ['"VOICE_BUSY"', '"VOICE_CANCELLED"', 'resultCode == Activity.RESULT_OK', 'val pending = pendingVoiceResult ?: return', 'pending.success(text)']) {
    assert.ok(main.includes(marker));
  }
  assert.ok(main.includes('pendingVoiceResult = null'));
});

test('notification opens existing app rather than launching nonfunctional microphone service', () => {
  assert.ok(receiver.includes('Intent(context, MainActivity::class.java)'));
  assert.ok(!receiver.includes('startForegroundService') && !receiver.includes('VoiceRecordingService::class.java'));
  assert.ok(main.includes('no automatic voice alarm') && !main.includes('set alarm instantly'));
});

test('private legacy service is a non-recording compatibility entry, not a fake alarm success', () => {
  assert.ok(service.includes('CHANNEL_ID = "lifestyle_quick_input_channel"') && service.includes('NOTIFICATION_ID = 777'));
  assert.ok(service.includes('stopSelf()') && service.includes('START_NOT_STICKY'));
  assert.ok(!/scheduleAlarm\(|syncTaskToBackend\(|vibrateSuccess\(|Thread\s*\{/.test(service));
});

test('unneeded app recording capabilities and automatic microphone prompt are removed', () => {
  const manifest = read(`${base}AndroidManifest.xml`);
  assert.ok(!/RECORD_AUDIO|FOREGROUND_SERVICE_MICROPHONE|foregroundServiceType="microphone"/.test(manifest));
  assert.ok(!main.includes('Manifest.permission.RECORD_AUDIO'));
  assert.ok(manifest.includes('android:name=".VoiceRecordingService"') && manifest.includes('android:name=".VoiceActionReceiver"'));
});

test('existing alarm receiver and other shared channel consumers remain, no user data cleanup', () => {
  assert.ok(read(`${base}AndroidManifest.xml`).includes('android:name=".AlarmReceiver"'));
  assert.ok(native('AlarmReceiver').includes('class AlarmReceiver'));
  for (const marker of ['"hasWalletIngestToken"', '"requestSmsPermission"', '"refreshPinnedNotification"', 'accountArchiveBridge?.onActivityResult(', 'focusShieldBridge?.close()']) assert.ok(main.includes(marker));
  const dart = read('mobile-app/mobile/lib/features/tasks/presentation/tasks_screen.dart');
  assert.ok(dart.includes("'startVoiceRecognition'") && dart.includes("'languageTag'"));
});
