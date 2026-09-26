/**
 * src/container.ts
 *
 * Implements Section 4.4 & ADR-021: Composition root and manual dependency injection.
 * Wires concrete implementations to interfaces without runtime DI frameworks.
 */

import type pg from 'pg';
import type { Redis } from 'ioredis';
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
  const emailSender = overrides?.emailSender ?? new SmtpEmailSender();
  const auditLogger = overrides?.auditLogger ?? new PgAuditLogger(pgPool);

  const authenticate =
    overrides?.authenticate ?? createAuthenticateMiddleware(tokenService, sessionValidator);

  const authRepository = overrides?.authRepository ?? new PgAuthRepository(pgPool);
  const authService =
    overrides?.authService ??
    new AuthService(
      authRepository,
      pgPool,
      passwordHasher,
      tokenService,
      otpStore,
      emailSender,
      auditLogger
    );
  const authController = overrides?.authController ?? new AuthController(authService);

  const usersRepository = overrides?.usersRepository ?? new PgUsersRepository(pgPool);
  const usersService = overrides?.usersService ?? new UsersService(usersRepository, auditLogger);
  const usersController = overrides?.usersController ?? new UsersController(usersService);

  // Phase P4 Features
  const tasksRepository = overrides?.tasksRepository ?? new PgTasksRepository(db);
  const projectsRepository = overrides?.projectsRepository ?? new PgProjectsRepository(db);
  const recurringTasksRepository =
    overrides?.recurringTasksRepository ?? new PgRecurringTasksRepository(db);
  const timerSessionsRepository =
    overrides?.timerSessionsRepository ?? new PgTimerSessionsRepository(db);

  const tasksService =
    overrides?.tasksService ?? new TasksService(tasksRepository, projectsRepository, clock);
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
    timerSessionsController
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
