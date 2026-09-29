'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Table, TBody, TD, TH, THead, TRow } from '@/components/data-display/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { FormField } from '@/components/forms/form-field';
import { TaskPriorityBadge } from '@/components/data-display/status-badges';
import {
  useCreateRecurringTask,
  useDeleteRecurringTask,
  useRecurringTasks,
  useUpdateRecurringTask
} from './hooks';
import {
  recurringFormDefaults,
  recurringFormSchema,
  toRecurringBody,
  type RecurringFormValues
} from './schemas';
import { useToast } from '@/providers/toast-provider';
import { ApiError, fieldErrorsOf } from '@/lib/api/errors';
import {} from '@/lib/date/format';
import type { RecurringTask } from '@/types/api';

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun'
};

function describeRecurrence(task: RecurringTask): string {
  const { freq, interval, byWeekday, startDate, endDate, occurrenceLimit } = task.recurrence;
  const every = interval > 1 ? `every ${interval} ${freq}s` : `every ${freq}`;
  const days =
    byWeekday && byWeekday.length > 0
      ? ` (${byWeekday.map((d) => WEEKDAY_LABELS[d] ?? d).join(', ')})`
      : '';
  const range = `from ${startDate}${endDate ? ` → ${endDate}` : ''}${
    occurrenceLimit ? ` · max ${occurrenceLimit}` : ''
  }`;
  return `Repeats ${every}${days} · ${range}`;
}

