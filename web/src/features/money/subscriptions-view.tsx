'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, CreditCard, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Table, TBody, THead, TRow, TH, TD } from '@/components/data-display/table';
import {
  useCategories,
  useCreateSubscription,
  useDeleteSubscription,
  usePaySubscription,
  useSubscriptions,
  useUpdateSubscription
} from './hooks';
import { newIdempotencyKey, type SubscriptionInput, type SubscriptionUpdateInput } from './api';
import {
  subscriptionFormDefaults,
  subscriptionFormSchema,
  toSubscriptionBody,
  type SubscriptionFormValues
} from './schemas';
import { useAuth } from '@/lib/auth/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { ApiError } from '@/lib/api/errors';
import { formatMoney } from '@/lib/money/format';
import { getUserToday } from '@/lib/date/format';
import type { Subscription } from '@/types/api';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' }
] as const;

export function SubscriptionsView() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const subscriptions = useSubscriptions(status);
  const deleteSubscription = useDeleteSubscription();
  const paySubscription = usePaySubscription();
  const updateSubscription = useUpdateSubscription();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [deleting, setDeleting] = useState<Subscription | null>(null);
  const [paying, setPaying] = useState<Subscription | null>(null);

  const rows = subscriptions.data?.subscriptions ?? [];

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteSubscription.mutateAsync(deleting.id);
      toast({ title: 'Subscription deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete subscription',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handlePay = async () => {
    if (!paying) return;
    try {
      await paySubscription.mutateAsync({
        id: paying.id,
        idempotencyKey: newIdempotencyKey()
      });
      toast({
        title: 'Payment recorded',
        description: 'The next billing date was advanced by the server.',
        variant: 'success'
      });
    } catch (error) {
      toast({
        title: 'Could not record payment',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleStatusChange = async (
    subscription: Subscription,
    next: 'active' | 'paused' | 'cancelled'
  ) => {
    try {
      await updateSubscription.mutateAsync({
        id: subscription.id,
        body: {
          status: next,
          ...(next === 'cancelled' ? { cancelledOn: getUserToday(user?.timezone) } : {}),
          version: subscription.version
        }
      });
      toast({ title: `Subscription ${next === 'active' ? 'resumed' : next}`, variant: 'success' });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        toast({
          title: 'Subscription changed elsewhere',
          description: 'It was updated by another session — refreshing the list.',
          variant: 'warning'
        });
        void subscriptions.refetch();
        return;
      }
      toast({
        title: 'Could not update subscription',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        description="Recurring commitments. Billing cycle math is computed by the server — dates shown are never re-derived in the browser."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New subscription
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Subscription status">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.value}
            size="sm"
            variant={status === tab.value ? 'secondary' : 'outline'}
            role="tab"
            aria-selected={status === tab.value}
            onClick={() => setStatus(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <AsyncContent
        isLoading={subscriptions.isLoading}
        isError={subscriptions.isError}
        error={subscriptions.error}
        isEmpty={rows.length === 0}
        onRetry={() => void subscriptions.refetch()}
        emptyTitle={status === '' ? 'No subscriptions' : `No ${status} subscriptions`}
        emptyDescription="Track recurring services so upcoming charges never surprise you."
        emptyIcon={<CreditCard className="size-8" />}
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New subscription
          </Button>
        }
        skeletonRows={5}
      >
        <Table>
          <THead>
            <TRow>
              <TH>Name</TH>
              <TH>Plan</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Monthly equiv.</TH>
              <TH>Next billing</TH>
              <TH>Status</TH>
              <TH className="w-32 text-right">Actions</TH>
            </TRow>
          </THead>
          <TBody>
            {rows.map((subscription) => (
              <TRow key={subscription.id}>
                <TD>
                  <span className="font-medium">{subscription.name}</span>
                  {subscription.notes ? (
                    <span className="block max-w-40 truncate text-xs text-subtle-foreground">
                      {subscription.notes}
                    </span>
                  ) : null}
                </TD>
                <TD className="whitespace-nowrap text-sm">
                  Every {subscription.billingInterval > 1 ? `${subscription.billingInterval} ` : ''}
                  {subscription.billingUnit}
                  {subscription.billingInterval > 1 ? 's' : ''}
                </TD>
                <TD className="text-right font-mono tabular-nums">
                  {formatMoney(subscription.amount, subscription.currency)}
                </TD>
                <TD className="text-right font-mono tabular-nums text-subtle-foreground">
                  {formatMoney(subscription.monthlyEquivalent, subscription.currency)}
                </TD>
                <TD className="whitespace-nowrap">
                  <span className="block">{subscription.nextBillingDate}</span>
                  <span className="text-xs text-subtle-foreground">
                    {subscription.daysUntilNextBilling}d away
                  </span>
                </TD>
                <TD>
                  <SubscriptionStatusBadge status={subscription.status} />
                </TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    {subscription.status === 'active' ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Record payment for ${subscription.name}`}
                          onClick={() => setPaying(subscription)}
                        >
                          <CalendarClock className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Pause ${subscription.name}`}
                          onClick={() => void handleStatusChange(subscription, 'paused')}
                        >
                          Pause
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Cancel ${subscription.name}`}
                          onClick={() => void handleStatusChange(subscription, 'cancelled')}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : null}
                    {subscription.status === 'paused' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Resume ${subscription.name}`}
                        onClick={() => void handleStatusChange(subscription, 'active')}
                      >
                        Resume
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${subscription.name}`}
                      onClick={() => {
                        setEditing(subscription);
                        setEditorOpen(true);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${subscription.name}`}
                      onClick={() => setDeleting(subscription)}
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

      <SubscriptionDialog
        open={editorOpen}
        subscription={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this subscription?"
        description="Past transactions it generated remain; future billing stops."
        confirmLabel="Delete"
        danger
      />

      <ConfirmDialog
        open={Boolean(paying)}
        onClose={() => setPaying(null)}
        onConfirm={handlePay}
        title={paying ? `Record payment for “${paying.name}”?` : ''}
        description={
          paying
            ? `An expense of ${formatMoney(paying.amount, paying.currency)} will be created and the next billing date will advance. A fresh idempotency key protects this submission.`
            : ''
        }
        confirmLabel="Record payment"
      />
    </div>
  );
}

function SubscriptionStatusBadge({ status }: { status: Subscription['status'] }) {
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  if (status === 'paused') return <Badge variant="warning">Paused</Badge>;
  return <Badge variant="neutral">Cancelled</Badge>;
}

function SubscriptionDialog({
  open,
  subscription,
  onClose
}: {
  open: boolean;
  subscription: Subscription | null;
  onClose: () => void;
}) {
  const isNew = subscription === null;
  const { user } = useAuth();
  const categories = useCategories(false);
  const categoryRows = categories.data?.categories ?? [];
  const createSubscription = useCreateSubscription();
  const updateSubscription = useUpdateSubscription();
  const { toast } = useToast();

  const [values, setValues] = useState<SubscriptionFormValues>(subscriptionFormDefaults);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    if (subscription) {
      setValues({
        name: subscription.name,
        amount: subscription.amount,
        currency: subscription.currency,
        billingUnit: subscription.billingUnit,
        billingInterval: String(subscription.billingInterval),
        anchorDate: subscription.anchorDate,
        nextBillingDate: subscription.nextBillingDate,
        categoryId: subscription.categoryId ?? '',
        reminderDaysBefore:
          subscription.reminderDaysBefore === null ? '' : String(subscription.reminderDaysBefore),
        notes: subscription.notes ?? ''
      });
    } else {
      setValues({
        ...subscriptionFormDefaults,
        currency: user?.defaultCurrency ?? 'USD',
        anchorDate: getUserToday(user?.timezone)
      });
    }
  }, [open, subscription, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = subscriptionFormSchema.safeParse(values);
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
        await createSubscription.mutateAsync(toSubscriptionBody(parsed.data) as SubscriptionInput);
        toast({ title: 'Subscription created', variant: 'success' });
      } else if (subscription) {
        const body = toSubscriptionBody(parsed.data);
        await updateSubscription.mutateAsync({
          id: subscription.id,
          body: { ...body, version: subscription.version } as SubscriptionUpdateInput
        });
        toast({ title: 'Subscription updated', variant: 'success' });
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        setFormError(
          'Someone changed this subscription while you were editing. Your changes were not saved — reload to see the latest version, then re-apply your edit.'
        );
        return;
      }
      setFormError(
        error instanceof ApiError ? error.userMessage : 'Could not save the subscription.'
      );
    }
  };

  const busy = createSubscription.isPending || updateSubscription.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? 'New subscription' : 'Edit subscription'}
      description="The server owns cycle calculations — this form only collects raw inputs."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="subscription-form" loading={busy}>
            {isNew ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        id="subscription-form"
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4"
      >
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div className="space-y-1.5">
          <Label htmlFor="sub-name">Name</Label>
          <Input
            id="sub-name"
            value={values.name}
            onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
            maxLength={120}
            required
          />
          {fieldErrors.name ? <p className="text-xs text-danger">{fieldErrors.name}</p> : null}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="sub-amount">Amount</Label>
            <Input
              id="sub-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={values.amount}
              onChange={(event) =>
                setValues((current) => ({ ...current, amount: event.target.value }))
              }
              required
            />
            {fieldErrors.amount ? (
              <p className="text-xs text-danger">{fieldErrors.amount}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub-currency">Currency</Label>
            <Input
              id="sub-currency"
              value={values.currency}
              onChange={(event) =>
                setValues((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
              }
              maxLength={3}
              required
            />
            {fieldErrors.currency ? (
              <p className="text-xs text-danger">{fieldErrors.currency}</p>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sub-unit">Billing unit</Label>
            <Select
              id="sub-unit"
              value={values.billingUnit}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  billingUnit: event.target.value as SubscriptionFormValues['billingUnit']
                }))
              }
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub-interval">Every N units</Label>
            <Input
              id="sub-interval"
              inputMode="numeric"
              value={values.billingInterval}
              onChange={(event) =>
                setValues((current) => ({ ...current, billingInterval: event.target.value }))
              }
              required
            />
            {fieldErrors.billingInterval ? (
              <p className="text-xs text-danger">{fieldErrors.billingInterval}</p>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sub-anchor">Anchor date</Label>
            <Input
              id="sub-anchor"
              type="date"
              value={values.anchorDate}
              onChange={(event) =>
                setValues((current) => ({ ...current, anchorDate: event.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub-next">Next billing (optional)</Label>
            <Input
              id="sub-next"
              type="date"
              value={values.nextBillingDate ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, nextBillingDate: event.target.value }))
              }
            />
            {fieldErrors.nextBillingDate ? (
              <p className="text-xs text-danger">{fieldErrors.nextBillingDate}</p>
            ) : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sub-category">Category (optional)</Label>
          <Select
            id="sub-category"
            value={values.categoryId ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, categoryId: event.target.value }))
            }
          >
            <option value="">No category</option>
            {categoryRows
              .filter((category) => !category.archived && category.kind === 'expense')
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sub-reminder">Remind days before</Label>
            <Input
              id="sub-reminder"
              inputMode="numeric"
              placeholder="0–30"
              value={values.reminderDaysBefore ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, reminderDaysBefore: event.target.value }))
              }
            />
            {fieldErrors.reminderDaysBefore ? (
              <p className="text-xs text-danger">{fieldErrors.reminderDaysBefore}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub-notes">Notes</Label>
            <Input
              id="sub-notes"
              value={values.notes ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, notes: event.target.value }))
              }
              maxLength={1000}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
}
