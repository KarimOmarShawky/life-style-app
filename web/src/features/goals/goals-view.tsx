'use client';

import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, RotateCcw, Target, Trash2 } from 'lucide-react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { FormField } from '@/components/forms/form-field';
import {
  useCreateGoal,
  useCreateMilestone,
  useDeleteGoal,
  useDeleteMilestone,
  useGoals,
  useRestoreGoal,
  useUpdateGoal,
  useUpdateMilestone
} from './hooks';
import { goalFormDefaults, goalFormSchema, toGoalBody, type GoalFormValues } from './schemas';
import { useToast } from '@/providers/toast-provider';
import { formatDateOnly } from '@/lib/date/format';
import { formatDecimal, formatPercent } from '@/lib/money/format';
import { ApiError, fieldErrorsOf } from '@/lib/api/errors';
import type { GoalStatusValue } from '@/lib/status-types';
import type { Goal, Milestone } from '@/types/api';

const STATUS_LABELS: Record<GoalStatusValue, string> = {
  active: 'Active',
  paused: 'Paused',
  achieved: 'Achieved',
  abandoned: 'Abandoned'
};

const STATUS_VARIANTS: Record<GoalStatusValue, 'success' | 'warning' | 'info' | 'neutral'> = {
  active: 'success',
  paused: 'warning',
  achieved: 'info',
  abandoned: 'neutral'
};

