/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: docs/api/openapi.yaml (OpenAPI 3.1, info.version 1.0.1)
 * Generator: web/scripts/generate-api-types.mjs  (npm run generate:api-types)
 *
 * The repository's OpenAPI document is NOT fully accurate with respect to the
 * backend runtime. Every type below was (re)verified against backend routes,
 * controllers, DTOs, and Zod validation schemas; known deviations are
 * documented in web/docs/api-verification.md. The application code consumes
 * verified types via src/types/api.ts and the feature modules.
 */

export type RegisterRequest = {
  email: string;
  password: string;
  displayName: string;
  timezone?: string;
  locale?: string;
  weekStart?: number;
  defaultCurrency?: string;
};

export type LoginRequest = {
  email: string;
  password: string;
  deviceName?: string;
  devicePlatform?: 'ios' | 'android' | 'unknown';
  appVersion?: string;
};

export type RefreshTokenRequest = {
  refreshToken: string;
};

export type ResetPasswordRequest = {
  email: string;
  code: string;
  newPassword: string;
};

export type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};

export type UpdateProfileRequest = {
  displayName?: string;
  timezone?: string;
  locale?: string;
  weekStart?: number;
  defaultCurrency?: string;
  pushShowTitles?: boolean;
};

export type RegisterDeviceRequest = {
  platform: 'ios' | 'android';
  pushToken: string;
  appVersion?: string;
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  locale: string;
  weekStart: number;
  defaultCurrency: string;
  status: 'active' | 'disabled' | 'pending_deletion';
  deletionScheduledFor?: string | null;
  pushShowTitles: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuthResponse = {
  user: User;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
};

export type Task = {
  id: string;
  title: string;
  description?: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'none' | 'low' | 'medium' | 'high';
  dueDate?: string | null;
  dueTime?: string | null;
  plannedDate?: string | null;
  isFocus: boolean;
  estimateMinutes?: number | null;
  projectId?: string | null;
  recurringTaskId?: string | null;
  occurrenceDate?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Aggregate time tracked on this task */
  trackedSeconds?: number;
};

export type CreateTaskRequest = {
  title: string;
  description?: string | null;
  status?: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority?: 'none' | 'low' | 'medium' | 'high';
  dueDate?: string | null;
  dueTime?: string | null;
  plannedDate?: string | null;
  isFocus?: boolean;
  estimateMinutes?: number | null;
  projectId?: string | null;
};

export type UpdateTaskRequest = {
  title?: string;
  description?: string | null;
  status?: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority?: 'none' | 'low' | 'medium' | 'high';
  dueDate?: string | null;
  dueTime?: string | null;
  plannedDate?: string | null;
  isFocus?: boolean;
  estimateMinutes?: number | null;
  projectId?: string | null;
  version?: number;
};

export type Project = {
  id: string;
  name: string;
  description?: string | null;
  status: 'active' | 'on_hold' | 'completed' | 'archived';
  color?: string | null;
  goalId?: string | null;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  taskCounts: {
    open: number;
    done: number;
  };
};

export type CreateProjectRequest = {
  name: string;
  description?: string | null;
  status?: 'active' | 'on_hold' | 'completed' | 'archived';
  color?: string | null;
  goalId?: string | null;
  dueDate?: string | null;
};

export type UpdateProjectRequest = {
  name?: string;
  description?: string | null;
  status?: 'active' | 'on_hold' | 'completed' | 'archived';
  color?: string | null;
  goalId?: string | null;
  dueDate?: string | null;
  version?: number;
};

export type RecurrenceDefinition = {
  id?: string;
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byWeekday?: number[] | null;
  byMonthDay?: number | null;
  byMonth?: number | null;
  startDate: string;
  endDate?: string | null;
  occurrenceLimit?: number | null;
};

export type RecurringTask = {
  id: string;
  title: string;
  description?: string | null;
  projectId?: string | null;
  priority: 'none' | 'low' | 'medium' | 'high';
  estimateMinutes?: number | null;
  dueTime?: string | null;
  reminderOffsetMinutes?: number | null;
  status: 'active' | 'paused' | 'ended';
  generatedThrough?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  recurrence: RecurrenceDefinition;
};

export type CreateRecurringTaskRequest = {
  title: string;
  description?: string | null;
  projectId?: string | null;
  priority?: 'none' | 'low' | 'medium' | 'high';
  estimateMinutes?: number | null;
  dueTime?: string | null;
  reminderOffsetMinutes?: number | null;
  status?: 'active' | 'paused' | 'ended';
  recurrence: {
    freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval?: number;
    byWeekday?: number[] | null;
    byMonthDay?: number | null;
    byMonth?: number | null;
    startDate: string;
    endDate?: string | null;
    occurrenceLimit?: number | null;
  };
};

export type UpdateRecurringTaskRequest = {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  priority?: 'none' | 'low' | 'medium' | 'high';
  estimateMinutes?: number | null;
  dueTime?: string | null;
  reminderOffsetMinutes?: number | null;
  status?: 'active' | 'paused' | 'ended';
  recurrence?: Record<string, unknown>;
  version?: number;
};

export type TimerSession = {
  id: string;
  taskId: string;
  startedAt: string;
  endedAt?: string | null;
  mode: 'stopwatch' | 'countdown';
  plannedSeconds?: number | null;
  /** Elapsed seconds derived from timestamps */
  durationSeconds: number;
  endReason?: 'stopped' | 'completed' | 'auto_closed';
  createdAt: string;
  updatedAt: string;
};

export type CreateTimerSessionRequest = {
  taskId: string;
  mode?: 'stopwatch' | 'countdown';
  plannedSeconds?: number | null;
};

export type ApiErrorEnvelope = {
  success: boolean;
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: {
      field: string;
      code?: string;
      message: string;
    }[];
  };
};

