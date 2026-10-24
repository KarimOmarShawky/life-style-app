/**
 * src/infrastructure/database/postgres/kysely.ts
 *
 * Implements Section 4.5 & ADR-006: Kysely Query Builder instance over pg pool.
 * Fully typed schema representing all 22 core MVP entities.
 */

import { Kysely, PostgresDialect, type Generated } from 'kysely';
import { getPgPool } from './pool.js';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  display_name: string;
  timezone: Generated<string>;
  locale: Generated<string>;
  week_start: Generated<number>;
  default_currency: string;
  status: Generated<'active' | 'disabled' | 'pending_deletion'>;
  email_verified_at: Date | null;
  password_changed_at: Generated<Date>;
  last_login_at: Date | null;
  deletion_scheduled_for: Date | null;
  push_show_titles: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuthSessionsTable {
  id: Generated<string>;
  user_id: string;
  created_at: Generated<Date>;
  last_used_at: Generated<Date>;
  absolute_expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  device_platform: 'ios' | 'android' | 'unknown';
  device_name: string | null;
  app_version: string | null;
  created_ip: string | null;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  session_id: string;
  user_id: string;
  token_hash: Buffer;
  issued_at: Generated<Date>;
  expires_at: Date;
  rotated_at: Date | null;
  replaced_by: string | null;
  revoked_at: Date | null;
}

export interface PushDevicesTable {
  id: Generated<string>;
  user_id: string;
  session_id: string;
  platform: 'ios' | 'android';
  push_token: string;
  app_version: string | null;
  last_seen_at: Generated<Date>;
  disabled_at: Date | null;
  created_at: Generated<Date>;
}

