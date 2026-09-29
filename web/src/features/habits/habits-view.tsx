'use client';

import { useEffect, useMemo, useState } from 'react';
import { Archive, Check, Flame, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { FormField } from '@/components/forms/form-field';
import {
  useCreateHabit,
  useDeleteHabit,
  useDeleteCheckin,
  useHabitCheckins,
  useHabits,
  usePutCheckin,
  useRestoreHabit,
  useTodayProgress,
  useUpdateHabit
} from './hooks';
import { habitFormDefaults, habitFormSchema, toHabitBody, type HabitFormValues } from './schemas';
import { useAuth } from '@/lib/auth/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { addDays, formatDateOnly, getUserToday } from '@/lib/date/format';
import { ApiError, fieldErrorsOf } from '@/lib/api/errors';
import type { HabitDto } from '@/types/api';
import { cn } from '@/lib/utils';

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' }
];

export function HabitsView() {
  const { user } = useAuth();
  const timezone = user?.timezone || 'UTC';
  const today = useMemo(() => getUserToday(timezone), [timezone]);
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HabitDto | null>(null);
  const [deleting, setDeleting] = useState<HabitDto | null>(null);
  const [historyFor, setHistoryFor] = useState<HabitDto | null>(null);
  const [lastDeleted, setLastDeleted] = useState<HabitDto | null>(null);

  const habits = useHabits({ status: statusFilter || undefined, limit: 50 });
  const progress = useTodayProgress();
  const putCheckin = usePutCheckin();
  const deleteCheckin = useDeleteCheckin();
  const deleteHabit = useDeleteHabit();
  const restoreHabit = useRestoreHabit();

  const rows = habits.data?.data ?? [];

  const handleToggle = async (habit: HabitDto, done: boolean) => {
    try {
      if (done) {
        await deleteCheckin.mutateAsync({ habitId: habit.id, date: today });
        toast({ title: 'Check-in removed', variant: 'success' });
      } else {
        await putCheckin.mutateAsync({ habitId: habit.id, date: today, status: 'done' });
        toast({ title: `${habit.name} checked off`, variant: 'success' });
      }
    } catch (error) {
      toast({
        title: 'Could not update check-in',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        void habits.refetch();
        void progress.refetch();
      }
    }
  };

  const handleSkip = async (habit: HabitDto) => {
    try {
      await putCheckin.mutateAsync({ habitId: habit.id, date: today, status: 'skipped' });
      toast({ title: `${habit.name} skipped for today`, variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not save',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const updateHabit = useUpdateHabit();

  const putStatus = async (habit: HabitDto, status: HabitDto['status']) => {
    await updateHabit.mutateAsync({ id: habit.id, body: { status, version: habit.version } });
    toast({
      title: status === 'archived' ? 'Habit archived' : 'Habit active again',
      variant: 'success'
    });
  };

  const handleArchiveToggle = async (habit: HabitDto) => {
    try {
      await putStatus(habit, habit.status === 'archived' ? 'active' : 'archived');
    } catch (error) {
      toast({
        title: 'Could not update habit',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteHabit.mutateAsync(deleting.id);
      setLastDeleted(deleting);
      toast({ title: 'Habit deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete habit',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleUndo = async () => {
    if (!lastDeleted) return;
    try {
      await restoreHabit.mutateAsync(lastDeleted.id);
      setLastDeleted(null);
      toast({ title: 'Habit restored', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not restore habit',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const summary = progress.data?.progress;

  return (
    <div>
      <PageHeader
        title="Habits"
        description="Daily and weekly practices with streaks computed by the server."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New habit
          </Button>
        }
      />

      {summary ? (
        <Card className="mb-6">
          <CardContent className="pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Today’s progress · {formatDateOnly(today)}
                </p>
                <p className="text-lg font-semibold text-foreground">
                  {summary.done} of {summary.totalScheduled} done
                  {summary.skipped > 0 ? ` · ${summary.skipped} skipped` : ''}
                </p>
              </div>
              <span className="text-2xl font-semibold tabular-nums text-primary">
                {summary.percent}%
              </span>
            </div>
            <Progress value={summary.percent} label="Habits completed today" className="mt-3" />
          </CardContent>
        </Card>
      ) : null}

      {lastDeleted ? (
        <div className="mb-4">
          <Alert variant="info" title={`“${lastDeleted.name}” was deleted`}>
            <div className="mt-1 flex items-center gap-3">
              <span>Restore it within 30 days.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                loading={restoreHabit.isPending}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Undo
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      <div className="mb-4">
        <label className="flex w-40 flex-col gap-1 text-xs font-medium text-muted-foreground">
          Status
          <Select
            aria-label="Filter habits by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">Active & paused</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </Select>
        </label>
      </div>

      <AsyncContent
        isLoading={habits.isLoading}
        isError={habits.isError}
        error={habits.error}
        isEmpty={rows.length === 0}
        onRetry={() => void habits.refetch()}
        emptyTitle="No habits yet"
        emptyDescription="Build consistency — create your first habit."
        emptyIcon={<Flame className="size-8" />}
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New habit
          </Button>
        }
        skeletonRows={4}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              today={today}
              checkinBusy={putCheckin.isPending || deleteCheckin.isPending}
              onToggle={(done) => void handleToggle(habit, done)}
              onSkip={() => void handleSkip(habit)}
              onEdit={() => {
                setEditing(habit);
                setDialogOpen(true);
              }}
              onArchiveToggle={() => void handleArchiveToggle(habit)}
              onDelete={() => setDeleting(habit)}
              onHistory={() => setHistoryFor(habit)}
            />
          ))}
        </div>
      </AsyncContent>

      <HabitFormDialog
        open={dialogOpen}
        habit={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
      />

      <CheckinHistoryDialog habit={historyFor} onClose={() => setHistoryFor(null)} today={today} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this habit?"
        description={`“${deleting?.name ?? ''}” will be soft-deleted (restorable for 30 days). Check-in history is kept.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

/* --------------------------------- Card ---------------------------------- */

/**
 * One habit card. Today's check-in state comes from
 * `GET /habits/:id/checkins?from=today&to=today` — the runtime API has no
 * per-habit field on the list DTO and the progress endpoint returns
 * aggregates only, so each card resolves its own single-day check-in
 * (queries are cached and invalidated together under ['habits']).
 */
function HabitCard({
  habit,
  today,
  checkinBusy,
  onToggle,
  onSkip,
  onEdit,
  onArchiveToggle,
  onDelete,
  onHistory
}: {
  habit: HabitDto;
  today: string;
  checkinBusy: boolean;
  onToggle: (done: boolean) => void;
  onSkip: () => void;
  onEdit: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onHistory: () => void;
}) {
  const checkins = useHabitCheckins(habit.id, today, today);
  const todayRows = checkins.data?.data ?? [];
  const doneToday = todayRows.some((checkin) => checkin.status === 'done');
  const skippedToday = !doneToday && todayRows.some((checkin) => checkin.status === 'skipped');

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: habit.color ?? 'var(--primary)' }}
              aria-hidden="true"
            />
            <span className="truncate">{habit.name}</span>
          </CardTitle>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge
              variant={
                habit.status === 'active'
                  ? 'success'
                  : habit.status === 'paused'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {habit.status}
            </Badge>
            <Badge variant="neutral">
              {habit.recurrence.freq === 'weekly'
                ? `weekly ×${habit.recurrence.interval}`
                : `daily ×${habit.recurrence.interval}`}
            </Badge>
            {habit.reminderTime ? <Badge variant="info">remind {habit.reminderTime}</Badge> : null}
            {skippedToday ? <Badge variant="warning">skipped today</Badge> : null}
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit habit “${habit.name}”`}
            onClick={onEdit}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              habit.status === 'archived'
                ? `Unarchive habit “${habit.name}”`
                : `Archive habit “${habit.name}”`
            }
            onClick={onArchiveToggle}
          >
            <Archive className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete habit “${habit.name}”`}
            onClick={onDelete}
          >
            <Trash2 className="size-4 text-danger" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {habit.description ? (
          <p className="text-sm text-muted-foreground">{habit.description}</p>
        ) : null}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Streak <strong className="text-foreground">{habit.currentStreak}</strong> · best{' '}
            {habit.longestStreak}
          </span>
          <span className="text-xs text-subtle-foreground">
            since {formatDateOnly(habit.startDate)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={doneToday ? 'secondary' : 'primary'}
            aria-pressed={doneToday}
            onClick={() => onToggle(doneToday)}
            disabled={habit.status === 'archived'}
            loading={checkinBusy}
            className={cn(doneToday && 'line-through')}
          >
            {doneToday ? (
              <>
                <Check className="size-4" aria-hidden="true" /> Done today
              </>
            ) : (
              'Check off today'
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onSkip}
            disabled={habit.status === 'archived'}
          >
            <X className="size-4" aria-hidden="true" />
            Skip
          </Button>
          <Button size="sm" variant="ghost" onClick={onHistory}>
            History
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Form dialog ------------------------------ */

function HabitFormDialog({
  open,
  habit,
  onClose
}: {
  open: boolean;
  habit: HabitDto | null;
  onClose: () => void;
}) {
  const create = useCreateHabit();
  const update = useUpdateHabit();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);

  const methods = useForm<HabitFormValues>({
    resolver: zodResolver(habitFormSchema),
    defaultValues: habitFormDefaults
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    methods.reset(
      habit
        ? {
            name: habit.name,
            description: habit.description ?? '',
            startDate: habit.startDate,
            reminderTime: habit.reminderTime ?? '',
            color: habit.color ?? '',
            goalId: habit.goalId ?? '',
            freq: habit.recurrence.freq,
            interval: String(habit.recurrence.interval),
            byWeekday: habit.recurrence.byWeekday ?? []
          }
        : { ...habitFormDefaults, startDate: new Date().toISOString().slice(0, 10) }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, habit?.id]);

  const freq = methods.watch('freq');
  const byWeekday = methods.watch('byWeekday') ?? [];

  const toggleWeekday = (day: number) => {
    const current = methods.getValues('byWeekday') ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    methods.setValue('byWeekday', next, { shouldDirty: true });
  };

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (habit) {
        await update.mutateAsync({
          id: habit.id,
          body: { ...toHabitBody(values), version: habit.version }
        });
        toast({ title: 'Habit updated', variant: 'success' });
      } else {
        await create.mutateAsync(toHabitBody(values));
        toast({ title: 'Habit created', variant: 'success' });
      }
      onClose();
    } catch (error) {
      for (const [name, message] of Object.entries(fieldErrorsOf(error))) {
        methods.setError(name as keyof HabitFormValues, { message });
      }
      setFormError(error instanceof ApiError ? error.userMessage : 'Could not save the habit.');
    }
  });

  const busy = create.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={habit ? 'Edit habit' : 'New habit'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={busy}>
            {habit ? 'Save changes' : 'Create habit'}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <FormField<HabitFormValues> name="name" label="Name" required>
            {(props) => <Input {...props} maxLength={120} autoFocus required />}
          </FormField>
          <FormField<HabitFormValues> name="description" label="Description">
            {(props) => <Textarea {...props} rows={2} maxLength={5000} />}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<HabitFormValues> name="startDate" label="Start date" required>
              {(props) => <Input {...props} type="date" />}
            </FormField>
            <FormField<HabitFormValues> name="reminderTime" label="Reminder time">
              {(props) => <Input {...props} type="time" />}
            </FormField>
            <FormField<HabitFormValues> name="freq" label="Repeats" required>
              {(props) => (
                <Select {...props} value={freq}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </Select>
              )}
            </FormField>
            <FormField<HabitFormValues> name="interval" label="Every N periods" required>
              {(props) => <Input {...props} type="number" min={1} max={999} />}
            </FormField>
          </div>

          {freq === 'weekly' ? (
            <div role="group" aria-label="Weekdays">
              <p className="mb-1.5 text-sm font-medium">Weekdays</p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={byWeekday.includes(day.value)}
                    onClick={() => toggleWeekday(day.value)}
                    className={
                      byWeekday.includes(day.value)
                        ? 'rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-on-primary'
                        : 'rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-sunken'
                    }
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              {methods.formState.errors.byWeekday?.message ? (
                <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                  {methods.formState.errors.byWeekday.message}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<HabitFormValues> name="color" label="Color (hex)">
              {(props) => <Input {...props} placeholder="#315C4C" maxLength={7} />}
            </FormField>
            <FormField<HabitFormValues> name="goalId" label="Linked goal (UUID)">
              {(props) => <Input {...props} placeholder="Optional" />}
            </FormField>
          </div>
        </form>
      </FormProvider>
    </Dialog>
  );
}

/* --------------------------- Check-in history ---------------------------- */

function CheckinHistoryDialog({
  habit,
  onClose,
  today
}: {
  habit: HabitDto | null;
  onClose: () => void;
  today: string;
}) {
  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const { toast } = useToast();
  const deleteCheckin = useDeleteCheckin();
  const checkins = useHabitCheckins(habit?.id ?? null, from, to);

  useEffect(() => {
    if (habit) {
      setFrom(addDays(today, -29));
      setTo(today);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit?.id]);

  const handleDelete = async (date: string) => {
    if (!habit) return;
    try {
      await deleteCheckin.mutateAsync({ habitId: habit.id, date });
      toast({ title: 'Check-in removed', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not remove check-in',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const rows = checkins.data?.data ?? [];

  return (
    <Dialog
      open={Boolean(habit)}
      onClose={onClose}
      title={`Check-in history — ${habit?.name ?? ''}`}
      description="Raw check-ins for a date range (the server owns streak calculations)."
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="mb-4 flex items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      <AsyncContent
        isLoading={checkins.isLoading}
        isError={checkins.isError}
        error={checkins.error}
        isEmpty={rows.length === 0}
        onRetry={() => void checkins.refetch()}
        emptyTitle="No check-ins in this range"
        emptyDescription="Pick a wider date range (up to 366 days)."
        skeletonRows={3}
      >
        <ul className="divide-y divide-border">
          {rows.map((checkin) => (
            <li key={checkin.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-medium">{formatDateOnly(checkin.checkinDate)}</p>
                {checkin.note ? (
                  <p className="text-xs text-muted-foreground">{checkin.note}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={checkin.status === 'done' ? 'success' : 'neutral'}>
                  {checkin.status}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove check-in for ${checkin.checkinDate}`}
                  onClick={() => void handleDelete(checkin.checkinDate)}
                  loading={deleteCheckin.isPending}
                >
                  <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </AsyncContent>
    </Dialog>
  );
}
