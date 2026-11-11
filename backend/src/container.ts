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

// Subscription Module (the retired financial implementations are not composed here)
import { PgSubscriptionRepository } from './features/money/subscription.repository.pg.js';
import type { SubscriptionRepository } from './features/money/subscription.repository.js';
import { SubscriptionService } from './features/money/subscription.service.js';
import { SubscriptionController } from './features/money/subscription.controller.js';
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
import { AnalyticsService } from './features/analytics/analytics.service.js';
import { SearchService } from './features/search/search.service.js';
// Content-free product events (feature guide G5)
import { ProductEventsService } from './features/product-events/product-events.service.js';
import { PgProductEventsRepository } from './features/product-events/product-events.repository.pg.js';
import { NotificationPreferencesService } from './features/notifications/notification-preferences.service.js';
import { PgNotificationPreferencesRepository } from './features/notifications/notification-preferences.repository.pg.js';
// Signed-in devices (feature guide G6, ADR-047)
import { SessionsService } from './features/sessions/sessions.service.js';
import { PgSessionsRepository } from './features/sessions/sessions.repository.pg.js';
import { PgPasswordResetRequestStore } from './features/auth/password-reset-request.repository.pg.js';
import type { ResetRequestStore } from './core/security/reset-request-store.js';
// AI assistant proxy (server-side Gemini, central key)
import { AiService } from './features/ai/ai.service.js';
import { FetchGeminiClient } from './features/ai/gemini-client.js';
import { getEnv } from './config/env.js';
import { logger } from './core/logger/logger.js';

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
  subscriptionRepository: SubscriptionRepository;
  subscriptionService: SubscriptionService;
  subscriptionController: SubscriptionController;
  daysService: DaysService;
  dashboardService: DashboardService;
  analyticsService: AnalyticsService;
  aiService: AiService;
  searchService: SearchService;
  productEventsService: ProductEventsService;
  notificationPreferencesService: NotificationPreferencesService;
  sessionsService: SessionsService;
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
  // Reset codes are persisted in the durable password-reset request store (F-06)
  // before delivery is attempted, so a crash or restart never loses accepted work.
  // Request admission uses AuthService's bounded, volatile in-process dispatcher;
  // the durable dispatcher (reset-request-dispatcher) drains what the API left behind.
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

  // Retain subscriptions without composing the retired financial service.
  const subscriptionRepository =
    overrides?.subscriptionRepository ?? new PgSubscriptionRepository(db);
  const subscriptionService =
    overrides?.subscriptionService ??
    new SubscriptionService(subscriptionRepository, remindersRepository);
  const subscriptionController =
    overrides?.subscriptionController ?? new SubscriptionController(subscriptionService);

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
  const analyticsService = new AnalyticsService(db, taskReader, habitReader, moneyReader, clock);

  // AI assistant proxy: the central Gemini key stays server-side. When the
  // kill switch is off or no key is configured the service is built without
  // a client and the /ai endpoints fail closed with 503 AI_DISABLED.
  const env = getEnv();
  const aiService =
    overrides?.aiService ??
    new AiService(
      env.GEMINI_API_KEY.trim() !== ''
        ? new FetchGeminiClient({
            apiKey: env.GEMINI_API_KEY,
            model: env.GEMINI_MODEL,
            timeoutMs: env.AI_UPSTREAM_TIMEOUT_MS
          })
        : null,
      env.AI_ENABLED
    );
  if (env.AI_ENABLED && env.GEMINI_API_KEY.trim() === '') {
    logger.warn('AI_ENABLED is true but GEMINI_API_KEY is not configured; AI endpoints disabled');
  }
  const productEventsService =
    overrides?.productEventsService ??
    new ProductEventsService(
      new PgProductEventsRepository(pgPool),
      clock,
      env.PRODUCT_EVENTS_ENABLED
    );
  const notificationPreferencesService =
    overrides?.notificationPreferencesService ??
    new NotificationPreferencesService(new PgNotificationPreferencesRepository(pgPool));
  const sessionsService =
    overrides?.sessionsService ??
    new SessionsService(
      new PgSessionsRepository(pgPool),
      (userId, currentPassword) => usersService.reauthenticate(userId, currentPassword),
      auditLogger
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
    subscriptionRepository,
    subscriptionService,
    subscriptionController,
    remindersRepository,
    remindersService,
    daysService,
    dashboardService,
    analyticsService,
    aiService,
    searchService,
    productEventsService,
    notificationPreferencesService,
    sessionsService,
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
