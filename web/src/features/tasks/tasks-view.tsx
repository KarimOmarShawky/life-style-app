'use client';

import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { Table, TBody, TD, TH, THead, TRow } from '@/components/data-display/table';
import { CursorPagination } from '@/components/data-display/cursor-pagination';
import { TaskPriorityBadge, TaskStatusBadge } from '@/components/data-display/status-badges';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { TaskFormDialog } from './task-form-dialog';
import { useDeleteTask, useRestoreTask, useTasks, useUpdateTask } from './hooks';
import { useProjects } from '@/features/projects/hooks';
import { useToast } from '@/providers/toast-provider';
import { formatDateOnly } from '@/lib/date/format';
import { ApiError } from '@/lib/api/errors';
import type { Task, TaskStatus } from '@/types/api';
import { cn } from '@/lib/utils';

interface Filters {
  status: string;
  priority: string;
  plannedDate: string;
  overdue: boolean;
  sort: 'dueDate' | 'priority' | 'createdAt' | 'updatedAt';
  order: 'asc' | 'desc';
}

const DEFAULT_FILTERS: Filters = {
  status: 'todo,in_progress',
  priority: '',
  plannedDate: '',
  overdue: false,
  sort: 'dueDate',
  order: 'asc'
};

export function TasksView() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [cursors, setCursors] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [lastDeleted, setLastDeleted] = useState<Task | null>(null);

  const { toast } = useToast();
  const cursor = cursors[cursors.length - 1];

  const params = useMemo(
    () => ({
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      plannedDate: filters.plannedDate || undefined,
      overdue: filters.overdue || undefined,
      sort: filters.sort,
      order: filters.order,
      limit: 25,
      cursor
    }),
    [filters, cursor]
  );

  const tasks = useTasks(params);
  const projects = useProjects({ limit: 100 });
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const restoreTask = useRestoreTask();

  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects.data?.data ?? []) map.set(project.id, project.name);
    return map;
  }, [projects.data]);

  const handleToggleDone = async (task: Task) => {
    const nextStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done';
    try {
      await updateTask.mutateAsync({
        id: task.id,
        body: { status: nextStatus, version: task.version }
      });
      toast({
        title: nextStatus === 'done' ? 'Task completed' : 'Task reopened',
        variant: 'success'
      });
    } catch (error) {
      toast({
        title: 'Could not update task',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        void tasks.refetch();
      }
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const task = deleting;
    try {
      await deleteTask.mutateAsync(task.id);
      setLastDeleted(task);
      toast({ title: 'Task deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete task',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleUndoDelete = async () => {
    if (!lastDeleted) return;
    try {
      await restoreTask.mutateAsync(lastDeleted.id);
      setLastDeleted(null);
      toast({ title: 'Task restored', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not restore task',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const rows = tasks.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Everything on your plate — filter, plan, and finish."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New task
          </Button>
        }
      />

      {lastDeleted ? (
        <div className="mb-4">
          <Alert variant="info" title={`“${lastDeleted.title}” was deleted`}>
            <div className="mt-1 flex items-center gap-3">
              <span>Deleted tasks can be restored for 30 days.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndoDelete}
                loading={restoreTask.isPending}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Undo
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Status
          <Select
            aria-label="Filter by status"
            className="w-40"
            value={filters.status}
            onChange={(event) => setFilters((f) => ({ ...f, status: event.target.value }))}
          >
            <option value="">All statuses</option>
            <option value="todo,in_progress">Open (to do + in progress)</option>
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Priority
          <Select
            aria-label="Filter by priority"
            className="w-32"
            value={filters.priority}
            onChange={(event) => setFilters((f) => ({ ...f, priority: event.target.value }))}
          >
            <option value="">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="none">None</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Planned date
          <Input
            aria-label="Filter by planned date"
            type="date"
            className="w-40"
            value={filters.plannedDate}
            onChange={(event) => setFilters((f) => ({ ...f, plannedDate: event.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Sort by
          <Select
            aria-label="Sort tasks"
            className="w-36"
            value={`${filters.sort}:${filters.order}`}
            onChange={(event) => {
              const [sort, order] = event.target.value.split(':') as [
                Filters['sort'],
                Filters['order']
              ];
              setFilters((f) => ({ ...f, sort, order }));
            }}
          >
            <option value="dueDate:asc">Due date ↑</option>
            <option value="dueDate:desc">Due date ↓</option>
            <option value="priority:desc">Priority ↓</option>
            <option value="createdAt:desc">Newest</option>
            <option value="updatedAt:desc">Recently updated</option>
          </Select>
        </label>
        <Checkbox
          aria-label="Show overdue tasks only"
          checked={filters.overdue}
          onChange={(event) => setFilters((f) => ({ ...f, overdue: event.target.checked }))}
          label="Overdue only"
        />
        <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
          Reset
        </Button>
      </div>

      <AsyncContent
        isLoading={tasks.isLoading}
        isError={tasks.isError}
        error={tasks.error}
        isEmpty={rows.length === 0}
        onRetry={() => void tasks.refetch()}
        emptyTitle="No tasks here"
        emptyDescription="Adjust the filters, or create a task to get moving."
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New task
          </Button>
        }
        skeletonRows={6}
      >
        <Table>
          <THead>
            <tr>
              <TH className="w-10">
                <span className="sr-only">Done</span>
              </TH>
              <TH>Task</TH>
              <TH className="w-28">Status</TH>
              <TH className="w-24">Priority</TH>
              <TH className="w-32">Due</TH>
              <TH className="w-36">Project</TH>
              <TH className="w-28 text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((task) => (
              <TRow key={task.id}>
                <TD>
                  <Checkbox
                    aria-label={`Mark “${task.title}” as ${task.status === 'done' ? 'not done' : 'done'}`}
                    checked={task.status === 'done'}
                    disabled={updateTask.isPending}
                    onChange={() => void handleToggleDone(task)}
                  />
                </TD>
                <TD>
                  <div className="flex flex-col gap-0.5">
                    <span
                      className={cn(
                        'font-medium',
                        task.status === 'done' && 'text-subtle-foreground line-through'
                      )}
                    >
                      {task.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-subtle-foreground">
                      {task.isFocus ? <Badge variant="primary">Focus</Badge> : null}
                      {task.estimateMinutes ? <span>{task.estimateMinutes} min est.</span> : null}
                      {task.dueTime && task.dueDate ? <span>at {task.dueTime}</span> : null}
                    </span>
                  </div>
                </TD>
                <TD>
                  <TaskStatusBadge status={task.status} />
                </TD>
                <TD>
                  <TaskPriorityBadge priority={task.priority} />
                </TD>
                <TD className="text-sm text-muted-foreground">
                  {task.dueDate ? formatDateOnly(task.dueDate) : <span aria-hidden="true">—</span>}
                </TD>
                <TD className="text-sm text-muted-foreground">
                  {task.projectId ? (projectNames.get(task.projectId) ?? '—') : '—'}
                </TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit “${task.title}”`}
                      onClick={() => {
                        setEditing(task);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete “${task.title}”`}
                      onClick={() => setDeleting(task)}
                    >
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                    </Button>
                  </div>
                </TD>
              </TRow>
            ))}
          </TBody>
        </Table>
        <CursorPagination
          hasCursor={Boolean(tasks.data?.meta.nextCursor)}
          canGoBack={cursors.length > 0}
          onNext={() =>
            setCursors((current) => {
              const next = tasks.data?.meta.nextCursor;
              return next ? [...current, next] : current;
            })
          }
          onPrevious={() => setCursors((current) => current.slice(0, -1))}
          loading={tasks.isFetching}
        />
      </AsyncContent>

      <TaskFormDialog
        open={dialogOpen}
        task={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this task?"
        description={`“${deleting?.title ?? ''}” will be soft-deleted and can be restored within 30 days.`}
        confirmLabel="Delete"
        danger
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="size-4 text-subtle-foreground" aria-hidden="true" />
          Time tracked on this task is kept.
        </div>
      </ConfirmDialog>
    </div>
  );
}