export function GoalsView() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [lastDeleted, setLastDeleted] = useState<Goal | null>(null);

  const goals = useGoals({
    status: statusFilter || undefined,
    progressType: typeFilter || undefined
  });
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();
  const restoreGoal = useRestoreGoal();

  const rows = goals.data?.goals ?? [];

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteGoal.mutateAsync(deleting.id);
      setLastDeleted(deleting);
      toast({ title: 'Goal deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete goal',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleUndo = async () => {
    if (!lastDeleted) return;
    try {
      await restoreGoal.mutateAsync(lastDeleted.id);
      setLastDeleted(null);
      toast({ title: 'Goal restored', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not restore goal',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleStatus = async (goal: Goal, status: GoalStatusValue) => {
    try {
      await updateGoal.mutateAsync({ id: goal.id, body: { status, version: goal.version } });
      toast({ title: `Goal marked ${STATUS_LABELS[status].toLowerCase()}`, variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not update goal',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') void goals.refetch();
    }
  };

  return (
    <div>
      <PageHeader
        title="Goals"
        description="Numeric targets and milestone paths — progress computed by the server."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New goal
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
                loading={restoreGoal.isPending}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Undo
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Status
          <Select
            aria-label="Filter goals by status"
            className="w-36"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="achieved">Achieved</option>
            <option value="abandoned">Abandoned</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Type
          <Select
            aria-label="Filter goals by type"
            className="w-40"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="">All types</option>
            <option value="numeric">Numeric</option>
            <option value="milestones">Milestones</option>
          </Select>
        </label>
      </div>

      <AsyncContent
        isLoading={goals.isLoading}
        isError={goals.isError}
        error={goals.error}
        isEmpty={rows.length === 0}
        onRetry={() => void goals.refetch()}
        emptyTitle="No goals yet"
        emptyDescription="Set a numeric target or map out milestones for something that matters."
        emptyIcon={<Target className="size-8" />}
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New goal
          </Button>
        }
        skeletonRows={4}
      >
        <div className="space-y-4">
          {rows.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={() => {
                setEditing(goal);
                setDialogOpen(true);
              }}
              onDelete={() => setDeleting(goal)}
              onStatus={(status) => void handleStatus(goal, status)}
              busy={updateGoal.isPending}
            />
          ))}
        </div>
      </AsyncContent>

      <GoalFormDialog
        open={dialogOpen}
        goal={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this goal?"
        description={`“${deleting?.title ?? ''}” will be soft-deleted (restorable for 30 days).`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function GoalCard({
  goal,
  onEdit,
  onDelete,
  onStatus,
  busy
}: {
  goal: Goal;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: (status: GoalStatusValue) => void;
  busy: boolean;
}) {
  const { toast } = useToast();
  const updateGoal = useUpdateGoal();
  const createMilestone = useCreateMilestone();
  const updateMilestone = useUpdateMilestone();
  const deleteMilestone = useDeleteMilestone();
  const [currentValue, setCurrentValue] = useState(goal.currentValue ?? '');

  useEffect(() => {
    setCurrentValue(goal.currentValue ?? '');
  }, [goal.currentValue]);

  const saveCurrent = async () => {
    try {
      await updateGoal.mutateAsync({
        id: goal.id,
        body: { currentValue, version: goal.version }
      });
      toast({ title: 'Progress updated', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not update progress',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const addMilestone = async (title: string, dueDate: string) => {
    if (!title.trim()) return;
    try {
      await createMilestone.mutateAsync({
        goalId: goal.id,
        title: title.trim(),
        dueDate: dueDate || null
      });
      toast({ title: 'Milestone added', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not add milestone',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{goal.title}</CardTitle>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={STATUS_VARIANTS[goal.status]}>{STATUS_LABELS[goal.status]}</Badge>
            <Badge variant="neutral">
              {goal.progressType === 'numeric' ? 'Numeric' : 'Milestones'}
            </Badge>
            {goal.targetDate ? (
              <span className="text-xs text-muted-foreground">
                target {formatDateOnly(goal.targetDate)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit goal “${goal.title}”`}
            onClick={onEdit}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete goal “${goal.title}”`}
            onClick={onDelete}
          >
            <Trash2 className="size-4 text-danger" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {goal.description ? (
          <p className="text-sm text-muted-foreground">{goal.description}</p>
        ) : null}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {goal.progressType === 'numeric'
                ? `${formatDecimal(goal.currentValue ?? '0')} / ${formatDecimal(goal.targetValue ?? '0')}${goal.unit ? ` ${goal.unit}` : ''}`
                : `${goal.completedMilestones ?? 0} / ${goal.totalMilestones ?? 0} milestones`}
            </span>
            <span className="font-semibold tabular-nums text-primary">
              {formatPercent(goal.progressPercentage)}
            </span>
          </div>
          <Progress value={goal.progressPercentage} label={`Progress for ${goal.title}`} />
        </div>

        {goal.progressType === 'numeric' ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Update current value
              <Input
                aria-label={`Current value for ${goal.title}`}
                value={currentValue}
                onChange={(event) => setCurrentValue(event.target.value)}
                inputMode="decimal"
                className="w-36"
                placeholder={goal.targetValue ?? '0'}
              />
            </label>
            <Button
              size="sm"
              onClick={() => void saveCurrent()}
              loading={updateGoal.isPending}
              disabled={busy}
            >
              Save
            </Button>
          </div>
        ) : (
          <MilestonesSection
            goal={goal}
            onAdd={addMilestone}
            onToggle={(milestone, completed) =>
              void (async () => {
                try {
                  await updateMilestone.mutateAsync({
                    goalId: goal.id,
                    milestoneId: milestone.id,
                    body: { completed, version: milestone.version }
                  });
                } catch (error) {
                  toast({
                    title: 'Could not update milestone',
                    description: error instanceof ApiError ? error.userMessage : undefined,
                    variant: 'error'
                  });
                }
              })()
            }
            onDelete={(milestone) =>
              void (async () => {
                try {
                  await deleteMilestone.mutateAsync({
                    goalId: goal.id,
                    milestoneId: milestone.id
                  });
                } catch (error) {
                  toast({
                    title: 'Could not delete milestone',
                    description: error instanceof ApiError ? error.userMessage : undefined,
                    variant: 'error'
                  });
                }
              })()
            }
          />
        )}

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {goal.status === 'active' ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onStatus('achieved')}
                disabled={busy}
              >
                <Check className="size-3.5" aria-hidden="true" />
                Mark achieved
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onStatus('paused')}
                disabled={busy}
              >
                Pause
              </Button>
            </>
          ) : goal.status !== 'achieved' ? (
            <Button size="sm" variant="outline" onClick={() => onStatus('active')} disabled={busy}>
              Reopen
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MilestonesSection({
  goal,
  onAdd,
  onToggle,
  onDelete
}: {
  goal: Goal;
  onAdd: (title: string, dueDate: string) => Promise<void>;
  onToggle: (milestone: Milestone, completed: boolean) => void;
  onDelete: (milestone: Milestone) => void;
}) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const milestones = goal.milestones ?? [];

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Milestones</p>
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">No milestones yet — add the first one.</p>
      ) : (
        <ul className="space-y-1.5">
          {milestones.map((milestone) => (
            <li key={milestone.id} className="flex items-center gap-2">
              <Checkbox
                checked={milestone.completed}
                onChange={(event) => onToggle(milestone, event.target.checked)}
                aria-label={`Mark “${milestone.title}” ${milestone.completed ? 'incomplete' : 'complete'}`}
              />
              <span
                className={
                  milestone.completed
                    ? 'flex-1 text-sm text-subtle-foreground line-through'
                    : 'flex-1 text-sm'
                }
              >
                {milestone.title}
              </span>
              {milestone.dueDate ? (
                <span className="text-xs text-muted-foreground">
                  {formatDateOnly(milestone.dueDate)}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete milestone “${milestone.title}”`}
                onClick={() => onDelete(milestone)}
              >
                <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
          New milestone
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Draft complete"
            maxLength={200}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Due
          <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        <Button
          size="sm"
          onClick={() => {
            void onAdd(title, dueDate).then(() => {
              setTitle('');
              setDueDate('');
            });
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function GoalFormDialog({
  open,
  goal,
  onClose
}: {
  open: boolean;
  goal: Goal | null;
  onClose: () => void;
}) {
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);

  const methods = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: goalFormDefaults
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    methods.reset(
      goal
        ? {
            title: goal.title,
            description: goal.description ?? '',
            progressType: goal.progressType,
            targetValue: goal.targetValue ?? '',
            currentValue: goal.currentValue ?? '',
            unit: goal.unit ?? '',
            startDate: goal.startDate ?? '',
            targetDate: goal.targetDate ?? ''
          }
        : goalFormDefaults
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id]);

  const progressType = methods.watch('progressType');

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (goal) {
        const body = toGoalBody(values);
        await update.mutateAsync({
          id: goal.id,
          body: { ...body, version: goal.version }
        });
        toast({ title: 'Goal updated', variant: 'success' });
      } else {
        await create.mutateAsync(toGoalBody(values));
        toast({ title: 'Goal created', variant: 'success' });
      }
      onClose();
    } catch (error) {
      for (const [name, message] of Object.entries(fieldErrorsOf(error))) {
        methods.setError(name as keyof GoalFormValues, { message });
      }
      setFormError(error instanceof ApiError ? error.userMessage : 'Could not save the goal.');
    }
  });

  const busy = create.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={goal ? 'Edit goal' : 'New goal'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={busy}>
            {goal ? 'Save changes' : 'Create goal'}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <FormField<GoalFormValues> name="title" label="Title" required>
            {(props) => <Input {...props} maxLength={200} autoFocus required />}
          </FormField>
          <FormField<GoalFormValues> name="description" label="Description">
            {(props) => <Textarea {...props} rows={2} maxLength={5000} />}
          </FormField>
          <FormField<GoalFormValues> name="progressType" label="Progress type" required>
            {(props) => (
              <Select {...props} value={progressType} disabled={Boolean(goal)}>
                <option value="numeric">Numeric target</option>
                <option value="milestones">Milestones</option>
              </Select>
            )}
          </FormField>

          {progressType === 'numeric' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField<GoalFormValues> name="targetValue" label="Target" required>
                {(props) => <Input {...props} inputMode="decimal" placeholder="24" />}
              </FormField>
              <FormField<GoalFormValues> name="currentValue" label="Current">
                {(props) => <Input {...props} inputMode="decimal" placeholder="0" />}
              </FormField>
              <FormField<GoalFormValues> name="unit" label="Unit">
                {(props) => <Input {...props} maxLength={30} placeholder="books" />}
              </FormField>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              After creating the goal you can add milestones on its card.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<GoalFormValues> name="startDate" label="Start date">
              {(props) => <Input {...props} type="date" />}
            </FormField>
            <FormField<GoalFormValues> name="targetDate" label="Target date">
              {(props) => <Input {...props} type="date" />}
            </FormField>
          </div>
        </form>
      </FormProvider>
    </Dialog>
  );
}
