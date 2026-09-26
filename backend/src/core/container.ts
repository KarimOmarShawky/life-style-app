/**
 * Composition root (spec section 5).
 *
 * The ONE place where interfaces are bound to concrete implementations. Nothing
 * else in the application constructs a BcryptPasswordHasher or a JwtTokenService,
 * which is what keeps the dependency inversion real rather than decorative: swap
 * a line here and the whole application uses the replacement.
 *
 * Built lazily and memoized so tests can construct their own instances with
 * fakes without this file's side effects.
 */
import { config } from '@/config';
import { BcryptPasswordHasher, type PasswordHasher } from '@/core/security/password-hasher';
import { JwtTokenService, type TokenService } from '@/core/security/token-service';
import { AuthService } from '@/features/auth/auth.service';
import { AuthController } from '@/features/auth/auth.controller';
import { ProjectService } from '@/features/projects/project.service';
import { ProjectController } from '@/features/projects/project.controller';
import { TaskService } from '@/features/tasks/task.service';
import { TaskController } from '@/features/tasks/task.controller';
import { NoteService } from '@/features/notes/note.service';
import { NoteController } from '@/features/notes/note.controller';
import { HabitService } from '@/features/habits/habit.service';
import { HabitController } from '@/features/habits/habit.controller';
import { GoalService } from '@/features/goals/goal.service';
import { GoalController } from '@/features/goals/goal.controller';
import { ExpenseService } from '@/features/money/expense.service';
import { SubscriptionService } from '@/features/money/subscription.service';
import { BudgetService } from '@/features/money/budget.service';
import {
  BudgetController,
  ExpenseController,
  SubscriptionController,
} from '@/features/money/money.controller';
import { EventService } from '@/features/schedule/event.service';
import { ReminderService } from '@/features/schedule/reminder.service';
import { EventController, ReminderController } from '@/features/schedule/schedule.controller';
import { DashboardService } from '@/features/dashboard/dashboard.service';
import { DashboardController } from '@/features/dashboard/dashboard.controller';

export interface Container {
  readonly passwordHasher: PasswordHasher;
  readonly tokenService: TokenService;
  readonly authService: AuthService;
  readonly authController: AuthController;
  readonly projectService: ProjectService;
  readonly projectController: ProjectController;
  readonly taskService: TaskService;
  readonly taskController: TaskController;
  readonly noteService: NoteService;
  readonly noteController: NoteController;
  readonly habitService: HabitService;
  readonly habitController: HabitController;
  readonly goalService: GoalService;
  readonly goalController: GoalController;
  readonly expenseService: ExpenseService;
  readonly expenseController: ExpenseController;
  readonly subscriptionService: SubscriptionService;
  readonly subscriptionController: SubscriptionController;
  readonly budgetService: BudgetService;
  readonly budgetController: BudgetController;
  readonly eventService: EventService;
  readonly eventController: EventController;
  readonly reminderService: ReminderService;
  readonly reminderController: ReminderController;
  readonly dashboardService: DashboardService;
  readonly dashboardController: DashboardController;
}

let instance: Container | undefined;

export function buildContainer(): Container {
  const passwordHasher: PasswordHasher = new BcryptPasswordHasher(config.BCRYPT_COST);

  const tokenService: TokenService = new JwtTokenService({
    accessSecret: config.JWT_SECRET,
    refreshSecret: config.JWT_REFRESH_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
  });

  const authService = new AuthService(passwordHasher, tokenService, {
    maxFailedAttempts: config.MAX_FAILED_LOGIN_ATTEMPTS,
    lockoutSeconds: config.ACCOUNT_LOCKOUT_SECONDS,
    accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
  });

  const projectService = new ProjectService();
  const taskService = new TaskService();
  const noteService = new NoteService();
  const habitService = new HabitService();
  const goalService = new GoalService();
  const expenseService = new ExpenseService();
  const subscriptionService = new SubscriptionService();
  const budgetService = new BudgetService();
  const eventService = new EventService();
  const reminderService = new ReminderService();
  const dashboardService = new DashboardService();

  return {
    passwordHasher,
    tokenService,
    authService,
    authController: new AuthController(authService),
    projectService,
    projectController: new ProjectController(projectService),
    taskService,
    taskController: new TaskController(taskService),
    noteService,
    noteController: new NoteController(noteService),
    habitService,
    habitController: new HabitController(habitService),
    goalService,
    goalController: new GoalController(goalService),
    expenseService,
    expenseController: new ExpenseController(expenseService),
    subscriptionService,
    subscriptionController: new SubscriptionController(subscriptionService),
    budgetService,
    budgetController: new BudgetController(budgetService),
    eventService,
    eventController: new EventController(eventService),
    reminderService,
    reminderController: new ReminderController(reminderService),
    dashboardService,
    dashboardController: new DashboardController(dashboardService),
  };
}

export function getContainer(): Container {
  if (!instance) {
    instance = buildContainer();
  }
  return instance;
}

/** Test helper: drops the memoized container so the next call rebuilds it. */
export function resetContainer(): void {
  instance = undefined;
}
