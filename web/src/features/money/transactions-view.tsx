'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { CursorPagination } from '@/components/data-display/cursor-pagination';
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
  useCreateTransaction,
  useDeleteTransaction,
  useTransactions,
  useUpdateTransaction
} from './hooks';
import { newIdempotencyKey, type ListTransactionsParams, type TransactionInput } from './api';
import {
  transactionFormDefaults,
  transactionFormSchema,
  toTransactionBody,
  type TransactionFormValues
} from './schemas';
import { useAuth } from '@/lib/auth/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { ApiError } from '@/lib/api/errors';
import { formatMoney } from '@/lib/money/format';
import { getUserToday } from '@/lib/date/format';
import type { Transaction } from '@/types/api';

export function TransactionsView() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [kindFilter, setKindFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<string[]>([]);

  const params: ListTransactionsParams = useMemo(
    () => ({
      kind: (kindFilter || undefined) as 'expense' | 'income' | undefined,
      categoryId: categoryFilter || undefined,
      from: from || undefined,
      to: to || undefined,
      sort: 'occurredOn',
      limit: 25,
      cursor
    }),
    [kindFilter, categoryFilter, from, to, cursor]
  );

  const transactions = useTransactions(params);
  const categories = useCategories(false);
  const deleteTransaction = useDeleteTransaction();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);

  const rows = transactions.data?.transactions ?? [];
  const meta = transactions.data?.meta;
  const categoryById = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories.data?.categories ?? []) {
      map.set(category.id, category.name);
    }
    return map;
  }, [categories.data]);

  const resetPaging = () => {
    setCursor(undefined);
    setHistory([]);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteTransaction.mutateAsync(deleting.id);
      toast({
        title: 'Transaction deleted',
        description: 'This cannot be undone — transactions have no restore endpoint.',
        variant: 'success'
      });
      setDeleting(null);
    } catch (error) {
      toast({
        title: 'Could not delete transaction',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Manual income and expense entries — amounts stay exact decimal strings."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New transaction
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="tx-kind">Kind</Label>
          <Select
            id="tx-kind"
            value={kindFilter}
            onChange={(event) => {
              setKindFilter(event.target.value);
              resetPaging();
            }}
          >
            <option value="">All</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tx-category">Category</Label>
          <Select
            id="tx-category"
            value={categoryFilter}
            onChange={(event) => {
              setCategoryFilter(event.target.value);
              resetPaging();
            }}
          >
            <option value="">All</option>
            {(categories.data?.categories ?? [])
              .filter((category) => !category.archived)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tx-from">From</Label>
          <Input
            id="tx-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              resetPaging();
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tx-to">To</Label>
          <Input
            id="tx-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              resetPaging();
            }}
          />
        </div>
        {(kindFilter || categoryFilter || from || to) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKindFilter('');
              setCategoryFilter('');
              setFrom('');
              setTo('');
              resetPaging();
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <AsyncContent
        isLoading={transactions.isLoading}
        isError={transactions.isError}
        error={transactions.error}
        isEmpty={rows.length === 0}
        onRetry={() => void transactions.refetch()}
        emptyTitle="No transactions"
        emptyDescription="Record your first income or expense to start seeing reports."
        emptyIcon={<Receipt className="size-8" />}
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New transaction
          </Button>
        }
        skeletonRows={6}
      >
        <Table>
          <THead>
            <TRow>
              <TH>Date</TH>
              <TH>Description</TH>
              <TH>Category</TH>
              <TH className="text-right">Amount</TH>
              <TH className="w-24 text-right">Actions</TH>
            </TRow>
          </THead>
          <TBody>
            {rows.map((transaction) => {
              const category = transaction.categoryId
                ? categoryById.get(transaction.categoryId)
                : undefined;
              const isIncome = transaction.kind === 'income';
              return (
                <TRow key={transaction.id}>
                  <TD className="whitespace-nowrap">{transaction.occurredOn}</TD>
                  <TD>
                    <span className="flex items-center gap-2">
                      <Badge variant={isIncome ? 'success' : 'danger'}>
                        {isIncome ? 'Income' : 'Expense'}
                      </Badge>
                      <span className="font-medium">{transaction.description ?? '—'}</span>
                      {transaction.merchant ? (
                        <span className="text-xs text-subtle-foreground">
                          · {transaction.merchant}
                        </span>
                      ) : null}
                    </span>
                  </TD>
                  <TD>{category ?? '—'}</TD>
                  <TD className="text-right font-mono tabular-nums">
                    <span
                      className={isIncome ? 'text-success' : 'text-danger'}
                      title={`${transaction.kind} ${transaction.amount} ${transaction.currency}`}
                    >
                      {isIncome ? (
                        <ArrowDownLeft className="mr-1 inline size-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowUpRight className="mr-1 inline size-3.5" aria-hidden="true" />
                      )}
                      {isIncome ? '+' : '−'}
                      {formatMoney(transaction.amount, transaction.currency)}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit transaction"
                        onClick={() => {
                          setEditing(transaction);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete transaction"
                        onClick={() => setDeleting(transaction)}
                      >
                        <Trash2 className="size-4 text-danger" aria-hidden="true" />
                      </Button>
                    </div>
                  </TD>
                </TRow>
              );
            })}
          </TBody>
        </Table>

        <CursorPagination
          hasCursor={Boolean(meta?.hasMore && meta?.nextCursor)}
          canGoBack={history.length > 0}
          loading={transactions.isFetching}
          onPrevious={() => {
            const stack = [...history];
            const previous = stack.pop();
            setCursor(previous);
            setHistory(stack);
          }}
          onNext={() => {
            if (meta?.nextCursor) {
              setHistory((current) => [...current, cursor ?? '']);
              setCursor(meta.nextCursor);
            }
          }}
        />
      </AsyncContent>

      <TransactionDialog
        open={editorOpen}
        transaction={editing}
        defaultCurrency={user?.defaultCurrency ?? 'USD'}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this transaction?"
        description="Deleting a transaction is permanent and affects your reports."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function TransactionDialog({
  open,
  transaction,
  defaultCurrency,
  onClose
}: {
  open: boolean;
  transaction: Transaction | null;
  defaultCurrency: string;
  onClose: () => void;
}) {
  const isNew = transaction === null;
  const { user } = useAuth();
  const categories = useCategories(false);
  const createTransaction = useCreateTransaction();
  const updateTransaction = useUpdateTransaction();
  const { toast } = useToast();

  const [values, setValues] = useState<TransactionFormValues>(transactionFormDefaults);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    if (transaction) {
      setValues({
        kind: transaction.kind,
        amount: transaction.amount,
        currency: transaction.currency,
        occurredOn: transaction.occurredOn,
        categoryId: transaction.categoryId ?? '',
        description: transaction.description ?? '',
        merchant: transaction.merchant ?? ''
      });
    } else {
      setValues({
        ...transactionFormDefaults,
        currency: defaultCurrency,
        occurredOn: getUserToday(user?.timezone)
      });
    }
  }, [open, transaction, defaultCurrency, user?.timezone]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = transactionFormSchema.safeParse(values);
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
    const body = toTransactionBody(parsed.data);
    try {
      if (isNew) {
        // Fresh idempotency key per submission attempt.
        await createTransaction.mutateAsync({
          body: body as TransactionInput,
          idempotencyKey: newIdempotencyKey()
        });
        toast({ title: 'Transaction created', variant: 'success' });
      } else if (transaction) {
        await updateTransaction.mutateAsync({
          id: transaction.id,
          body: { ...body, version: transaction.version }
        });
        toast({ title: 'Transaction updated', variant: 'success' });
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        setFormError(
          'Someone changed this transaction while you were editing. Your changes were not saved — reload to see the latest version, then re-apply your edit.'
        );
        return;
      }
      setFormError(
        error instanceof ApiError ? error.userMessage : 'Could not save the transaction.'
      );
    }
  };

  const busy = createTransaction.isPending || updateTransaction.isPending;
  const categoriesForKind = (categories.data?.categories ?? []).filter(
    (category) => !category.archived && category.kind === values.kind
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? 'New transaction' : 'Edit transaction'}
      description="Amounts are stored as decimal strings — no floating point rounding."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="transaction-form" loading={busy}>
            {isNew ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        id="transaction-form"
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4"
      >
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div className="space-y-1.5">
          <Label>Kind</Label>
          <div className="flex gap-2" role="radiogroup" aria-label="Transaction kind">
            {(['expense', 'income'] as const).map((kind) => (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant={values.kind === kind ? 'secondary' : 'outline'}
                role="radio"
                aria-checked={values.kind === kind}
                onClick={() => setValues((current) => ({ ...current, kind }))}
              >
                {kind === 'expense' ? 'Expense' : 'Income'}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="tx-amount">Amount</Label>
            <Input
              id="tx-amount"
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
            <Label htmlFor="tx-currency">Currency</Label>
            <Input
              id="tx-currency"
              value={values.currency}
              onChange={(event) =>
                setValues((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
              }
              maxLength={3}
              placeholder="USD"
              required
            />
            {fieldErrors.currency ? (
              <p className="text-xs text-danger">{fieldErrors.currency}</p>
            ) : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-date">Date</Label>
          <Input
            id="tx-date"
            type="date"
            value={values.occurredOn}
            onChange={(event) =>
              setValues((current) => ({ ...current, occurredOn: event.target.value }))
            }
            required
          />
          {fieldErrors.occurredOn ? (
            <p className="text-xs text-danger">{fieldErrors.occurredOn}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-amount-category">Category (optional)</Label>
          <Select
            id="tx-amount-category"
            value={values.categoryId ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, categoryId: event.target.value }))
            }
          >
            <option value="">No category</option>
            {categoriesForKind.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-description">Description</Label>
          <Input
            id="tx-description"
            value={values.description ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, description: event.target.value }))
            }
            maxLength={500}
          />
          {fieldErrors.description ? (
            <p className="text-xs text-danger">{fieldErrors.description}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-merchant">Merchant</Label>
          <Input
            id="tx-merchant"
            value={values.merchant ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, merchant: event.target.value }))
            }
            maxLength={150}
          />
          {fieldErrors.merchant ? (
            <p className="text-xs text-danger">{fieldErrors.merchant}</p>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
