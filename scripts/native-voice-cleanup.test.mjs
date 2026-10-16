import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const babel = require('/usr/share/nodejs/@babel/core');
const presetTypescript = require('/usr/share/nodejs/@babel/preset-typescript');

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

// ============================================================================
// Production Readiness Audit Regression Suite (DEF-01..DEF-17 & Pure-TS Suites)
// ============================================================================

const DEFAULT_PINO_STUB = `
export default function pino(options = {}, destination) {
  const censor = options?.redact?.censor ?? '[REDACTED]';
  const secretKeys = new Set([
    'password','newPassword','currentPassword','refreshToken','accessToken',
    'token','code','otp','pushToken','password_hash','passwordHash','secret',
    'authorization','Authorization','cookie','Cookie','set-cookie','Set-Cookie',
    'apiKey','ingestToken','x-goog-api-key','X-Goog-Api-Key'
  ]);
  function redactObj(val, depth = 0) {
    if (!val || typeof val !== 'object' || depth > 3) return val;
    const out = Array.isArray(val) ? [] : {};
    for (const [k, v] of Object.entries(val)) {
      if (secretKeys.has(k)) out[k] = censor;
      else out[k] = redactObj(v, depth + 1);
    }
    return out;
  }
  function emit(level, a, b) {
    const meta = typeof a === 'object' && a !== null ? redactObj(a) : {};
    const msg = typeof a === 'string' ? a : b;
    const mixed = options.mixin ? options.mixin() : {};
    const line = JSON.stringify({ level, msg, ...mixed, ...meta }) + '\\n';
    if (destination && typeof destination.write === 'function') destination.write(line);
  }
  return {
    debug: (a, b) => emit('debug', a, b),
    info: (a, b) => emit('info', a, b),
    warn: (a, b) => emit('warn', a, b),
    error: (a, b) => emit('error', a, b),
    fatal: (a, b) => emit('fatal', a, b),
  };
}
pino.stdTimeFunctions = { isoTime: () => new Date().toISOString() };
`;

