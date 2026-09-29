/** Shared status union types re-exported from verified API types. */

import type { HabitStatus, TaskPriority, TaskStatus } from '@/types/api';

export type { HabitStatus, TaskPriority, TaskStatus };

export type ProjectStatusValue = 'active' | 'on_hold' | 'completed' | 'archived';
export type SubscriptionStatusValue = 'active' | 'paused' | 'cancelled';
export type GoalStatusValue = 'active' | 'paused' | 'achieved' | 'abandoned';
export type RecurringStatusValue = 'active' | 'paused' | 'ended';