export function RecurringTasksView() {
  const [statusFilter, setStatusFilter] = useState('');
  const { toast } = useToast();
  const list = useRecurringTasks({ status: statusFilter || undefined, limit: 50 });
  const deleteRecurring = useDeleteRecurringTask();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTask | null>(null);
  const [deleting, setDeleting] = useState<RecurringTask | null>(null);

  const rows = list.data?.data ?? [];

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRecurring.mutateAsync(deleting.id);
      toast({
        title: 'Recurring task deleted',
        description: 'Already-generated instances are kept.',
        variant: 'success'
      });
    } catch (error) {
      toast({
        title: 'Could not delete',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Recurring tasks"
        description="Templates that generate tasks on a schedule — the server owns the recurrence math."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New recurring task
          </Button>
        }
      />

      <div className="mb-4 flex items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Status
          <Select
            aria-label="Filter recurring tasks by status"
            className="w-36"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="ended">Ended</option>
          </Select>
        </label>
      </div>

      <AsyncContent
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        isEmpty={rows.length === 0}
        onRetry={() => void list.refetch()}
        emptyTitle="No recurring tasks"
        emptyDescription="Create a template and the server will generate the first week of instances."
        emptyIcon={<Repeat className="size-8" />}
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New recurring task
          </Button>
        }
        skeletonRows={4}
      >
        <Table>
          <THead>
            <tr>
              <TH>Template</TH>
              <TH className="w-40">Schedule</TH>
              <TH className="w-24">Priority</TH>
              <TH className="w-24">Status</TH>
              <TH className="w-28 text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((task) => (
              <TRow key={task.id}>
                <TD>
                  <div className="font-medium">{task.title}</div>
                  <div className="text-xs text-muted-foreground">{describeRecurrence(task)}</div>
                </TD>
                <TD className="text-sm text-muted-foreground">
                  {task.dueTime ? `Due ${task.dueTime}` : '—'}
                  {task.estimateMinutes ? ` · ${task.estimateMinutes} min` : ''}
                  {task.reminderOffsetMinutes != null
                    ? ` · remind −${task.reminderOffsetMinutes}m`
                    : ''}
                </TD>
                <TD>
                  <TaskPriorityBadge priority={task.priority} />
                </TD>
                <TD>
                  <Badge
                    variant={
                      task.status === 'active'
                        ? 'success'
                        : task.status === 'paused'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {task.status}
                  </Badge>
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
      </AsyncContent>

      <RecurringFormDialog
        open={dialogOpen}
        item={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this recurring template?"
        description={`“${deleting?.title ?? ''}” will stop generating new instances. Instances that already exist stay in your task list.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function RecurringFormDialog({
  open,
  onClose,
  item
}: {
  open: boolean;
  onClose: () => void;
  item: RecurringTask | null;
}) {
  const create = useCreateRecurringTask();
  const update = useUpdateRecurringTask();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);

  const methods = useForm<RecurringFormValues>({
    resolver: zodResolver(recurringFormSchema),
    defaultValues: recurringFormDefaults
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    methods.reset(
      item
        ? {
            title: item.title,
            description: item.description ?? '',
            projectId: item.projectId ?? '',
            priority: item.priority,
            estimateMinutes: item.estimateMinutes ? String(item.estimateMinutes) : '',
            dueTime: item.dueTime ?? '',
            reminderOffsetMinutes:
              item.reminderOffsetMinutes != null ? String(item.reminderOffsetMinutes) : '',
            status: item.status,
            recurrence: {
              freq: item.recurrence.freq,
              interval: String(item.recurrence.interval),
              byWeekday: item.recurrence.byWeekday ?? [],
              startDate: item.recurrence.startDate,
              endDate: item.recurrence.endDate ?? '',
              occurrenceLimit:
                item.recurrence.occurrenceLimit != null
                  ? String(item.recurrence.occurrenceLimit)
                  : ''
            }
          }
        : {
            ...recurringFormDefaults,
            recurrence: {
              ...recurringFormDefaults.recurrence,
              startDate: new Date().toISOString().slice(0, 10)
            }
          }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  const freq = methods.watch('recurrence.freq');
  const byWeekday = methods.watch('recurrence.byWeekday') ?? [];

  const toggleWeekday = (day: number) => {
    const current = methods.getValues('recurrence.byWeekday') ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    methods.setValue('recurrence.byWeekday', next, { shouldDirty: true });
  };

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (item) {
        await update.mutateAsync({
          id: item.id,
          body: { ...toRecurringBody(values), version: item.version }
        });
        toast({ title: 'Recurring task updated', variant: 'success' });
      } else {
        await create.mutateAsync(toRecurringBody(values));
        toast({ title: 'Recurring task created', variant: 'success' });
      }
      onClose();
    } catch (error) {
      for (const [name, message] of Object.entries(fieldErrorsOf(error))) {
        methods.setError(name as keyof RecurringFormValues, { message });
      }
      setFormError(
        error instanceof ApiError ? error.userMessage : 'Could not save the recurring task.'
      );
    }
  });

  const busy = create.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item ? 'Edit recurring task' : 'New recurring task'}
      description="Instances are generated server-side. The first 7 days are created with the template."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={busy}>
            {item ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <FormField<RecurringFormValues> name="title" label="Title" required>
            {(props) => <Input {...props} maxLength={300} autoFocus required />}
          </FormField>
          <FormField<RecurringFormValues> name="description" label="Description">
            {(props) => <Textarea {...props} rows={2} maxLength={10000} />}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<RecurringFormValues> name="priority" label="Priority">
              {(props) => (
                <Select {...props} value={methods.watch('priority')}>
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              )}
            </FormField>
            <FormField<RecurringFormValues> name="status" label="Status">
              {(props) => (
                <Select {...props} value={methods.watch('status')}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                </Select>
              )}
            </FormField>
            <FormField<RecurringFormValues> name="dueTime" label="Due time">
              {(props) => <Input {...props} type="time" />}
            </FormField>
            <FormField<RecurringFormValues> name="estimateMinutes" label="Estimate (minutes)">
              {(props) => <Input {...props} type="number" min={1} max={1440} />}
            </FormField>
          </div>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold">Recurrence</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField<RecurringFormValues> name="recurrence.freq" label="Frequency" required>
                {(props) => (
                  <Select {...props} value={freq}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </Select>
                )}
              </FormField>
              <FormField<RecurringFormValues>
                name="recurrence.interval"
                label="Every N periods"
                required
              >
                {(props) => <Input {...props} type="number" min={1} max={999} />}
              </FormField>
              <FormField<RecurringFormValues>
                name="recurrence.startDate"
                label="Start date"
                required
              >
                {(props) => <Input {...props} type="date" />}
              </FormField>
            </div>

            {freq === 'weekly' ? (
              <div role="group" aria-label="Weekdays">
                <p className="mb-1.5 text-sm font-medium">Weekdays</p>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={byWeekday.includes(day)}
                      onClick={() => toggleWeekday(day)}
                      className={
                        byWeekday.includes(day)
                          ? 'rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-on-primary'
                          : 'rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-sunken'
                      }
                    >
                      {WEEKDAY_LABELS[day]}
                    </button>
                  ))}
                </div>
                {methods.formState.errors.recurrence?.byWeekday?.message ? (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                    {methods.formState.errors.recurrence.byWeekday.message}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField<RecurringFormValues> name="recurrence.endDate" label="End date">
                {(props) => <Input {...props} type="date" />}
              </FormField>
              <FormField<RecurringFormValues>
                name="recurrence.occurrenceLimit"
                label="Max occurrences"
              >
                {(props) => <Input {...props} type="number" min={1} />}
              </FormField>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<RecurringFormValues>
              name="reminderOffsetMinutes"
              label="Remind me N minutes before"
            >
              {(props) => <Input {...props} type="number" min={0} max={43200} />}
            </FormField>
            <FormField<RecurringFormValues> name="projectId" label="Project">
              {(props) => <Input {...props} placeholder="Project UUID (optional)" />}
            </FormField>
          </div>
        </form>
      </FormProvider>
    </Dialog>
  );
}
