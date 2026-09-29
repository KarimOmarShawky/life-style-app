/**
 * Verified API types.
 *
 * The generated OpenAPI types live in `openapi.generated.ts`. The application
 * consumes the types below, which were verified directly against backend
 * routes, controllers, DTO mappers, and Zod validation schemas.
 * `web/docs/api-verification.md` records every known deviation.
 */

import type {
  PageMeta,
  Task as GeneratedTask,
  CreateTaskRequest as GeneratedCreateTaskRequest,
  UpdateTaskRequest as GeneratedUpdateTaskRequest,
  Project as GeneratedProject,
  CreateProjectRequest as GeneratedCreateProjectRequest,
  UpdateProjectRequest as GeneratedUpdateProjectRequest,
  RecurringTask as GeneratedRecurringTask,
  CreateRecurringTaskRequest as GeneratedCreateRecurringTaskRequest,
  UpdateRecurringTaskRequest as GeneratedUpdateRecurringTaskRequest,
  TimerSession as GeneratedTimerSession,
  CreateTimerSessionRequest as GeneratedCreateTimerSessionRequest,
  Event as GeneratedEvent,
  CreateEventRequest as GeneratedCreateEventRequest,
  UpdateEventRequest as GeneratedUpdateEventRequest,
  Reminder as GeneratedReminder,
  Goal as GeneratedGoal,
  CreateGoalRequest as GeneratedCreateGoalRequest,
  UpdateGoalRequest as GeneratedUpdateGoalRequest,
  Milestone as GeneratedMilestone,
  Note as GeneratedNote,
  NoteListItem as GeneratedNoteListItem,
  NoteLink as GeneratedNoteLink,
  Category as GeneratedCategory,
  Transaction as GeneratedTransaction,
  Subscription as GeneratedSubscription,
  Budget as GeneratedBudget,
  ReportSummary as GeneratedReportSummary
} from './openapi.generated';

/* ------------------------------------------------------------------ */
/* Generic envelopes                                                   */
/* ------------------------------------------------------------------ */

/** Backend error envelope (verified — `core/http/envelope.ts`). */
export interface ApiErrorEnvelopeShape {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Array<{ field: string; code?: string; message: string }>;
  };
}

/**
 * Cursor pagination for tasks/projects/recurring/timer/habits lists.
 * Runtime returns ONLY `{ nextCursor }` (OpenAPI's PageMeta is inaccurate).
 */
export interface CursorMeta {
  nextCursor: string | null;
}

/** Full pagination meta used by transactions and subscriptions lists (verified). */
export type FullPageMeta = PageMeta;

/* ------------------------------------------------------------------ */
/* Auth & users (verified against auth.dto.ts / auth.validation.ts)     */
/* ------------------------------------------------------------------ */

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  locale: string;
  weekStart: number;
  defaultCurrency: string;
  pushShowTitles: boolean;
  status: 'active' | 'disabled' | 'pending_deletion';
  emailVerified: boolean;
  createdAt: string;
}

