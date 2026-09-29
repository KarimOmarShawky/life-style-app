'use client';

import { useEffect, useState } from 'react';
import { PiggyBank, Plus, Trash2, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useBudgets,
  useCategories,
  useCreateBudget,
  useDeleteBudget,
  useUpdateBudget
} from './hooks';
import { budgetFormDefaults, budgetFormSchema, type BudgetFormValues } from './schemas';
import { useAuth } from '@/lib/auth/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { ApiError } from '@/lib/api/errors';
import { formatMoney } from '@/lib/money/format';
import type { Budget } from '@/types/api';

export function BudgetsView() {
  const { toast } = useToast();
  const budgets = useBudgets();
  const categories = useCategories(true);
  const deleteBudget = useDeleteBudget();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const rows = budgets.data?.budgets ?? [];
  const categoryById = new Map(
    (categories.data?.categories ?? []).map((category) => [category.id, category.name])
  );

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteBudget.mutateAsync(deleting.id);
      toast({ title: 'Budget deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete budget',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Budgets"
        description="Monthly spending limits per category. Usage figures are computed by the server."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New budget
          </Button>
        }
      />

      <AsyncContent
        isLoading={budgets.isLoading}
        isError={budgets.isError}
        error={budgets.error}
        isEmpty={rows.length === 0}
        onRetry={() => void budgets.refetch()}
        emptyTitle="No budgets"
        emptyDescription="Set monthly limits per category to track your spending pace."
        emptyIcon={<PiggyBank className="size-8" />}
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New budget
          </Button>
        }
        skeletonRows={4}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map((budget) => {
            const usage = budget.usage;
            const label = budget.categoryId
              ? (categoryById.get(budget.categoryId) ?? 'Unknown category')
              : 'All spending';
            const percent = usage?.percentUsed ?? 0;
            return (
              <Card key={budget.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">
                    <span className="flex items-center gap-2">
                      {label}
                      <Badge variant="neutral">{budget.period}</Badge>
                      {usage?.overspent ? <Badge variant="danger">Overspent</Badge> : null}
                    </span>
                  </CardTitle>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit budget"
                      onClick={() => {
                        setEditing(budget);
                        setEditorOpen(true);
                      }}
                    >
                      <TrendingUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete budget"
                      onClick={() => setDeleting(budget)}
                    >
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-mono tabular-nums">
                      {usage ? formatMoney(usage.spent, budget.currency) : '—'}
                      <span className="text-subtle-foreground">
                        {' '}
                        of {formatMoney(budget.amountLimit, budget.currency)}
                      </span>
                    </span>
                    <span className="tabular-nums text-subtle-foreground">
                      {Math.round(percent)}%
                    </span>
                  </div>
                  <Progress
                    value={percent}
                    label={`Spent: ${Math.round(percent)}%`}
                    variant={usage?.overspent ? 'danger' : 'primary'}
                  />
                  {usage ? (
                    <p className="text-xs text-subtle-foreground">
                      {usage.periodStart} → {usage.periodEnd} · remaining{' '}
                      <span className="font-mono">
                        {formatMoney(usage.remaining, budget.currency)}
                      </span>
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </AsyncContent>

      <BudgetDialog
        open={editorOpen}
        budget={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this budget?"
        description="Spending history is unaffected — only the limit is removed."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function BudgetDialog({
  open,
  budget,
  onClose
}: {
  open: boolean;
  budget: Budget | null;
  onClose: () => void;
}) {
  const isNew = budget === null;
  const { user } = useAuth();
  const categories = useCategories(true);
  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const { toast } = useToast();

  const [values, setValues] = useState<BudgetFormValues>(budgetFormDefaults);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    if (budget) {
      setValues({
        categoryId: budget.categoryId ?? '',
        amountLimit: budget.amountLimit,
        currency: budget.currency
      });
    } else {
      setValues({ ...budgetFormDefaults, currency: user?.defaultCurrency ?? 'USD' });
    }
  }, [open, budget, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = budgetFormSchema.safeParse(values);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    try {
      if (isNew) {
        await createBudget.mutateAsync({
          categoryId:
            parsed.data.categoryId && parsed.data.categoryId.length > 0
              ? parsed.data.categoryId
              : null,
          amountLimit: parsed.data.amountLimit.trim(),
          currency: parsed.data.currency,
          period: 'monthly'
        });
        toast({ title: 'Budget created', variant: 'success' });
      } else if (budget) {
        // Update schema only accepts amountLimit + version.
        await updateBudget.mutateAsync({
          id: budget.id,
          body: { amountLimit: parsed.data.amountLimit.trim(), version: budget.version }
        });
        toast({ title: 'Budget updated', variant: 'success' });
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        setFormError('A budget already exists for this category and currency.');
        return;
      }
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        setFormError('The budget changed elsewhere. Close this dialog and try again.');
        return;
      }
      setFormError(error instanceof ApiError ? error.userMessage : 'Could not save the budget.');
    }
  };

  const busy = createBudget.isPending || updateBudget.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? 'New budget' : 'Edit budget'}
      description={
        isNew
          ? 'One budget per category (or overall) per currency.'
          : 'Only the limit can be changed — category and currency are fixed.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="budget-form" loading={busy}>
            {isNew ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="budget-form" onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div className="space-y-1.5">
          <Label htmlFor="budget-category">Category</Label>
          <Select
            id="budget-category"
            value={values.categoryId ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, categoryId: event.target.value }))
            }
            disabled={!isNew}
          >
            <option value="">Overall budget (all spending)</option>
            {(categories.data?.categories ?? [])
              .filter((category) => !category.archived && category.kind === 'expense')
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="budget-limit">Monthly limit</Label>
            <Input
              id="budget-limit"
              inputMode="decimal"
              placeholder="0.00"
              value={values.amountLimit}
              onChange={(event) =>
                setValues((current) => ({ ...current, amountLimit: event.target.value }))
              }
              required
            />
            {fieldErrors.amountLimit ? (
              <p className="text-xs text-danger">{fieldErrors.amountLimit}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="budget-currency">Currency</Label>
            <Input
              id="budget-currency"
              value={values.currency}
              onChange={(event) =>
                setValues((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
              }
              maxLength={3}
              disabled={!isNew}
              required
            />
            {fieldErrors.currency ? (
              <p className="text-xs text-danger">{fieldErrors.currency}</p>
            ) : null}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
