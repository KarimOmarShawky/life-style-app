'use client';

import Link from 'next/link';
import { ArrowRight, CalendarDays, CheckSquare, Circle, Flame, Timer } from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/lib/auth/auth-provider';
import { formatTimeOfDay, getUserToday } from '@/lib/date/format';
import { useTasks } from '@/features/tasks/hooks';
import { useAgenda } from '@/features/events/hooks';
import { useTodayProgress } from '@/features/habits/hooks';
import { useActiveTimer } from '@/features/timer-sessions/hooks';
import { WORKSPACE_ROUTES } from '@/lib/config/routes';
import type { Task } from '@/types/api';

export function TodayView() {
  const { user } = useAuth();
  const timezone = user?.timezone;
  const today = getUserToday(timezone);

  const tasks = useTasks({
    status: 'todo,in_progress',
    dueFrom: today,
    dueTo: today,
    sort: 'dueDate',
    order: 'asc',
    limit: 10
  });
  const agenda = useAgenda(today);
  const progress = useTodayProgress();
  const activeTimer = useActiveTimer();

  const progressData = progress.data?.progress;
  const timer = activeTimer.data?.timerSession ?? null;

  return (
    <div>
      <PageHeader
        title="Today"
        description={new Intl.DateTimeFormat('en', {
          timeZone: timezone || 'UTC',
          weekday: 'long',
          month: 'long',
          day: 'numeric'
        }).format(new Date())}
      />

      {timer ? (
        <div className="mb-6">
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
              <span className="flex items-center gap-2 text-sm">
                <Timer className="size-4 text-primary" aria-hidden="true" />
                Timer running
                {timer.taskId ? <span className="text-muted-foreground">on a task</span> : null}
                <span className="font-mono text-muted-foreground">
                  since {formatTimeOfDay(timer.startedAt, timezone)}
                </span>
              </span>
              <Link
                href={WORKSPACE_ROUTES.focus}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              >
                Open Focus
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Tasks due today */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckSquare className="size-4" aria-hidden="true" />
              Due today
            </CardTitle>
            <Link
              href={WORKSPACE_ROUTES.tasks}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              All tasks
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent>
            <AsyncContent
              isLoading={tasks.isLoading}
              isError={tasks.isError}
              error={tasks.error}
              isEmpty={(tasks.data?.data.length ?? 0) === 0}
              onRetry={() => void tasks.refetch()}
              emptyTitle="Nothing due today"
              emptyDescription="Enjoy the space, or plan ahead in Tasks."
              emptyIcon={<CheckSquare className="size-8" />}
              skeletonRows={4}
            >
              <ul className="space-y-3">
                {(tasks.data?.data ?? []).map((task: Task) => (
                  <li key={task.id} className="flex items-start gap-2 text-sm">
                    <Circle
                      className={`mt-0.5 size-3.5 shrink-0 ${
                        task.status === 'done' ? 'text-success' : 'text-subtle-foreground'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="flex-1">
                      <span className="font-medium">{task.title}</span>
                      {task.dueTime ? (
                        <span className="ml-2 text-xs text-subtle-foreground">{task.dueTime}</span>
                      ) : null}
                    </span>
                    <TaskPriorityBadge priority={task.priority} />
                  </li>
                ))}
              </ul>
            </AsyncContent>
          </CardContent>
        </Card>

        {/* Agenda */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4" aria-hidden="true" />
              Schedule
            </CardTitle>
            <Link
              href={WORKSPACE_ROUTES.calendar}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Calendar
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent>
            <AsyncContent
              isLoading={agenda.isLoading}
              isError={agenda.isError}
              error={agenda.error}
              isEmpty={(agenda.data?.events.length ?? 0) === 0}
              onRetry={() => void agenda.refetch()}
              emptyTitle="No events today"
              emptyDescription="Your calendar is clear."
              emptyIcon={<CalendarDays className="size-8" />}
              skeletonRows={4}
            >
              <ul className="space-y-3">
                {(agenda.data?.events ?? []).map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-2 text-sm">
                    <span>
                      <span className="font-medium">{event.title}</span>
                      <span className="block text-xs text-subtle-foreground">
                        {event.allDay
                          ? 'All day'
                          : `${formatTimeOfDay(event.startAt, timezone)} – ${formatTimeOfDay(
                              event.endAt,
                              timezone
                            )}`}
                      </span>
                    </span>
                    {event.location ? (
                      <span className="truncate text-xs text-subtle-foreground">
                        {event.location}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </AsyncContent>
          </CardContent>
        </Card>

        {/* Habits */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="size-4" aria-hidden="true" />
              Habits today
            </CardTitle>
            <Link
              href={WORKSPACE_ROUTES.habits}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Habits
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent>
            <AsyncContent
              isLoading={progress.isLoading}
              isError={progress.isError}
              error={progress.error}
              isEmpty={!progressData || progressData.totalScheduled === 0}
              onRetry={() => void progress.refetch()}
              emptyTitle="No habits scheduled"
              emptyDescription="Create habits to build a daily rhythm."
              emptyIcon={<Flame className="size-8" />}
              skeletonRows={4}
            >
              {progressData ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {progressData.done} / {progressData.totalScheduled} done
                      {progressData.skipped > 0 ? ` · ${progressData.skipped} skipped` : ''}
                    </span>
                    <span className="tabular-nums">{progressData.percent}%</span>
                  </div>
                  <Progress
                    value={progressData.percent}
                    label={`Daily completion: ${progressData.percent}%`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Open Habits to check habits off — streaks and progress are computed by the
                    server.
                  </p>
                </div>
              ) : null}
            </AsyncContent>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TaskPriorityBadge({ priority }: { priority: Task['priority'] }) {
  if (priority === 'high') return <Badge variant="danger">High</Badge>;
  if (priority === 'medium') return <Badge variant="warning">Medium</Badge>;
  if (priority === 'low') return <Badge variant="neutral">Low</Badge>;
  return null;
}