export interface CategoriesTable {
  id: Generated<string>;
  user_id: string;
  kind: 'expense' | 'income';
  name: string;
  icon: string | null;
  color: string | null;
  archived_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface GoalsTable {
  id: Generated<string>;
  user_id: string;
  title: string;
  description: string | null;
  status: Generated<'active' | 'paused' | 'achieved' | 'abandoned'>;
  progress_type: 'milestones' | 'numeric';
  target_value: string | null;
  current_value: string | null;
  unit: string | null;
  start_date: string | null;
  target_date: string | null;
  achieved_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface MilestonesTable {
  id: Generated<string>;
  user_id: string;
  goal_id: string;
  title: string;
  due_date: string | null;
  completed_at: Date | null;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface ProjectsTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  description: string | null;
  status: Generated<'active' | 'on_hold' | 'completed' | 'archived'>;
  color: string | null;
  goal_id: string | null;
  due_date: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface RecurringTasksTable {
  id: Generated<string>;
  user_id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  priority: Generated<number>;
  estimate_minutes: number | null;
  due_time: string | null;
  reminder_offset_minutes: number | null;
  status: Generated<'active' | 'paused' | 'ended'>;
  generated_through: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface HabitsTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  description: string | null;
  status: Generated<'active' | 'paused' | 'archived'>;
  start_date: string;
  reminder_time: string | null;
  color: string | null;
  goal_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface RecurrencesTable {
  id: Generated<string>;
  user_id: string;
  recurring_task_id: string | null;
  habit_id: string | null;
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: Generated<number>;
  by_weekday: number[] | null;
  by_month_day: number | null;
  by_month: number | null;
  start_date: string;
  end_date: string | null;
  occurrence_limit: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TasksTable {
  id: Generated<string>;
  user_id: string;
  title: string;
  description: string | null;
  status: Generated<'todo' | 'in_progress' | 'done' | 'cancelled'>;
  priority: Generated<number>;
  due_date: string | null;
  due_time: string | null;
  planned_date: string | null;
  is_focus: Generated<boolean>;
  estimate_minutes: number | null;
  project_id: string | null;
  recurring_task_id: string | null;
  occurrence_date: string | null;
  is_customized: Generated<boolean>;
  completed_at: Date | null;
  search_vector: Generated<unknown>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface TimerSessionsTable {
  id: Generated<string>;
  user_id: string;
  task_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  mode: Generated<'stopwatch' | 'countdown'>;
  planned_seconds: number | null;
  end_reason: 'stopped' | 'completed' | 'auto_closed' | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface HabitCheckinsTable {
  id: Generated<string>;
  user_id: string;
  habit_id: string;
  checkin_date: string;
  status: 'done' | 'skipped';
  note: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface NotesTable {
  id: Generated<string>;
  user_id: string;
  title: string | null;
  body: Generated<string>;
  tags: Generated<string[]>;
  is_pinned: Generated<boolean>;
  search_vector: Generated<unknown>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface NoteLinksTable {
  id: Generated<string>;
  user_id: string;
  note_id: string;
  task_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  habit_id: string | null;
  event_id: string | null;
  created_at: Generated<Date>;
}

export interface EventsTable {
  id: Generated<string>;
  user_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: Date;
  end_at: Date;
  all_day: Generated<boolean>;
  timezone: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface SubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  amount: string;
  currency: string;
  billing_unit: 'week' | 'month' | 'year';
  billing_interval: Generated<number>;
  anchor_date: string;
  next_billing_date: string;
  status: Generated<'active' | 'paused' | 'cancelled'>;
  cancelled_on: string | null;
  category_kind: Generated<'expense'>;
  category_id: string | null;
  reminder_days_before: number | null;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface TransactionsTable {
  id: Generated<string>;
  user_id: string;
  kind: 'expense' | 'income';
  amount: string;
  currency: string;
  occurred_on: string;
  category_id: string | null;
  description: string | null;
  merchant: string | null;
  subscription_id: string | null;
  billing_date: string | null;
  source: Generated<'manual'>;
  idempotency_key: string | null;
  idempotency_fingerprint: Buffer | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface BudgetsTable {
  id: Generated<string>;
  user_id: string;
  category_kind: Generated<'expense'>;
  category_id: string | null;
  amount_limit: string;
  currency: string;
  period: Generated<'monthly'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
  version: Generated<number>;
}

export interface RemindersTable {
  id: Generated<string>;
  user_id: string;
  task_id: string | null;
  habit_id: string | null;
  event_id: string | null;
  subscription_id: string | null;
  entity_type: Generated<'task' | 'habit' | 'event' | 'subscription'>;
  entity_id: Generated<string>;
  source: 'user' | 'system';
  remind_at: Date;
  offset_minutes: number | null;
  channel: 'push' | 'in_app' | 'email';
  status: Generated<'pending' | 'processing' | 'sent' | 'failed' | 'cancelled'>;
  next_attempt_at: Date | null;
  attempt_count: Generated<number>;
  processing_started_at: Date | null;
  sent_at: Date | null;
  failed_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  dedupe_key: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  occurred_at: Generated<Date>;
  actor_type: 'user' | 'system';
  actor_user_id: string | null;
  session_id: string | null;
  event_type: string;
  outcome: 'success' | 'failure';
  entity_type: string | null;
  entity_id: string | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: Generated<Record<string, unknown>>;
}

export interface PasswordResetRequestsTable {
  id: Generated<string>;
  email: string;
  status: Generated<'pending' | 'processing' | 'sent' | 'failed' | 'dead_letter'>;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  last_error_code: string | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  processing_started_at: Date | null;
  lease_expires_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  completed_at: Date | null;
}

export interface DatabaseSchema {
  users: UsersTable;
  auth_sessions: AuthSessionsTable;
  refresh_tokens: RefreshTokensTable;
  push_devices: PushDevicesTable;
  categories: CategoriesTable;
  goals: GoalsTable;
  milestones: MilestonesTable;
  projects: ProjectsTable;
  recurring_tasks: RecurringTasksTable;
  habits: HabitsTable;
  recurrences: RecurrencesTable;
  tasks: TasksTable;
  timer_sessions: TimerSessionsTable;
  habit_checkins: HabitCheckinsTable;
  notes: NotesTable;
  note_links: NoteLinksTable;
  events: EventsTable;
  subscriptions: SubscriptionsTable;
  transactions: TransactionsTable;
  budgets: BudgetsTable;
  reminders: RemindersTable;
  audit_logs: AuditLogsTable;
  password_reset_requests: PasswordResetRequestsTable;
}

let kyselyDb: Kysely<DatabaseSchema> | null = null;

export function getKyselyDb(): Kysely<DatabaseSchema> {
  if (kyselyDb) {
    return kyselyDb;
  }

  const pool = getPgPool();
  kyselyDb = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool
    })
  });

  return kyselyDb;
}
