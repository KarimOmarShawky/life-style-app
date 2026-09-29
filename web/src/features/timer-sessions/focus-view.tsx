'use client';

import { useEffect, useMemo, useState } from 'react';
import { CircleStop, Play, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import {
  useActiveTimer,
  useDeleteTimerSession,
  useStartTimer,
  useStopTimer,
  useTimerSessions
} from './hooks';
import { useAuth } from '@/lib/auth/auth-provider';
import { useTasks } from '@/features/tasks/hooks';
import { useToast } from '@/providers/toast-provider';
import { formatDuration, formatTimestamp } from '@/lib/date/format';
import { ApiError } from '@/lib/api/errors';
import type { TimerSession } from '@/types/api';

function elapsedSeconds(session: TimerSession, nowMs: number): number {
  const started = Date.parse(session.startedAt);
  if (Number.isNaN(started)) return session.durationSeconds;
  const ended = session.endedAt ? Date.parse(session.endedAt) : nowMs;
  return Math.max(0, Math.floor((ended - started) / 1000));
}

export function FocusView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const active = useActiveTimer();
  const sessions = useTimerSessions({ limit: 25 });
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();
  const deleteSession = useDeleteTimerSession();

  const openTasks = useTasks({
    status: 'todo,in_progress',
    sort: 'createdAt',
    order: 'desc',
    limit: 25
  });

  const [taskId, setTaskId] = useState('');
  const [mode, setMode] = useState<'stopwatch' | 'countdown'>('stopwatch');
  const [plannedMinutes, setPlannedMinutes] = useState('25');
  const [deleting, setDeleting] = useState<TimerSession | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const activeSession = active.data?.timerSession ?? null;

  // Tick the running clock once per second (display only).
  useEffect(() => {
    if (!activeSession) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activeSession]);

  const taskOptions = useMemo(() => openTasks.data?.data ?? [], [openTasks.data]);

  const handleStart = async () => {
    if (!taskId) {
      toast({
        title: 'Pick a task first',
        description: 'Choose the task to focus on.',
        variant: 'info'
      });
      return;
    }
    const minutes = Number.parseInt(plannedMinutes, 10);
    try {
      await startTimer.mutateAsync({
        taskId,
        mode,
        ...(mode === 'countdown'
          ? { plannedSeconds: Math.min(43200, Math.max(60, minutes * 60)) }
          : {})
      });
      toast({ title: 'Timer started', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not start timer',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleStop = async () => {
    if (!activeSession) return;
    try {
      const result = await stopTimer.mutateAsync(activeSession.id);
      toast({
        title: 'Timer stopped',
        description: `${formatDuration(result.timerSession.durationSeconds)} recorded.`,
        variant: 'success'
      });
    } catch (error) {
      toast({
        title: 'Could not stop timer',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteSession.mutateAsync(deleting.id);
      toast({ title: 'Session deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete session',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const rows = sessions.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Focus"
        description="Track time against tasks with the timer API — stopwatch or countdown."
      />

      {/* Active timer / start controls */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{activeSession ? 'Timer running' : 'Start a focus session'}</CardTitle>
          <CardDescription>
            {activeSession
              ? 'One timer runs at a time — the server enforces this.'
              : 'Pick a task and press start. The server derives durations from timestamps.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {active.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking for an active timer…</p>
          ) : active.isError ? (
            <Alert variant="error">Couldn’t load the active timer.</Alert>
          ) : activeSession ? (
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Now focusing on</p>
                <p className="text-lg font-semibold text-foreground">
                  {taskOptions.find((task) => task.id === activeSession.taskId)?.title ??
                    'Your task'}
                </p>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant={activeSession.mode === 'countdown' ? 'info' : 'neutral'}>
                    {activeSession.mode}
                  </Badge>
                  <span>
                    started {formatTimestamp(activeSession.startedAt, user?.timezone ?? undefined)}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span
                  className="font-mono text-4xl font-semibold tabular-nums text-primary"
                  aria-label="Elapsed time"
                >
                  {formatDuration(elapsedSeconds(activeSession, nowMs))}
                </span>
                <Button onClick={handleStop} loading={stopTimer.isPending}>
                  <CircleStop className="size-4" aria-hidden="true" />
                  Stop
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Label htmlFor="focus-task">Task</Label>
                <Select
                  id="focus-task"
                  value={taskId}
                  onChange={(event) => setTaskId(event.target.value)}
                  className="mt-1.5"
                >
                  <option value="">
                    {openTasks.isLoading ? 'Loading tasks…' : 'Choose a task…'}
                  </option>
                  {taskOptions.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="focus-mode">Mode</Label>
                <Select
                  id="focus-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as 'stopwatch' | 'countdown')}
                  className="mt-1.5"
                >
                  <option value="stopwatch">Stopwatch</option>
                  <option value="countdown">Countdown</option>
                </Select>
              </div>
              {mode === 'countdown' ? (
                <div>
                  <Label htmlFor="focus-minutes">Minutes</Label>
                  <Input
                    id="focus-minutes"
                    type="number"
                    min={1}
                    max={720}
                    value={plannedMinutes}
                    onChange={(event) => setPlannedMinutes(event.target.value)}
                    className="mt-1.5"
                  />
                </div>
              ) : null}
              <div className="sm:col-span-4">
                <Button onClick={handleStart} loading={startTimer.isPending}>
                  <Play className="size-4" aria-hidden="true" />
                  Start timer
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Session history */}
      <h2 className="mb-3 text-lg font-semibold text-foreground">Recent sessions</h2>
      <AsyncContent
        isLoading={sessions.isLoading}
        isError={sessions.isError}
        error={sessions.error}
        isEmpty={rows.length === 0}
        onRetry={() => void sessions.refetch()}
        emptyTitle="No sessions yet"
        emptyDescription="Start a timer above and your focus history will appear here."
        skeletonRows={4}
      >
        <div className="space-y-2">
          {rows.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {taskOptions.find((task) => task.id === session.taskId)?.title ?? 'Task'}{' '}
                  <span className="ml-1 font-normal text-subtle-foreground">
                    #{session.id.slice(0, 8)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatTimestamp(session.startedAt, user?.timezone)}
                  {session.endedAt
                    ? ` → ${formatTimestamp(session.endedAt, user?.timezone)}`
                    : ' · running'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="neutral">{session.mode}</Badge>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {formatDuration(session.durationSeconds)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete session"
                  onClick={() => setDeleting(session)}
                >
                  <Trash2 className="size-4 text-danger" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </AsyncContent>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this session?"
        description="The recorded time will be removed from your history."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
