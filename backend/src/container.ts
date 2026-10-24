/**
 * src/container.ts
 *
 * Implements Section 4.4 & ADR-021: Composition root and manual dependency injection.
 * Wires concrete implementations to interfaces without runtime DI frameworks.
 */

import type pg from 'pg';
import { type Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import type { RequestHandler } from 'express';
import { getEnv } from './config/env.js';
import { getPgPool } from './infrastructure/database/postgres/pool.js';
import { getKyselyDb, type DatabaseSchema } from './infrastructure/database/postgres/kysely.js';
import {
  PgTransactionRunner,
  type TransactionRunner
} from './infrastructure/database/postgres/transaction-runner.js';
import { getRedisClient } from './infrastructure/redis/redis-client.js';
import {
  RedisRateLimiter,
  MemoryRateLimiter,
  type RateLimiter
} from './core/middleware/rate-limiter.js';
import { SystemClock, type Clock } from './core/time/clock.js';
import { UuidGenerator, type IdGenerator } from './core/security/id-generator.js';

// Security & Infrastructure
import { BcryptPasswordHasher, type PasswordHasher } from './core/security/password-hasher.js';
import { JoseTokenService, type TokenService } from './core/security/token-service.js';
import { PgSessionValidator, type SessionValidator } from './core/security/session-validator.js';
import { RedisOtpStore, type OtpStore } from './core/security/otp-service.js';
import { SmtpEmailSender, type EmailSender } from './infrastructure/external/email-sender.js';
import {
  PgAuditLogger,
  type AuditLogger
} from './infrastructure/database/postgres/audit-logger.js';
import { createAuthenticateMiddleware } from './core/middleware/authenticate.js';

// Auth Module
import { PgAuthRepository } from './features/auth/auth.repository.pg.js';
import type { AuthRepository } from './features/auth/auth.repository.js';
import { AuthService } from './features/auth/auth.service.js';
import { AuthController } from './features/auth/auth.controller.js';

// Users Module
import { PgUsersRepository } from './features/users/users.repository.pg.js';
import type { UsersRepository } from './features/users/users.repository.js';
import { UsersService } from './features/users/users.service.js';
import { UsersController } from './features/users/users.controller.js';

// Tasks Module
import { PgTasksRepository } from './features/tasks/tasks.repository.pg.js';
import type { TasksRepository } from './features/tasks/tasks.repository.js';
import { TasksService } from './features/tasks/tasks.service.js';
import { TasksController } from './features/tasks/tasks.controller.js';

// Projects Module
import { PgProjectsRepository } from './features/projects/projects.repository.pg.js';
import type { ProjectsRepository } from './features/projects/projects.repository.js';
import { ProjectsService } from './features/projects/projects.service.js';
import { ProjectsController } from './features/projects/projects.controller.js';

// Recurring Tasks Module
import { PgRecurringTasksRepository } from './features/recurring-tasks/recurring-tasks.repository.pg.js';
import type { RecurringTasksRepository } from './features/recurring-tasks/recurring-tasks.repository.js';
import { RecurringTasksService } from './features/recurring-tasks/recurring-tasks.service.js';
import { RecurringTasksController } from './features/recurring-tasks/recurring-tasks.controller.js';

// Timer Sessions Module
import { PgTimerSessionsRepository } from './features/timer-sessions/timer-sessions.repository.pg.js';
import type { TimerSessionsRepository } from './features/timer-sessions/timer-sessions.repository.js';
import { TimerSessionsService } from './features/timer-sessions/timer-sessions.service.js';
import { TimerSessionsController } from './features/timer-sessions/timer-sessions.controller.js';

// Habits Module
import { PgHabitsRepository } from './features/habits/habits.repository.pg.js';
import type { HabitsRepository } from './features/habits/habits.repository.js';
import { HabitsService } from './features/habits/habits.service.js';
import { HabitsController } from './features/habits/habits.controller.js';

// Calendar Module
import { PgCalendarRepository } from './features/calendar/calendar.repository.pg.js';
import type { CalendarRepository } from './features/calendar/calendar.repository.js';
import { CalendarService } from './features/calendar/calendar.service.js';
import { CalendarController } from './features/calendar/calendar.controller.js';

// Goals Module
import { PgGoalsRepository } from './features/goals/goals.repository.pg.js';
import { PgGoalsReader, type GoalsReader } from './features/goals/goals.reader.js';
import type { GoalsRepository } from './features/goals/goals.repository.js';
import { GoalsService } from './features/goals/goals.service.js';
import { GoalsController } from './features/goals/goals.controller.js';

// Notes Module
import { PgNotesRepository } from './features/notes/notes.repository.pg.js';
import type { NotesRepository } from './features/notes/notes.repository.js';
import { NotesService } from './features/notes/notes.service.js';
import { NotesController } from './features/notes/notes.controller.js';

// Money Module
import { PgMoneyRepository } from './features/money/money.repository.pg.js';
import type { MoneyRepository } from './features/money/money.repository.js';
import { MoneyService } from './features/money/money.service.js';
import { MoneyController } from './features/money/money.controller.js';
import { PgIngestTokenRepository } from './features/ingest/ingest.repository.pg.js';
import type { IngestTokenRepository } from './features/ingest/ingest.repository.js';
import { IngestService } from './features/ingest/ingest.service.js';
import { IngestController } from './features/ingest/ingest.controller.js';
import {
  GeminiSmsFallbackAnalyzer,
  type SmsTransactionAnalyzer
} from './features/ingest/sms-fallback-analyzer.js';
import {
  createIngestAuthenticateMiddleware,
  createIngestOrUserAuthenticateMiddleware
} from './core/middleware/authenticate-ingest.js';
// Unified Reminders: one reminders domain across task/habit/event/subscription parents
import { PgRemindersRepository } from './features/reminders/reminders.repository.pg.js';
import type { RemindersRepository } from './features/reminders/reminders.repository.js';
import { RemindersService } from './features/reminders/reminders.service.js';
// Background email queue (Section 11)
// Query-surface readers (P1-05, feature-architecture rule 2)
import { PgTaskReader, type TaskReader } from './features/tasks/tasks.reader.js';
import { PgHabitReader, type HabitReader } from './features/habits/habits.reader.js';
import { PgCalendarReader, type CalendarReader } from './features/calendar/calendar.reader.js';
import { PgMoneyReader, type MoneyReader } from './features/money/money.reader.js';
import {
  PgTimerReader,
  type TimerReader
} from './features/timer-sessions/timer-sessions.reader.js';
import { PgNotesReader, type NotesReader } from './features/notes/notes.reader.js';
import { PgProjectsReader, type ProjectsReader } from './features/projects/projects.reader.js';
// Query features (P1-05)
import { DaysService } from './features/days/days.service.js';
import { DashboardService } from './features/dashboard/dashboard.service.js';
import { SearchService } from './features/search/search.service.js';
import { PgPasswordResetRequestStore } from './features/auth/password-reset-request.repository.pg.js';
import type { ResetRequestStore } from './core/security/reset-request-store.js';

export interface AppContainer {
  clock: Clock;
  idGenerator: IdGenerator;
  pgPool: pg.Pool;
  db: Kysely<DatabaseSchema>;
  transactionRunner: TransactionRunner<DatabaseSchema>;
  redis: Redis;
  rateLimiter: RateLimiter;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  sessionValidator: SessionValidator;
  otpStore: OtpStore;
  emailSender: EmailSender;
  auditLogger: AuditLogger;
  authenticate: RequestHandler;
  authRepository: AuthRepository;
  authService: AuthService;
  authController: AuthController;
  usersRepository: UsersRepository;
  usersService: UsersService;
  usersController: UsersController;
  tasksRepository: TasksRepository;
  tasksService: TasksService;
  tasksController: TasksController;
  projectsRepository: ProjectsRepository;
  projectsService: ProjectsService;
  projectsController: ProjectsController;
  recurringTasksRepository: RecurringTasksRepository;
  recurringTasksService: RecurringTasksService;
  recurringTasksController: RecurringTasksController;
  timerSessionsRepository: TimerSessionsRepository;
  timerSessionsService: TimerSessionsService;
  timerSessionsController: TimerSessionsController;
  habitsRepository: HabitsRepository;
  habitsService: HabitsService;
  habitsController: HabitsController;
  calendarRepository: CalendarRepository;
  calendarService: CalendarService;
  calendarController: CalendarController;
  goalsRepository: GoalsRepository;
  goalsService: GoalsService;
  goalsController: GoalsController;
  notesRepository: NotesRepository;
  notesService: NotesService;
  notesController: NotesController;
  moneyRepository: MoneyRepository;
  moneyService: MoneyService;
  moneyController: MoneyController;
  ingestRepository: IngestTokenRepository;
  ingestService: IngestService;
  ingestController: IngestController;
  authenticateIngest: RequestHandler;
  authenticateIngestOrUser: RequestHandler;
  smsAnalyzer: SmsTransactionAnalyzer;
  daysService: DaysService;
  dashboardService: DashboardService;
  searchService: SearchService;
  remindersRepository: RemindersRepository;
  remindersService: RemindersService;
  resetRequestStore: ResetRequestStore;
}

let containerInstance: AppContainer | null = null;

export function buildContainer(overrides?: Partial<AppContainer>): AppContainer {
  if (containerInstance && !overrides) {
    return containerInstance;
  }

  const clock = overrides?.clock ?? new SystemClock();
  const idGenerator = overrides?.idGenerator ?? new UuidGenerator();
  const pgPool = overrides?.pgPool ?? getPgPool();
  const db = overrides?.db ?? getKyselyDb();
  const transactionRunner = overrides?.transactionRunner ?? new PgTransactionRunner(db);
  const redis = overrides?.redis ?? getRedisClient();

  const rateLimiter =
    overrides?.rateLimiter ??
    (process.env.NODE_ENV === 'test' ? new MemoryRateLimiter() : new RedisRateLimiter(redis));

  const passwordHasher = overrides?.passwordHasher ?? new BcryptPasswordHasher();
  const tokenService = overrides?.tokenService ?? new JoseTokenService();
  const sessionValidator = overrides?.sessionValidator ?? new PgSessionValidator(pgPool);
  const otpStore = overrides?.otpStore ?? new RedisOtpStore(redis);
  // Reset codes stay in worker-local memory, never in a persistent email queue.
  // Request admission uses AuthService's bounded, volatile in-process dispatcher.
  const emailSender = overrides?.emailSender ?? new SmtpEmailSender();
  const auditLogger = overrides?.auditLogger ?? new PgAuditLogger(pgPool);

  const authenticate =
    overrides?.authenticate ?? createAuthenticateMiddleware(tokenService, sessionValidator);

  const authRepository = overrides?.authRepository ?? new PgAuthRepository(pgPool);
  // Durable password-reset delivery (F-06): accepted work is persisted before
  // the API answers 202, then retried with backoff or dead-lettered, so a
  // crash, restart or forced shutdown can no longer silently drop it.
  const resetRequestStore = overrides?.resetRequestStore ?? new PgPasswordResetRequestStore(db);
  const authService =
    overrides?.authService ??
    new AuthService(
      authRepository,
      pgPool,
      passwordHasher,
      tokenService,
      otpStore,
      emailSender,
      auditLogger,
      {
        store: resetRequestStore,
        concurrency: 2,
        maxAttempts: 5,
        retryBackoffMs: 30_000
      }
    );
  const authController = overrides?.authController ?? new AuthController(authService);

  const usersRepository = overrides?.usersRepository ?? new PgUsersRepository(pgPool);
  const usersService =
    overrides?.usersService ?? new UsersService(usersRepository, auditLogger, passwordHasher);
  const usersController = overrides?.usersController ?? new UsersController(usersService);

  // Unified Reminders (FR-REM-01..06) — constructed before the feature services
  // because task/habit/subscription deletion cancels their pending reminders.
  const remindersRepository = overrides?.remindersRepository ?? new PgRemindersRepository(db);
  const remindersService = overrides?.remindersService ?? new RemindersService(remindersRepository);

  // Phase P4 Features
  const tasksRepository = overrides?.tasksRepository ?? new PgTasksRepository(db);
  const projectsRepository = overrides?.projectsRepository ?? new PgProjectsRepository(db);
  const recurringTasksRepository =
    overrides?.recurringTasksRepository ?? new PgRecurringTasksRepository(db);
  const timerSessionsRepository =
    overrides?.timerSessionsRepository ?? new PgTimerSessionsRepository(db);

  const tasksService =
    overrides?.tasksService ??
    new TasksService(tasksRepository, projectsRepository, clock, remindersRepository);
  const projectsService = overrides?.projectsService ?? new ProjectsService(projectsRepository, db);
  const recurringTasksService =
    overrides?.recurringTasksService ??
    new RecurringTasksService(recurringTasksRepository, projectsRepository, clock);
  const timerSessionsService =
    overrides?.timerSessionsService ??
    new TimerSessionsService(timerSessionsRepository, tasksRepository, clock);

  const tasksController = overrides?.tasksController ?? new TasksController(tasksService);
  const projectsController =
    overrides?.projectsController ?? new ProjectsController(projectsService);
  const recurringTasksController =
    overrides?.recurringTasksController ?? new RecurringTasksController(recurringTasksService);
  const timerSessionsController =
    overrides?.timerSessionsController ?? new TimerSessionsController(timerSessionsService);

  // Phase P5 Habits Feature
  const habitsRepository = overrides?.habitsRepository ?? new PgHabitsRepository(db);
  const habitsService =
    overrides?.habitsService ?? new HabitsService(habitsRepository, db, clock, remindersRepository);
  const habitsController = overrides?.habitsController ?? new HabitsController(habitsService);

  // Phase P6 Calendar Feature
  const calendarRepository = overrides?.calendarRepository ?? new PgCalendarRepository(db);
  const calendarService = overrides?.calendarService ?? new CalendarService(calendarRepository);
  const calendarController =
    overrides?.calendarController ?? new CalendarController(calendarService);

  // Phase P7 Goals Feature
  const goalsRepository = overrides?.goalsRepository ?? new PgGoalsRepository(db);
  const goalsService = overrides?.goalsService ?? new GoalsService(goalsRepository);
  const goalsController = overrides?.goalsController ?? new GoalsController(goalsService);

  // Phase P8 Notes Feature
  const notesRepository = overrides?.notesRepository ?? new PgNotesRepository(db);
  const notesService = overrides?.notesService ?? new NotesService(notesRepository);
  const notesController = overrides?.notesController ?? new NotesController(notesService);

  // Phase P9 Money Feature
  const moneyRepository = overrides?.moneyRepository ?? new PgMoneyRepository(db);
  const moneyService =
    overrides?.moneyService ?? new MoneyService(moneyRepository, remindersRepository);
  const moneyController = overrides?.moneyController ?? new MoneyController(moneyService);

  // Ingest tokens: background SMS capture without the short-lived access token
  const ingestRepository = overrides?.ingestRepository ?? new PgIngestTokenRepository(pgPool);
  // SMS fallback: Gemini behind this backend. The key is server-side only and is
  // never part of a client build; without it the fallback is simply disabled.
  const smsAnalyzerEnv = getEnv();
  const smsAnalyzer =
    overrides?.smsAnalyzer ??
    new GeminiSmsFallbackAnalyzer({
      apiKey: smsAnalyzerEnv.SMS_FALLBACK_GEMINI_KEY,
      model: smsAnalyzerEnv.SMS_FALLBACK_GEMINI_MODEL,
      timeoutMs: smsAnalyzerEnv.SMS_FALLBACK_TIMEOUT_MS
    });
  const ingestService =
    overrides?.ingestService ?? new IngestService(ingestRepository, smsAnalyzer);
  const ingestController = overrides?.ingestController ?? new IngestController(ingestService);
  const authenticateIngest =
    overrides?.authenticateIngest ??
    createIngestAuthenticateMiddleware(ingestRepository, sessionValidator);
  const authenticateIngestOrUser =
    overrides?.authenticateIngestOrUser ??
    createIngestOrUserAuthenticateMiddleware(authenticateIngest, authenticate);

  // Query-surface readers (P1-05) — read-only adapters per feature
  const taskReader: TaskReader = new PgTaskReader(db);
  const habitReader: HabitReader = new PgHabitReader(db);
  const calendarReader: CalendarReader = new PgCalendarReader(db);
  const moneyReader: MoneyReader = new PgMoneyReader(db);
  const timerReader: TimerReader = new PgTimerReader(db);
  const notesReader: NotesReader = new PgNotesReader(db);
  const projectsReader: ProjectsReader = new PgProjectsReader(db);
  const goalsReader: GoalsReader = new PgGoalsReader(db);

  const daysService = new DaysService(
    taskReader,
    habitReader,
    calendarReader,
    moneyReader,
    timerReader,
    clock
  );
  const dashboardService = new DashboardService(
    taskReader,
    habitReader,
    calendarReader,
    moneyReader,
    timerReader,
    clock
  );
  const searchService = new SearchService(
    taskReader,
    habitReader,
    calendarReader,
    notesReader,
    projectsReader,
    goalsReader,
    moneyReader
  );

  const container: AppContainer = {
    clock,
    idGenerator,
    pgPool,
    db,
    transactionRunner,
    redis,
    rateLimiter,
    passwordHasher,
    tokenService,
    sessionValidator,
    otpStore,
    emailSender,
    auditLogger,
    authenticate,
    authRepository,
    authService,
    authController,
    usersRepository,
    usersService,
    usersController,
    tasksRepository,
    tasksService,
    tasksController,
    projectsRepository,
    projectsService,
    projectsController,
    recurringTasksRepository,
    recurringTasksService,
    recurringTasksController,
    timerSessionsRepository,
    timerSessionsService,
    timerSessionsController,
    habitsRepository,
    habitsService,
    habitsController,
    calendarRepository,
    calendarService,
    calendarController,
    goalsRepository,
    goalsService,
    goalsController,
    notesRepository,
    notesService,
    notesController,
    moneyRepository,
    moneyService,
    moneyController,
    ingestRepository,
    ingestService,
    ingestController,
    authenticateIngest,
    authenticateIngestOrUser,
    smsAnalyzer,
    remindersRepository,
    remindersService,
    daysService,
    dashboardService,
    searchService,
    resetRequestStore
  };

  if (!overrides) {
    containerInstance = container;
  }

  return container;
}

export function getContainer(): AppContainer {
  if (!containerInstance) {
    return buildContainer();
  }
  return containerInstance;
}