function createTranspiledBackendHarness(filesToTranspile, stubs = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'lifestyle-audit-ts-'));
  writeFileSync(join(tempRoot, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');

  const allStubs = {
    'node_modules/pino/package.json': JSON.stringify({ name: 'pino', type: 'module', main: 'index.js' }),
    'node_modules/pino/index.js': DEFAULT_PINO_STUB,
    ...stubs,
  };

  for (const [stubRelPath, stubContent] of Object.entries(allStubs)) {
    const outPath = join(tempRoot, stubRelPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, stubContent, 'utf8');
  }

  for (const relPath of filesToTranspile) {
    const srcPath = join(repoRoot, relPath);
    const code = readFileSync(srcPath, 'utf8');
    const result = babel.transformSync(code, {
      filename: srcPath,
      presets: [[presetTypescript, { allExtensions: true }]],
      retainLines: true,
    });
    const outRelPath = relPath.replace(/\.ts$/, '.js');
    const outPath = join(tempRoot, outRelPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, result.code, 'utf8');
  }

  return {
    tempRoot,
    async importModule(relJsPath) {
      const fullPath = join(tempRoot, relJsPath);
      return import(pathToFileURL(fullPath).href);
    },
    cleanup() {
      rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

test('DEF-01 / SEC-01: normalizeAuditRequestId and PgAuditLogger prevent UUID cast failures and preserve non-UUID clientRequestId', async (t) => {
  const harness = createTranspiledBackendHarness([
    'backend/src/core/logger/logger.ts',
    'backend/src/infrastructure/database/postgres/audit-logger.ts',
  ]);
  t.after(() => harness.cleanup());

  const { normalizeAuditRequestId, PgAuditLogger } = await harness.importModule(
    'backend/src/infrastructure/database/postgres/audit-logger.js',
  );

  const validUuid = '550e8400-e29b-41d4-a716-446655440000';
  const resValid = normalizeAuditRequestId(validUuid, { foo: 'bar' });
  assert.equal(resValid.uuidRequestId, validUuid);
  assert.deepEqual(resValid.metadata, { foo: 'bar' });

  const customCorrelationId = 'req-trace-non-uuid-12345';
  const resNonUuid = normalizeAuditRequestId(customCorrelationId, { ip: '127.0.0.1' });
  assert.equal(resNonUuid.uuidRequestId, null);
  assert.deepEqual(resNonUuid.metadata, {
    ip: '127.0.0.1',
    clientRequestId: customCorrelationId,
  });

  const executedQueries = [];
  const fakePool = {
    async query(sqlText, params) {
      executedQueries.push({ sqlText, params });
      return { rowCount: 1, rows: [] };
    },
  };

  const auditLogger = new PgAuditLogger(fakePool);
  await auditLogger.log({
    actorType: 'user',
    actorUserId: '11111111-1111-4111-8111-111111111111',
    action: 'auth.login',
    outcome: 'failure',
    entityType: 'user',
    entityId: '11111111-1111-4111-8111-111111111111',
    requestId: 'attacker-correlation-id-not-a-uuid',
    metadata: { reason: 'invalid_password' },
  });

  assert.equal(executedQueries.length, 1);
  assert.equal(executedQueries[0].params[7], null);
  assert.deepEqual(JSON.parse(executedQueries[0].params[10]), {
    reason: 'invalid_password',
    clientRequestId: 'attacker-correlation-id-not-a-uuid',
  });

  const moneyRepoSource = read('backend/src/features/money/money.repository.pg.ts');
  assert.ok(
    moneyRepoSource.includes('normalizeAuditRequestId(data.requestId, data.metadata)'),
    'PgMoneyRepository.insertAuditLogRow must normalize non-UUID requestId values before inserting into audit_logs',
  );
});

test('DEF-02 / SEC-02: PgUsersRepository.upsertPushDevice blocks cross-account push token hijacking with 409 CONFLICT', async (t) => {
  const harness = createTranspiledBackendHarness([
    'backend/src/core/errors/app-error.ts',
    'backend/src/features/users/account-archive.sources.ts',
    'backend/src/features/users/account-archive.ts',
    'backend/src/features/users/users.repository.pg.ts',
  ]);
  t.after(() => harness.cleanup());

  const { PgUsersRepository } = await harness.importModule(
    'backend/src/features/users/users.repository.pg.js',
  );

  const hijackedPool = {
    async query(sqlText) {
      assert.match(sqlText, /ON CONFLICT \(push_token\) DO UPDATE/);
      assert.match(sqlText, /WHERE push_devices\.user_id = EXCLUDED\.user_id/);
      return { rows: [], rowCount: 0 };
    },
  };
  const repoHijacked = new PgUsersRepository(hijackedPool);
  await assert.rejects(
    () =>
      repoHijacked.upsertPushDevice(
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        {
          platform: 'android',
          pushToken: 'shared-fcm-token-123456789012345',
        },
      ),
    (err) => {
      assert.equal(err.httpStatus, 409);
      assert.equal(err.code, 'CONFLICT');
      return true;
    },
  );
});

test('DEF-03 / SEC-03 & DEF-05: UsersController extracts req.id and PgUsersRepository.cancelDeletion enforces pending_deletion state', async (t) => {
  const harness = createTranspiledBackendHarness([
    'backend/src/core/errors/app-error.ts',
    'backend/src/features/users/account-archive.sources.ts',
    'backend/src/features/users/account-archive.ts',
    'backend/src/features/users/users.repository.pg.ts',
  ]);
  t.after(() => harness.cleanup());

  const { PgUsersRepository } = await harness.importModule(
    'backend/src/features/users/users.repository.pg.js',
  );

  const controllerSource = read('backend/src/features/users/users.controller.ts');
  assert.ok(
    controllerSource.includes('req.id ?? (req as unknown as { requestId?: string }).requestId'),
    'UsersController.extractMeta must read req.id set by requestContextMiddleware',
  );

  const queries = [];
  const activeUserPool = {
    async query(sqlText, params) {
      queries.push({ sqlText, params });
      return { rowCount: 0, rows: [] };
    },
  };

  const repo = new PgUsersRepository(activeUserPool);
  await assert.rejects(
    () => repo.cancelDeletion('11111111-1111-4111-8111-111111111111'),
    (err) => {
      assert.equal(err.httpStatus, 409);
      assert.equal(err.code, 'NOT_PENDING_DELETION');
      return true;
    },
  );
  assert.match(queries[0].sqlText, /AND status = 'pending_deletion'/);
});

test('DEF-04 / SEC-04: MoneyService validates currency exponent on updateTransaction, updateSubscription, paySubscription, and updateBudget', () => {
  const moneyServiceSource = read('backend/src/features/money/money.service.ts');
  const moneyValidationSource = read('backend/src/features/money/money.validation.ts');

  assert.ok(
    moneyServiceSource.includes("function assertCurrencyScale(amount: string, currency: string, field = 'amount'): void"),
    'MoneyService must define assertCurrencyScale helper',
  );
  assert.ok(
    moneyServiceSource.includes("assertCurrencyScale(effectiveAmount, effectiveCurrency, 'amount')"),
    'MoneyService must validate monetary precision when amount or currency is updated',
  );
  assert.ok(
    moneyServiceSource.includes("assertCurrencyScale(input.amount, sub.currency, 'amount')"),
    'MoneyService.paySubscription must validate override amount against subscription currency exponent',
  );
  assert.ok(
    moneyServiceSource.includes("assertCurrencyScale(input.amountLimit, existing.currency, 'amountLimit')"),
    'MoneyService.updateBudget must validate limitAmount against budget currency exponent',
  );

  assert.ok(
    !moneyValidationSource.includes('{3})?$'),
    'Category hex color regex must not accept 3-char hex codes that violate PostgreSQL CHECK constraint',
  );
  assert.match(moneyValidationSource, /\^#\[A-Fa-f0-9\]\{6\}\$/);
});

test('DEF-06: PgTasksRepository.list encodes and filters keyset cursors using the active sort column', () => {
  const tasksRepoSource = read('backend/src/features/tasks/tasks.repository.pg.ts');
  assert.ok(
    tasksRepoSource.includes("filter.sort === 'dueDate'") &&
      tasksRepoSource.includes("filter.sort === 'priority'") &&
      tasksRepoSource.includes("filter.sort === 'updatedAt'"),
    'PgTasksRepository.list must handle dueDate, priority, and updatedAt cursor pagination',
  );
  assert.ok(
    tasksRepoSource.includes('dueDate: dueDateStr') &&
      tasksRepoSource.includes('priority: lastItem.priority'),
    'PgTasksRepository.list nextCursor payload must include dueDate, priority, and updatedAt fields',
  );
});

test('DEF-07: TimerSessionsService.stopTimer clamps endedAt to startedAt + 1ms when stopped within the same millisecond', async (t) => {
  const harness = createTranspiledBackendHarness(
    [
      'backend/src/core/errors/app-error.ts',
      'backend/src/features/timer-sessions/timer-sessions.dto.ts',
      'backend/src/features/timer-sessions/timer-sessions.service.ts',
    ],
    {
      'backend/src/features/timer-sessions/timer-sessions.validation.js': 'export {};',
    },
  );
  t.after(() => harness.cleanup());

  const { TimerSessionsService } = await harness.importModule(
    'backend/src/features/timer-sessions/timer-sessions.service.js',
  );

  const sameInstant = new Date('2026-10-16T12:00:00.500Z');
  let capturedEndDate = null;

  const fakeTimerRepo = {
    async findById(_userId, sessionId) {
      return {
        id: sessionId,
        user_id: '11111111-1111-4111-8111-111111111111',
        task_id: null,
        mode: 'stopwatch',
        planned_seconds: null,
        started_at: sameInstant,
        ended_at: null,
        end_reason: null,
        created_at: sameInstant,
        updated_at: sameInstant,
      };
    },
    async stop(_userId, sessionId, endedAt, endReason) {
      capturedEndDate = endedAt;
      return {
        id: sessionId,
        user_id: '11111111-1111-4111-8111-111111111111',
        task_id: null,
        mode: 'stopwatch',
        planned_seconds: null,
        started_at: sameInstant,
        ended_at: endedAt,
        end_reason: endReason,
        created_at: sameInstant,
        updated_at: endedAt,
      };
    },
  };

  const fakeTasksRepo = {};
  const fakeClock = { now: () => sameInstant };

  const service = new TimerSessionsService(fakeTimerRepo, fakeTasksRepo, fakeClock);
  const dto = await service.stopTimer(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  );

  assert.ok(capturedEndDate instanceof Date);
  assert.ok(
    capturedEndDate.getTime() > sameInstant.getTime(),
    'ended_at must be strictly greater than started_at to satisfy PostgreSQL CHECK (ended_at > started_at)',
  );
  assert.equal(dto.durationSeconds, 0);
});

test('DEF-08 & DEF-09: PgNotesRepository escapes LIKE wildcards, validation schemas enforce .strict(), and PgProjectsRepository cancels reminders on cascade delete', () => {
  const notesRepoSource = read('backend/src/features/notes/notes.repository.pg.ts');
  assert.ok(
    notesRepoSource.includes('literalContainsPattern(filter.q)'),
    'PgNotesRepository.listNotes must escape LIKE wildcards via literalContainsPattern',
  );
  assert.ok(
    notesRepoSource.includes("ESCAPE '\\\\'"),
    'PgNotesRepository.listNotes must specify ESCAPE clause for LIKE patterns',
  );

  for (const file of [
    'backend/src/features/notes/notes.validation.ts',
    'backend/src/features/goals/goals.validation.ts',
    'backend/src/features/reminders/reminders.validation.ts',
    'backend/src/features/days/days.validation.ts',
    'backend/src/features/search/search.validation.ts',
  ]) {
    const content = read(file);
    assert.ok(content.includes('.strict()'), `${file} must enforce .strict() on request schemas`);
  }

  const recurringValidationSource = read(
    'backend/src/features/recurring-tasks/recurring-tasks.validation.ts',
  );
  assert.ok(
    recurringValidationSource.includes('.max(365)') &&
      recurringValidationSource.includes('endDate and occurrenceLimit are mutually exclusive') &&
      recurringValidationSource.includes('Recurrence fields must match frequency'),
    'recurrenceDefinitionSchema must enforce interval <= 365 and frequency-specific column constraints',
  );

  const projectsRepoSource = read('backend/src/features/projects/projects.repository.pg.ts');
  assert.ok(
    projectsRepoSource.includes('UPDATE reminders') &&
      projectsRepoSource.includes("SET status = 'cancelled', next_attempt_at = NULL"),
    'PgProjectsRepository.softDelete must cancel pending/processing task reminders when cascading project deletion',
  );
});

test('DEF-11 / SEC-05 & DEF-12 / SEC-06: AndroidManifest and SmsTransactionReceiver security controls', () => {
  const manifest = read('mobile-app/mobile/android/app/src/main/AndroidManifest.xml');
  const voiceReceiverMatch = manifest.match(
    /<receiver\s+android:name="\.VoiceActionReceiver"\s+android:exported="([^"]+)"/,
  );
  assert.ok(voiceReceiverMatch, 'VoiceActionReceiver must be declared in AndroidManifest.xml');
  assert.equal(
    voiceReceiverMatch[1],
    'false',
    'VoiceActionReceiver must not be exported to third-party apps without permission',
  );

  const smsReceiver = read(
    'mobile-app/mobile/android/app/src/main/kotlin/com/example/lifestyle_mobile/SmsTransactionReceiver.kt',
  );
  assert.ok(
    smsReceiver.includes('NotificationCompat.VISIBILITY_PRIVATE'),
    'SmsTransactionReceiver notifications must use VISIBILITY_PRIVATE to protect lock-screen financial privacy',
  );
  assert.ok(
    !smsReceiver.includes('bigText("$text\\n${tx.rawMessage}")'),
    'SmsTransactionReceiver must not render raw SMS bodies in high-priority lock-screen notifications',
  );
  assert.ok(
    smsReceiver.includes('isTrustedApiBase(configuredBase)'),
    'SmsTransactionReceiver must validate that custom API base URLs use HTTPS or local loopback before sending bearer tokens',
  );
});

test('DEF-13..DEF-17: Flutter recurring task form, subscriptions math, controller disposal, focus timer safety, password length, and deep links', () => {
  const recurringForm = read(
    'mobile-app/mobile/lib/features/recurring/presentation/recurring_task_form_screen.dart',
  );
  assert.ok(
    recurringForm.includes("'byMonthDay': effectiveMonthDay") &&
      recurringForm.includes("'byMonth': effectiveMonth") &&
      recurringForm.includes('number > 365'),
    'RecurringTaskFormScreen must send byMonthDay/byMonth for monthly/yearly rules and cap interval at 365',
  );

  const subscriptionsScreen = read(
    'mobile-app/mobile/lib/features/money/presentation/subscriptions_screen.dart',
  );
  assert.ok(
    subscriptionsScreen.includes("s.status == 'active'") &&
      subscriptionsScreen.includes('sumAmountsByCurrency') &&
      !subscriptionsScreen.includes('4.33'),
    'SubscriptionsScreen must sum active subscriptions per currency using DecimalAmount and monthlyEquivalent',
  );

  const notesScreen = read(
    'mobile-app/mobile/lib/features/notes/presentation/notes_screen.dart',
  );
  assert.ok(
    notesScreen.includes('titleController.dispose();') &&
      notesScreen.includes('bodyController.dispose();') &&
      notesScreen.includes('tagsController.dispose();') &&
      notesScreen.includes('confirmDismiss:'),
    'NotesScreen must dispose dialog TextEditingControllers and confirm/catch Dismissible deletions',
  );

  const taskModel = read('mobile-app/mobile/lib/features/tasks/data/task_model.dart');
  assert.ok(
    taskModel.includes('bool operator ==(Object other)') &&
      taskModel.includes('int get hashCode => id.hashCode;'),
    'Task model must implement id-based equality for DropdownButtonFormField stability',
  );

  const focusTimer = read(
    'mobile-app/mobile/lib/features/timer/presentation/focus_timer_screen.dart',
  );
  assert.ok(
    focusTimer.includes('LayoutBuilder') &&
      focusTimer.includes('SingleChildScrollView') &&
      focusTimer.includes('t.id == _selectedTask?.id'),
    'FocusTimerScreen must guard selectedTask membership and wrap layout in SingleChildScrollView',
  );

  const forgotPassword = read(
    'mobile-app/mobile/lib/features/auth/presentation/forgot_password_screen.dart',
  );
  assert.ok(
    forgotPassword.includes('newPassword.length < 10 || newPassword.length > 128'),
    'ForgotPasswordScreen must enforce the 10..128 character password policy matching the backend',
  );

  const deepLinkParser = read('mobile-app/mobile/lib/navigation/deep_link_parser.dart');
  assert.ok(
    deepLinkParser.includes("'/ai'"),
    'DeepLinkParser._routes must include /ai so lifestyle://ai deep links are reachable',
  );
});

test('Existing Backend Unit Suite Execution: recurrence-engine, streaks-engine, sms-sanitizer, ingest-token, clock-money-pagination, calendar-conflict, and logger-redaction', async (t) => {
  const harness = createTranspiledBackendHarness([
    'backend/src/core/errors/app-error.ts',
    'backend/src/core/time/clock.ts',
    'backend/src/core/time/date-utils.ts',
    'backend/src/core/pagination/cursor.ts',
    'backend/src/core/pagination/search-pattern.ts',
    'backend/src/core/logger/logger.ts',
    'backend/src/core/security/ingest-token.ts',
    'backend/src/core/security/refresh-token.ts',
    'backend/src/features/recurring-tasks/recurrence-engine.ts',
    'backend/src/features/habits/streaks-engine.ts',
    'backend/src/features/ingest/sms-sanitizer.ts',
  ]);
  t.after(() => harness.cleanup());

  const { computeOccurrences } = await harness.importModule(
    'backend/src/features/recurring-tasks/recurrence-engine.js',
  );
  const { getScheduledDates, computeStreaks } = await harness.importModule(
    'backend/src/features/habits/streaks-engine.js',
  );
  const { sanitizeSmsText, sanitizeSmsSender } = await harness.importModule(
    'backend/src/features/ingest/sms-sanitizer.js',
  );
  const { generateIngestToken, hashIngestToken, isIngestTokenFormat } =
    await harness.importModule('backend/src/core/security/ingest-token.js');
  const { encodeCursor, decodeCursor } = await harness.importModule(
    'backend/src/core/pagination/cursor.js',
  );
  const { getDayBoundsUtc } = await harness.importModule(
    'backend/src/core/time/date-utils.js',
  );
  const { createLogger } = await harness.importModule(
    'backend/src/core/logger/logger.js',
  );

  const monthlyOccurrences = computeOccurrences(
    {
      freq: 'monthly',
      interval: 1,
      byWeekday: null,
      byMonthDay: 31,
      byMonth: null,
      startDate: '2026-01-31',
      endDate: null,
      occurrenceLimit: 3,
    },
    '2026-01-01',
    '2026-04-30',
  );
  assert.deepEqual(monthlyOccurrences, ['2026-01-31', '2026-02-28', '2026-03-31']);

  const scheduled = getScheduledDates(
    {
      freq: 'daily',
      interval: 1,
      byWeekday: null,
      byMonthDay: null,
      byMonth: null,
      startDate: '2026-10-10',
      endDate: null,
    },
    '2026-10-16',
  );
  const streaks = computeStreaks(
    scheduled,
    new Map([
      ['2026-10-14', 'done'],
      ['2026-10-15', 'done'],
      ['2026-10-16', 'done'],
    ]),
    '2026-10-16',
  );
  assert.equal(streaks.currentStreak, 3);
  assert.equal(streaks.longestStreak, 3);

  const sanitized = sanitizeSmsText(
    'CIB: Debited EGP 250.00 from card 4111222233334444 ref 9876543210 on 16/10',
  );
  assert.ok(!sanitized.includes('4111222233334444'));
  assert.ok(sanitized.includes('250.00'));
  assert.equal(sanitizeSmsSender('+201012345678'), '[PHONE]');

  const { token, tokenHash } = generateIngestToken();
  assert.equal(isIngestTokenFormat(token), true);
  assert.equal(isIngestTokenFormat(`${token}x`), false);
  assert.equal(hashIngestToken(token).equals(tokenHash), true);

  const cursor = encodeCursor({ timestamp: '2026-10-16T00:00:00.000Z', id: '550e8400-e29b-41d4-a716-446655440000' });
  assert.deepEqual(decodeCursor(cursor), {
    timestamp: '2026-10-16T00:00:00.000Z',
    id: '550e8400-e29b-41d4-a716-446655440000',
  });
  assert.throws(() => decodeCursor('not-valid-base64-json'));

  const bounds = getDayBoundsUtc('2026-10-16', 'Africa/Cairo');
  assert.ok(bounds.startOfDayUtc instanceof Date && bounds.endOfDayUtc instanceof Date);
  assert.ok(bounds.endOfDayUtc.getTime() > bounds.startOfDayUtc.getTime());

  const chunks = [];
  const testLogger = createLogger({
    write(chunk) {
      chunks.push(String(chunk));
    },
  });
  testLogger.info(
    {
      password: 'super-secret-password',
      refreshToken: 'secret-refresh-token',
      nested: { authorization: 'Bearer secret-jwt' },
    },
    'test redaction',
  );
  const logOutput = chunks.join('');
  assert.ok(!logOutput.includes('super-secret-password'));
  assert.ok(!logOutput.includes('secret-refresh-token'));
  assert.ok(!logOutput.includes('Bearer secret-jwt'));
  assert.ok(logOutput.includes('[REDACTED]'));
});


test('Final Specification Compliance (D-22, D-23, D-24, §6.4/§6.5, §10.3/§17.5, §14.1/§14.3)', async () => {
  // 1. D-22 / ADR-042: processReminderDispatch respects pushShowTitles and entityTitle
  const harness = createTranspiledBackendHarness(['backend/src/jobs/job-processors.ts']);
  try {
    const { processReminderDispatch } = await harness.importModule('backend/src/jobs/job-processors.js');
  const now = new Date('2026-10-16T12:00:00.000Z');
  const sentPayloads = [];
  const pushSender = {
    isAvailable: () => true,
    send: async (userId, title, body) => {
      sentPayloads.push({ userId, title, body });
    }
  };
  const emailSender = {
    sendPasswordResetEmail: async () => undefined,
    sendReminderEmail: async () => undefined
  };
  const emails = { findEmails: async () => new Map() };
  const reminderStore = {
    cancelOrphans: async () => 0,
    claimDue: async () => [
      {
        id: 'rem-show',
        userId: 'user-1',
        entityType: 'task',
        entityId: 'task-1',
        channel: 'push',
        remindAt: now,
        attemptCount: 1,
        pushShowTitles: true,
        entityTitle: 'Submit quarterly report'
      },
      {
        id: 'rem-hide',
        userId: 'user-2',
        entityType: 'task',
        entityId: 'task-2',
        channel: 'push',
        remindAt: now,
        attemptCount: 1,
        pushShowTitles: false,
        entityTitle: 'Private medical appointment'
      }
    ],
    markSent: async () => undefined,
    markRetry: async () => undefined,
    markFailed: async () => undefined
  };

  const dispatchRes = await processReminderDispatch(
    { now: () => now },
    reminderStore,
    emails,
    emailSender,
    pushSender
  );
  assert.equal(dispatchRes.sent, 2);
  assert.deepEqual(sentPayloads, [
    { userId: 'user-1', title: 'Reminder', body: 'Submit quarterly report' },
    { userId: 'user-2', title: 'Reminder', body: 'You have a reminder' }
  ]);
  } finally {
    harness.cleanup();
  }

  // 2. D-23 / ADR-043: Flutter SettingsState defaults to Locale('en') and supportedLocales starts with Locale('en')
  const settingsProviderDart = read('mobile-app/mobile/lib/data/settings_provider.dart');
  assert.match(settingsProviderDart, /this\.locale = const Locale\('en'\)/);
  assert.doesNotMatch(settingsProviderDart, /const Locale\('ar'\)/);

  const appLocalizationsDart = read('mobile-app/mobile/lib/l10n/app_localizations.dart');
  assert.match(
    appLocalizationsDart,
    /supportedLocales = <Locale>\[\s*Locale\('en'\),/
  );

  // 3. D-22 Mobile: AppUser parses pushShowTitles (default true) & weekStart (default 1)
  const userModelDart = read('mobile-app/mobile/lib/features/auth/data/user_model.dart');
  assert.match(userModelDart, /this\.pushShowTitles = true/);
  assert.match(userModelDart, /pushShowTitles: \(json\['pushShowTitles'\] as bool\?\) \?\? true/);

  // 4. §6.4 & §6.5 Habits validation: description <= 2000, interval <= 365, daily rejects byWeekday
  const habitsValSrc = read('backend/src/features/habits/habits.validation.ts');
  assert.match(habitsValSrc, /\.max\(2000,\s*\{\s*message:\s*'Description must not exceed 2000 characters'\s*\}\)/);
  assert.match(habitsValSrc, /interval:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(365\)\.default\(1\)/);

  // 5. §1.4.2 (FR-DAY-04) & §14.1: dayParamSchema enforces 2000-01-01..2100-12-31
  const daysValSrc = read('backend/src/features/days/days.validation.ts');
  assert.match(daysValSrc, /2000-01-01/);
  assert.match(daysValSrc, /2100-12-31/);

  // 6. §10.3 & §17.5: DeepLinkParser validates lifestyle://{section}/{uuid}
  const deepLinkDart = read('mobile-app/mobile/lib/navigation/deep_link_parser.dart');
  assert.match(deepLinkDart, /'\/money\/transactions': '\/money'/);
  assert.match(deepLinkDart, /_uuidPattern/);
});