/** Runtime token DTO — expires-in seconds is NOT provided (OpenAPI is wrong). */
export interface TokenPairDto {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface AuthResponseDto {
  user: UserDto;
  tokens: TokenPairDto;
}

export interface RegisterBody {
  email: string;
  password: string;
  displayName: string;
  timezone?: string;
  defaultCurrency?: string;
  locale?: string;
  device?: { platform: 'ios' | 'android' | 'unknown'; name?: string; appVersion?: string };
}

export interface LoginBody {
  email: string;
  password: string;
  device?: { platform: 'ios' | 'android' | 'unknown'; name?: string; appVersion?: string };
}

export interface UpdateProfileBody {
  displayName?: string;
  timezone?: string;
  locale?: string;
  weekStart?: number; // runtime range: 1..7
  defaultCurrency?: string;
}

export interface DeletionStatusResponse {
  status: string;
  deletionScheduledFor?: string;
}

/* ------------------------------------------------------------------ */
/* Tasks (verified against tasks.validation.ts / tasks.dto.ts)          */
/* ------------------------------------------------------------------ */

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';

export type Task = GeneratedTask;
export type CreateTaskBody = GeneratedCreateTaskRequest;
export type UpdateTaskBody = GeneratedUpdateTaskRequest;

export interface TaskListResponse {
  data: Task[];
  meta: CursorMeta;
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export type Project = GeneratedProject;
export type CreateProjectBody = GeneratedCreateProjectRequest;
export type UpdateProjectBody = GeneratedUpdateProjectRequest;

export interface ProjectListResponse {
  data: Project[];
  meta: CursorMeta;
}

/* ------------------------------------------------------------------ */
/* Recurring tasks                                                     */
/* ------------------------------------------------------------------ */

export type RecurringTask = GeneratedRecurringTask;
export type CreateRecurringTaskBody = GeneratedCreateRecurringTaskRequest;
export type UpdateRecurringTaskBody = GeneratedUpdateRecurringTaskRequest;

export interface RecurringTaskListResponse {
  data: RecurringTask[];
  meta: CursorMeta;
}

/* ------------------------------------------------------------------ */
/* Timer sessions                                                      */
/* ------------------------------------------------------------------ */

export type TimerSession = GeneratedTimerSession;
export type CreateTimerSessionBody = GeneratedCreateTimerSessionRequest;

export interface TimerSessionListResponse {
  data: TimerSession[];
  meta: CursorMeta;
}

export interface ActiveTimerResponse {
  timerSession: TimerSession | null;
}

/* ------------------------------------------------------------------ */
/* Habits (runtime contract differs substantially from OpenAPI)         */
/* ------------------------------------------------------------------ */

export type HabitStatus = 'active' | 'paused' | 'archived';
export type HabitCheckinStatus = 'done' | 'skipped';

export interface HabitRecurrence {
  id?: string;
  freq: 'daily' | 'weekly';
  interval: number;
  byWeekday: number[] | null; // 1..7 (ISO), required for weekly
  startDate?: string;
}

export interface HabitDto {
  id: string;
  name: string;
  description: string | null;
  status: HabitStatus;
  startDate: string;
  reminderTime: string | null;
  color: string | null;
  goalId: string | null;
  recurrence: HabitRecurrence;
  currentStreak: number;
  longestStreak: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface HabitCheckinDto {
  id: string;
  habitId: string;
  checkinDate: string;
  status: HabitCheckinStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHabitBody {
  name: string;
  description?: string | null;
  startDate: string;
  reminderTime?: string | null;
  color?: string | null;
  goalId?: string | null;
  recurrence: { freq: 'daily' | 'weekly'; interval?: number; byWeekday?: number[] | null };
}

export interface UpdateHabitBody {
  name?: string;
  description?: string | null;
  status?: HabitStatus;
  reminderTime?: string | null;
  color?: string | null;
  goalId?: string | null;
  recurrence?: { freq: 'daily' | 'weekly'; interval?: number; byWeekday?: number[] | null };
  version?: number;
}

export interface HabitListResponse {
  data: HabitDto[];
  meta: CursorMeta;
}

/**
 * Runtime shape of `GET /habits/progress/today` (verified live against the
 * backend): aggregate counters only — there is no per-habit array and no
 * `date` field; the server resolves "today" from the user's timezone.
 * `percent` is server-computed, already in the 0–100 range (FR-HAB-06:
 * done ÷ (scheduled − skipped)).
 */
export interface TodayProgressResponse {
  progress: {
    totalScheduled: number;
    done: number;
    skipped: number;
    percent: number;
  };
}

export interface CheckinListResponse {
  data: HabitCheckinDto[];
}

/* ------------------------------------------------------------------ */
/* Calendar events                                                     */
/* ------------------------------------------------------------------ */

export type Event = GeneratedEvent;
export type CreateEventBody = GeneratedCreateEventRequest;
export type UpdateEventBody = GeneratedUpdateEventRequest;
export type Reminder = GeneratedReminder;

export interface EventListResponse {
  events: Event[];
}

export interface AgendaResponse {
  date: string;
  totalEvents: number;
  events: Event[];
}

export interface ConflictResponse {
  hasConflict: boolean;
  conflicts: Event[];
}

/* ------------------------------------------------------------------ */
/* Goals & milestones                                                  */
/* ------------------------------------------------------------------ */

export type Goal = GeneratedGoal;
export type CreateGoalBody = GeneratedCreateGoalRequest;
export type UpdateGoalBody = GeneratedUpdateGoalRequest;
export type Milestone = GeneratedMilestone;

export interface GoalListResponse {
  goals: Goal[];
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export type Note = GeneratedNote;
export type NoteListItem = GeneratedNoteListItem;
export type NoteLink = GeneratedNoteLink;

export interface NoteListResponse {
  notes: NoteListItem[];
}

export interface TagCount {
  tag: string;
  count: number;
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export type Category = GeneratedCategory;
export type Transaction = GeneratedTransaction;
export type Subscription = GeneratedSubscription;
export type Budget = GeneratedBudget;
export type ReportSummary = GeneratedReportSummary;

export interface CategoryListResponse {
  categories: Category[];
}

export interface TransactionListResponse {
  transactions: Transaction[];
  meta: FullPageMeta;
}

export interface SubscriptionListResponse {
  subscriptions: Subscription[];
  meta: FullPageMeta;
}

export interface BudgetListResponse {
  budgets: Budget[];
}

export interface PaySubscriptionResponse {
  transaction: Transaction;
  subscription: Subscription;
}
