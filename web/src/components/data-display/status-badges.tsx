import { Badge, type BadgeVariant } from '@/components/ui/badge';
import type {
  HabitStatus,
  ProjectStatusValue,
  SubscriptionStatusValue,
  TaskPriority,
  TaskStatus
} from '@/lib/status-types';

/** Status → badge styling maps (shared by tables and cards). */

const TASK_STATUS: Record<TaskStatus, { label: string; variant: BadgeVariant }> = {
  todo: { label: 'To do', variant: 'neutral' },
  in_progress: { label: 'In progress', variant: 'info' },
  done: { label: 'Done', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'neutral' }
};

const TASK_PRIORITY: Record<TaskPriority, { label: string; className: string }> = {
  none: { label: '—', className: 'text-subtle-foreground' },
  low: { label: 'Low', className: 'text-primary' },
  medium: { label: 'Medium', className: 'text-warning' },
  high: { label: 'High', className: 'text-priority-high font-semibold' }
};

const PROJECT_STATUS: Record<ProjectStatusValue, { label: string; variant: BadgeVariant }> = {
  active: { label: 'Active', variant: 'success' },
  on_hold: { label: 'On hold', variant: 'warning' },
  completed: { label: 'Completed', variant: 'info' },
  archived: { label: 'Archived', variant: 'neutral' }
};

const HABIT_STATUS: Record<HabitStatus, { label: string; variant: BadgeVariant }> = {
  active: { label: 'Active', variant: 'success' },
  paused: { label: 'Paused', variant: 'warning' },
  archived: { label: 'Archived', variant: 'neutral' }
};

const SUBSCRIPTION_STATUS: Record<
  SubscriptionStatusValue,
  { label: string; variant: BadgeVariant }
> = {
  active: { label: 'Active', variant: 'success' },
  paused: { label: 'Paused', variant: 'warning' },
  cancelled: { label: 'Cancelled', variant: 'neutral' }
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const meta = TASK_STATUS[status] ?? TASK_STATUS.todo;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const meta = TASK_PRIORITY[priority] ?? TASK_PRIORITY.none;
  if (priority === 'none') return <span className={meta.className}>—</span>;
  return <span className={`text-sm ${meta.className}`}>{meta.label}</span>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatusValue }) {
  const meta = PROJECT_STATUS[status] ?? PROJECT_STATUS.active;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export function HabitStatusBadge({ status }: { status: HabitStatus }) {
  const meta = HABIT_STATUS[status] ?? HABIT_STATUS.active;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatusValue }) {
  const meta = SUBSCRIPTION_STATUS[status] ?? SUBSCRIPTION_STATUS.active;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export function KindBadge({ kind }: { kind: 'expense' | 'income' }) {
  return kind === 'expense' ? (
    <Badge variant="danger">Expense</Badge>
  ) : (
    <Badge variant="success">Income</Badge>
  );
}
