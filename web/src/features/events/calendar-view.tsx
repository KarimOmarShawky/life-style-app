'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, MapPin, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { FormField } from '@/components/forms/form-field';
import {
  useAddReminder,
  useAgenda,
  useCreateEvent,
  useDeleteEvent,
  useDeleteReminder,
  useEventReminders,
  useEvents,
  useRestoreEvent,
  useUpdateEvent
} from './hooks';
import { eventsApi } from './api';
import { eventFormDefaults, eventFormSchema, type EventFormValues } from './schemas';
import { useAuth } from '@/lib/auth/auth-provider';
import { useToast } from '@/providers/toast-provider';
import {
  addDays,
  formatDateOnly,
  formatTimestamp,
  getUserToday,
  zonedDateTimeToUtc
} from '@/lib/date/format';
import { ApiError, fieldErrorsOf } from '@/lib/api/errors';
import type { CreateEventBody, Event } from '@/types/api';

export function CalendarView() {
  const { user, session } = useAuth();
  const timezone = user?.timezone || 'UTC';
  const today = useMemo(() => getUserToday(timezone), [timezone]);
  const { toast } = useToast();

  const [rangeStart, setRangeStart] = useState(() => addDays(today, -7));
  const [rangeEnd, setRangeEnd] = useState(() => addDays(today, 30));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [deleting, setDeleting] = useState<Event | null>(null);
  const [reminding, setReminding] = useState<Event | null>(null);
  const [lastDeleted, setLastDeleted] = useState<Event | null>(null);

  const events = useEvents({
    from: `${rangeStart}T00:00:00.000Z`,
    to: `${rangeEnd}T23:59:59.999Z`
  });
  const agenda = useAgenda(today);
  const deleteEvent = useDeleteEvent();
  const restoreEvent = useRestoreEvent();

  const rows = events.data?.events ?? [];

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteEvent.mutateAsync(deleting.id);
      setLastDeleted(deleting);
      toast({
        title: 'Event deleted',
        description: 'Reminders were cancelled.',
        variant: 'success'
      });
    } catch (error) {
      toast({
        title: 'Could not delete event',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleUndo = async () => {
    if (!lastDeleted) return;
    try {
      await restoreEvent.mutateAsync(lastDeleted.id);
      setLastDeleted(null);
      toast({ title: 'Event restored', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not restore event',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Events, agenda, and reminders — timestamps are stored as absolute instants."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" />
            New event
          </Button>
        }
      />

      {lastDeleted ? (
        <div className="mb-4">
          <Alert variant="info" title={`“${lastDeleted.title}” was deleted`}>
            <div className="mt-1 flex items-center gap-3">
              <span>Restore it within 30 days.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                loading={restoreEvent.isPending}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Undo
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      {/* Today's agenda */}
      <section aria-labelledby="agenda-heading" className="mb-6">
        <h2 id="agenda-heading" className="mb-3 text-lg font-semibold text-foreground">
          Today · {formatDateOnly(today)}
        </h2>
        <AsyncContent
          isLoading={agenda.isLoading}
          isError={agenda.isError}
          error={agenda.error}
          isEmpty={(agenda.data?.totalEvents ?? 0) === 0}
          onRetry={() => void agenda.refetch()}
          emptyTitle="Nothing scheduled today"
          emptyDescription="A clear day — create an event if you need one."
          emptyIcon={<CalendarDays className="size-8" />}
          skeletonRows={3}
        >
          <div className="space-y-2">
            {(agenda.data?.events ?? []).map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.allDay
                      ? 'All day'
                      : `${formatTimestamp(event.startAt, timezone)} – ${formatTimestamp(event.endAt, timezone)}`}
                    {event.location ? ` · ${event.location}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="neutral">{event.timezone}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit “${event.title}”`}
                    onClick={() => {
                      setEditing(event);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete “${event.title}”`}
                    onClick={() => setDeleting(event)}
                  >
                    <Trash2 className="size-4 text-danger" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </AsyncContent>
      </section>

      {/* Range list */}
      <section aria-labelledby="range-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="range-heading" className="text-lg font-semibold text-foreground">
            Upcoming events
          </h2>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              From
              <Input
                type="date"
                value={rangeStart}
                onChange={(event) => setRangeStart(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              To
              <Input
                type="date"
                value={rangeEnd}
                onChange={(event) => setRangeEnd(event.target.value)}
              />
            </label>
          </div>
        </div>

        <AsyncContent
          isLoading={events.isLoading}
          isError={events.isError}
          error={events.error}
          isEmpty={rows.length === 0}
          onRetry={() => void events.refetch()}
          emptyTitle="No events in this range"
          emptyDescription="Widen the range or create an event."
          emptyIcon={<CalendarDays className="size-8" />}
          emptyAction={
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              New event
            </Button>
          }
          skeletonRows={4}
        >
          <div className="space-y-2">
            {rows.map((event) => (
              <Card key={event.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{event.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>
                        {event.allDay
                          ? `${formatDateOnly(event.startAt.slice(0, 10))} · all day`
                          : `${formatTimestamp(event.startAt, timezone)} – ${formatTimestamp(event.endAt, timezone)}`}
                      </span>
                      {event.location ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" aria-hidden="true" />
                          {event.location}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Reminders for “${event.title}”`}
                      onClick={() => setReminding(event)}
                    >
                      <Bell className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit “${event.title}”`}
                      onClick={() => {
                        setEditing(event);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete “${event.title}”`}
                      onClick={() => setDeleting(event)}
                    >
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </AsyncContent>
      </section>

      <EventFormDialog
        open={dialogOpen}
        event={editing}
        timezone={timezone}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        session={session}
      />

      <RemindersDialog event={reminding} onClose={() => setReminding(null)} timezone={timezone} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this event?"
        description={`“${deleting?.title ?? ''}” will be soft-deleted and its pending reminders cancelled (restorable for 30 days).`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function EventFormDialog({
  open,
  event,
  timezone,
  onClose,
  session
}: {
  open: boolean;
  event: Event | null;
  timezone: string;
  onClose: () => void;
  session: ReturnType<typeof useAuth>['session'];
}) {
  const createEventMutation = useCreateEvent();
  const updateEventMutation = useUpdateEvent();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  const methods = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: eventFormDefaults
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setConflictWarning(null);
    if (event) {
      const startDate = event.startAt.slice(0, 10);
      const endDate = event.endAt.slice(0, 10);
      const startParts = event.allDay
        ? { startTime: '00:00', endTime: '00:00' }
        : {
            startTime: formatHm(event.startAt, timezone),
            endTime: formatHm(event.endAt, timezone)
          };
      methods.reset({
        title: event.title,
        description: event.description ?? '',
        location: event.location ?? '',
        startDate,
        endDate,
        ...startParts,
        allDay: event.allDay
      });
    } else {
      const now = getUserToday(timezone);
      methods.reset({ ...eventFormDefaults, startDate: now, endDate: now });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id]);

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    const startAt = values.allDay
      ? `${values.startDate}T00:00:00.000Z`
      : zonedDateTimeToUtc(values.startDate, values.startTime, timezone);
    const endAt = values.allDay
      ? `${values.endDate}T23:59:59.999Z`
      : zonedDateTimeToUtc(values.endDate, values.endTime, timezone);

    if (!startAt || !endAt) {
      setFormError('Enter a valid date and time.');
      return;
    }

    try {
      // Non-blocking conflict check against the server before creating.
      if (!event && !conflictWarning) {
        const conflicts = await eventsApi.conflicts(startAt, endAt, undefined, session);
        if (conflicts.hasConflict) {
          setConflictWarning(
            `This overlaps ${conflicts.conflicts.length} existing event(s). Save again to create it anyway.`
          );
          return;
        }
      }

      if (event) {
        await updateEventMutation.mutateAsync({
          id: event.id,
          body: {
            title: values.title.trim(),
            description: values.description || null,
            location: values.location || null,
            startAt,
            endAt,
            allDay: values.allDay,
            timezone,
            version: event.version
          }
        });
        toast({ title: 'Event updated', variant: 'success' });
      } else {
        const body: CreateEventBody = {
          title: values.title.trim(),
          description: values.description || null,
          location: values.location || null,
          startAt,
          endAt,
          allDay: values.allDay,
          timezone
        };
        await createEventMutation.mutateAsync(body);
        toast({ title: 'Event created', variant: 'success' });
      }
      onClose();
    } catch (error) {
      for (const [name, message] of Object.entries(fieldErrorsOf(error))) {
        methods.setError(name as keyof EventFormValues, { message });
      }
      setFormError(error instanceof ApiError ? error.userMessage : 'Could not save the event.');
    }
  });

  const busy = createEventMutation.isPending || updateEventMutation.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={event ? 'Edit event' : 'New event'}
      description={`Times are entered in your profile time zone (${timezone}).`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={busy}>
            {event ? 'Save changes' : 'Create event'}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          {conflictWarning ? <Alert variant="warning">{conflictWarning}</Alert> : null}
          <FormField<EventFormValues> name="title" label="Title" required>
            {(props) => <Input {...props} maxLength={200} autoFocus required />}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<EventFormValues> name="description" label="Description">
              {(props) => <Textarea {...props} rows={2} maxLength={5000} />}
            </FormField>
            <FormField<EventFormValues> name="location" label="Location">
              {(props) => <Input {...props} maxLength={300} />}
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<EventFormValues> name="startDate" label="Start date" required>
              {(props) => <Input {...props} type="date" />}
            </FormField>
            {!methods.watch('allDay') ? (
              <FormField<EventFormValues> name="startTime" label="Start time" required>
                {(props) => <Input {...props} type="time" />}
              </FormField>
            ) : null}
            <FormField<EventFormValues> name="endDate" label="End date" required>
              {(props) => <Input {...props} type="date" />}
            </FormField>
            {!methods.watch('allDay') ? (
              <FormField<EventFormValues> name="endTime" label="End time" required>
                {(props) => <Input {...props} type="time" />}
              </FormField>
            ) : null}
          </div>
          <FormField<EventFormValues> name="allDay" label="All day">
            {(props) => (
              <Checkbox
                id={props.id}
                checked={methods.watch('allDay')}
                onChange={(event) => methods.setValue('allDay', event.target.checked)}
                label="All-day event"
              />
            )}
          </FormField>
        </form>
      </FormProvider>
    </Dialog>
  );
}

function RemindersDialog({
  event,
  onClose,
  timezone
}: {
  event: Event | null;
  onClose: () => void;
  timezone: string;
}) {
  const { toast } = useToast();
  const reminders = useEventReminders(event?.id ?? null);
  const addReminder = useAddReminder();
  const deleteReminder = useDeleteReminder();
  const [offset, setOffset] = useState('15');

  const rows = reminders.data?.reminders ?? [];

  return (
    <Dialog
      open={Boolean(event)}
      onClose={onClose}
      title={`Reminders — ${event?.title ?? ''}`}
      description="Reminders are scheduled server-side and cancelled when the event is deleted."
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <AsyncContent
        isLoading={reminders.isLoading}
        isError={reminders.isError}
        error={reminders.error}
        isEmpty={rows.length === 0}
        onRetry={() => void reminders.refetch()}
        emptyTitle="No reminders yet"
        emptyDescription="Add an in-app reminder before the event starts."
        skeletonRows={2}
      >
        <ul className="divide-y divide-border">
          {rows.map((reminder) => (
            <li key={reminder.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-medium">
                  {formatTimestamp(reminder.remindAt, timezone)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {reminder.channel} · {reminder.status}
                  {reminder.offsetMinutes != null ? ` · −${reminder.offsetMinutes}m` : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete reminder"
                onClick={() =>
                  void deleteReminder
                    .mutateAsync({ eventId: event!.id, reminderId: reminder.id })
                    .catch((error: unknown) =>
                      toast({
                        title: 'Could not delete reminder',
                        description: error instanceof ApiError ? error.userMessage : undefined,
                        variant: 'error'
                      })
                    )
                }
              >
                <Trash2 className="size-4 text-danger" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </AsyncContent>

      <div className="mt-4 flex items-end gap-2 border-t border-border pt-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Remind me N minutes before
          <Input
            type="number"
            min={0}
            max={43200}
            value={offset}
            onChange={(changeEvent) => setOffset(changeEvent.target.value)}
            className="w-32"
          />
        </label>
        <Button
          size="sm"
          loading={addReminder.isPending}
          onClick={() =>
            void addReminder
              .mutateAsync({
                eventId: event!.id,
                channel: 'in_app',
                offsetMinutes: Number.parseInt(offset, 10) || 0
              })
              .then(() => toast({ title: 'Reminder added', variant: 'success' }))
              .catch((error: unknown) =>
                toast({
                  title: 'Could not add reminder',
                  description: error instanceof ApiError ? error.userMessage : undefined,
                  variant: 'error'
                })
              )
          }
        >
          Add reminder
        </Button>
      </div>
    </Dialog>
  );
}

function formatHm(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '00:00';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour === '24' ? '00' : hour}:${minute}`;
}