export type HabitFrequencyType =
  'daily' | 'weekly' | 'monthly' | 'days_per_week' | 'days_per_month';

export type HabitRecurrenceRule = {
  frequencyType: HabitFrequencyType;
  interval?: number;
  daysOfWeek?: number[];
  daysOfMonth?: number[];
  targetDays?: number;
};

export type HabitCheckinStatus = 'done' | 'skip' | 'fail';

export type Habit = {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  recurrence: HabitRecurrenceRule;
  targetPerDay: number;
  unit: string;
  timeOfDay?: 'anytime' | 'morning' | 'afternoon' | 'evening';
  reminderTime?: string | null;
  startDate: string;
  endDate?: string | null;
  isArchived: boolean;
  sortOrder: number;
  currentStreak: number;
  longestStreak: number;
  totalCompletions: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type HabitCheckin = {
  id: string;
  habitId: string;
  date: string;
  status: HabitCheckinStatus;
  value?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateHabitRequest = {
  title: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
  recurrence: HabitRecurrenceRule;
  targetPerDay?: number;
  unit?: string;
  timeOfDay?: 'anytime' | 'morning' | 'afternoon' | 'evening';
  reminderTime?: string | null;
  startDate: string;
  endDate?: string | null;
  sortOrder?: number;
};

export type UpdateHabitRequest = {
  title?: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
  recurrence?: HabitRecurrenceRule;
  targetPerDay?: number;
  unit?: string;
  timeOfDay?: 'anytime' | 'morning' | 'afternoon' | 'evening';
  reminderTime?: string | null;
  startDate?: string;
  endDate?: string | null;
  isArchived?: boolean;
  sortOrder?: number;
};

export type PutCheckinRequest = {
  status: HabitCheckinStatus;
  value?: number | null;
  notes?: string | null;
};

export type TodayHabitProgressItem = {
  habitId: string;
  title: string;
  status: HabitCheckinStatus;
  scheduled: boolean;
  targetValue: number;
  actualValue: number;
  currentStreak: number;
};

export type TodayProgress = {
  date: string;
  totalScheduled: number;
  totalDone: number;
  totalSkipped: number;
  totalFailed: number;
  completionRate: number;
  habits: TodayHabitProgressItem[];
};

export type Event = {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
  version: number;
  reminders?: Reminder[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type CreateReminderRequest = {
  channel: 'push' | 'in_app' | 'email';
  offsetMinutes?: number | null;
  remindAt?: string | null;
};

export type CreateEventRequest = {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  timezone: string;
  reminders?: CreateReminderRequest[];
};

export type UpdateEventRequest = {
  title?: string;
  description?: string | null;
  location?: string | null;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  timezone?: string;
  version?: number;
};

export type Reminder = {
  id: string;
  userId: string;
  eventId?: string | null;
  taskId?: string | null;
  habitId?: string | null;
  subscriptionId?: string | null;
  entityType: string;
  entityId: string;
  source: string;
  remindAt: string;
  offsetMinutes?: number | null;
  channel: 'push' | 'in_app' | 'email';
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  nextAttemptAt?: string | null;
  attemptCount: number;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  dedupeKey?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConflictResponse = {
  hasConflict: boolean;
  conflicts: Event[];
};

export type AgendaResponse = {
  date: string;
  totalEvents: number;
  events: Event[];
};

export type GoalStatus = 'active' | 'paused' | 'achieved' | 'abandoned';

export type GoalProgressType = 'milestones' | 'numeric';

export type Milestone = {
  id: string;
  goalId: string;
  title: string;
  dueDate?: string | null;
  completed: boolean;
  completedAt?: string | null;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type Goal = {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  status: GoalStatus;
  progressType: GoalProgressType;
  targetValue?: string | null;
  currentValue?: string | null;
  unit?: string | null;
  progressPercentage: number;
  totalMilestones?: number | null;
  completedMilestones?: number | null;
  milestones?: Milestone[];
  startDate?: string | null;
  targetDate?: string | null;
  achievedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type CreateGoalRequest = {
  title: string;
  description?: string | null;
  progressType: GoalProgressType;
  targetValue?: string | null;
  currentValue?: string | null;
  unit?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
};

export type UpdateGoalRequest = {
  title?: string;
  description?: string | null;
  status?: GoalStatus;
  targetValue?: string | null;
  currentValue?: string | null;
  unit?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  version?: number;
};

export type CreateMilestoneRequest = {
  title: string;
  dueDate?: string | null;
  sortOrder?: number;
};

export type UpdateMilestoneRequest = {
  title?: string;
  dueDate?: string | null;
  completed?: boolean;
  sortOrder?: number;
  version?: number;
};

export type Note = {
  id: string;
  userId: string;
  title: string | null;
  body: string;
  excerpt: string;
  tags: string[];
  isPinned: boolean;
  links?: NoteLink[];
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type NoteListItem = {
  id: string;
  userId: string;
  title: string | null;
  excerpt: string;
  tags: string[];
  isPinned: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type NoteLink = {
  id: string;
  noteId: string;
  entityType: 'task' | 'project' | 'goal' | 'habit' | 'event';
  entityId: string;
  taskId: string | null;
  projectId: string | null;
  goalId: string | null;
  habitId: string | null;
  eventId: string | null;
  createdAt: string;
};

export type CreateNoteLinkRequest = {
  entityType?: 'task' | 'project' | 'goal' | 'habit' | 'event';
  entityId?: string;
  taskId?: string;
  projectId?: string;
  goalId?: string;
  habitId?: string;
  eventId?: string;
};

export type CreateNoteRequest = {
  title?: string | null;
  body?: string;
  tags?: string[];
  isPinned?: boolean;
  links?: CreateNoteLinkRequest[];
};

export type UpdateNoteRequest = {
  title?: string | null;
  body?: string;
  tags?: string[];
  isPinned?: boolean;
  links?: CreateNoteLinkRequest[];
  version?: number;
};

export type TagCount = {
  tag: string;
  count: number;
};

export type Category = {
  id: string;
  kind: 'expense' | 'income';
  name: string;
  icon?: string | null;
  color?: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateCategoryRequest = {
  kind: 'expense' | 'income';
  name: string;
  icon?: string | null;
  color?: string | null;
};

export type UpdateCategoryRequest = {
  name?: string;
  icon?: string | null;
  color?: string | null;
  archived?: boolean;
  version?: number;
};

export type Transaction = {
  id: string;
  kind: 'expense' | 'income';
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId?: string | null;
  description?: string | null;
  merchant?: string | null;
  subscriptionId?: string | null;
  billingDate?: string | null;
  source: 'manual';
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateTransactionRequest = {
  kind: 'expense' | 'income';
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId?: string | null;
  description?: string | null;
  merchant?: string | null;
  subscriptionId?: string | null;
  billingDate?: string | null;
};

export type UpdateTransactionRequest = {
  kind?: 'expense' | 'income';
  amount?: string;
  currency?: string;
  occurredOn?: string;
  categoryId?: string | null;
  description?: string | null;
  merchant?: string | null;
  version?: number;
};

export type Subscription = {
  id: string;
  name: string;
  amount: string;
  currency: string;
  billingUnit: 'week' | 'month' | 'year';
  billingInterval: number;
  anchorDate: string;
  nextBillingDate: string;
  status: 'active' | 'paused' | 'cancelled';
  cancelledOn?: string | null;
  categoryId?: string | null;
  reminderDaysBefore?: number | null;
  notes?: string | null;
  monthlyEquivalent: string;
  daysUntilNextBilling: number;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateSubscriptionRequest = {
  name: string;
  amount: string;
  currency: string;
  billingUnit: 'week' | 'month' | 'year';
  billingInterval?: number;
  anchorDate: string;
  nextBillingDate?: string;
  categoryId?: string | null;
  reminderDaysBefore?: number | null;
  notes?: string | null;
};

export type UpdateSubscriptionRequest = {
  name?: string;
  amount?: string;
  currency?: string;
  billingUnit?: 'week' | 'month' | 'year';
  billingInterval?: number;
  anchorDate?: string;
  nextBillingDate?: string;
  status?: 'active' | 'paused' | 'cancelled';
  cancelledOn?: string | null;
  categoryId?: string | null;
  reminderDaysBefore?: number | null;
  notes?: string | null;
  version?: number;
};

export type PaySubscriptionRequest = {
  amount?: string;
  occurredOn?: string;
};

export type BudgetUsage = {
  periodStart: string;
  periodEnd: string;
  spent: string;
  remaining: string;
  percentUsed: number;
  overspent: boolean;
};

export type Budget = {
  id: string;
  categoryId: string | null;
  amountLimit: string;
  currency: string;
  period: 'monthly';
  usage?: BudgetUsage;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateBudgetRequest = {
  categoryId?: string | null;
  amountLimit: string;
  currency: string;
  period?: 'monthly';
};

export type UpdateBudgetRequest = {
  amountLimit?: string;
  version?: number;
};

export type ReportCategoryItem = {
  categoryId: string | null;
  name: string;
  kind: 'expense' | 'income';
  total: string;
  count: number;
  share: number;
};

export type ReportSeriesItem = {
  periodStart: string;
  income: string;
  expense: string;
};

export type ReportSummary = {
  currency: string;
  from: string;
  to: string;
  totals: {
    income: string;
    expense: string;
    net: string;
  };
  byCategory: ReportCategoryItem[];
  series?: ReportSeriesItem[];
};

export type PageMeta = {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};
