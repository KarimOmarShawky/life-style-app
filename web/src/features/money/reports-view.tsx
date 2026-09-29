'use client';

import { useMemo, useState } from 'react';
import { BarChart3, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, THead, TRow, TH, TD } from '@/components/data-display/table';
import { useCategories, useReportSummary } from './hooks';
import type { ReportParams } from './api';
import { useAuth } from '@/lib/auth/auth-provider';
import { formatMoney } from '@/lib/money/format';
import { getUserToday } from '@/lib/date/format';

const MAX_SPAN_DAYS = 366;

export function ReportsView() {
  const { user } = useAuth();
  const categories = useCategories(true);

  const [from, setFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-01-01`;
  });
  const [to, setTo] = useState(() => getUserToday(user?.timezone));
  const [currency, setCurrency] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'day' | 'week' | 'month'>('none');
  const [submitted, setSubmitted] = useState<ReportParams | null>(null);

  const spanDays = useMemo(() => {
    if (!from || !to) return null;
    const fromTime = Date.parse(`${from}T00:00:00Z`);
    const toTime = Date.parse(`${to}T00:00:00Z`);
    if (Number.isNaN(fromTime) || Number.isNaN(toTime)) return null;
    return Math.round((toTime - fromTime) / 86_400_000);
  }, [from, to]);

  const invalid = spanDays !== null && (spanDays < 0 || spanDays > MAX_SPAN_DAYS);
  const report = useReportSummary(submitted);

  const categoryNames = new Map(
    (categories.data?.categories ?? []).map((category) => [category.id, category.name])
  );

  const run = () => {
    if (invalid) return;
    setSubmitted({
      from,
      to,
      currency: currency || undefined,
      groupBy
    });
  };

  const totals = report.data?.totals;
  const data = report.data;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Aggregated views of your manual transactions. Totals come from the server — no math is re-derived in the browser."
      />

      <form
        className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="rep-from">From</Label>
          <Input
            id="rep-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rep-to">To</Label>
          <Input
            id="rep-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rep-currency">Currency (optional)</Label>
          <Input
            id="rep-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            placeholder={user?.defaultCurrency ?? 'USD'}
            maxLength={3}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rep-group">Group by</Label>
          <Select
            id="rep-group"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}
          >
            <option value="none">None</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </Select>
        </div>
        <Button type="submit" disabled={invalid}>
          Run report
        </Button>
      </form>

      {invalid ? (
        <div className="mb-4">
          <Alert variant="warning" title="Invalid date range">
            The range must be chronological and span at most {MAX_SPAN_DAYS} days (server rule).
          </Alert>
        </div>
      ) : null}

      {!submitted && !report.isLoading ? (
        <EmptyPrompt />
      ) : (
        <AsyncContent
          isLoading={report.isLoading}
          isError={report.isError}
          error={report.error}
          isEmpty={false}
          onRetry={() => void report.refetch()}
          emptyTitle="No data"
          emptyDescription=""
          skeletonRows={4}
        >
          {data && totals ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TotalCard
                  title="Income"
                  value={totals.income}
                  currency={data.currency}
                  tone="income"
                />
                <TotalCard
                  title="Expense"
                  value={totals.expense}
                  currency={data.currency}
                  tone="expense"
                />
                <TotalCard title="Net" value={totals.net} currency={data.currency} tone="net" />
              </div>

              <section aria-label="By category">
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                  By category · {data.from} → {data.to}
                </h2>
                {data.byCategory.length === 0 ? (
                  <Alert variant="info">No transactions in this range.</Alert>
                ) : (
                  <Table>
                    <THead>
                      <TRow>
                        <TH>Category</TH>
                        <TH>Kind</TH>
                        <TH className="text-right">Count</TH>
                        <TH className="text-right">Total</TH>
                        <TH className="text-right">Share</TH>
                      </TRow>
                    </THead>
                    <TBody>
                      {data.byCategory.map((item, index) => (
                        <TRow key={`${item.categoryId ?? 'none'}-${index}`}>
                          <TD>
                            {item.name ||
                              (item.categoryId
                                ? (categoryNames.get(item.categoryId) ?? 'Uncategorised')
                                : 'Uncategorised')}
                          </TD>
                          <TD>
                            <Badge variant={item.kind === 'income' ? 'success' : 'danger'}>
                              {item.kind}
                            </Badge>
                          </TD>
                          <TD className="text-right tabular-nums">{item.count}</TD>
                          <TD className="text-right font-mono tabular-nums">
                            {formatMoney(item.total, data.currency)}
                          </TD>
                          <TD className="text-right tabular-nums">
                            {Math.round(item.share * 100)}%
                          </TD>
                        </TRow>
                      ))}
                    </TBody>
                  </Table>
                )}
              </section>

              {data.series && data.series.length > 0 ? (
                <section aria-label="Series">
                  <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Series</h2>
                  <Table>
                    <THead>
                      <TRow>
                        <TH>Period start</TH>
                        <TH className="text-right">Income</TH>
                        <TH className="text-right">Expense</TH>
                      </TRow>
                    </THead>
                    <TBody>
                      {data.series.map((point) => (
                        <TRow key={point.periodStart}>
                          <TD>{point.periodStart}</TD>
                          <TD className="text-right font-mono tabular-nums text-success">
                            {formatMoney(point.income, data.currency)}
                          </TD>
                          <TD className="text-right font-mono tabular-nums text-danger">
                            {formatMoney(point.expense, data.currency)}
                          </TD>
                        </TRow>
                      ))}
                    </TBody>
                  </Table>
                </section>
              ) : null}
            </div>
          ) : null}
        </AsyncContent>
      )}
    </div>
  );
}

function EmptyPrompt() {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
      <BarChart3 className="mx-auto mb-3 size-8" aria-hidden="true" />
      <p>Pick a range and run the report.</p>
    </div>
  );
}

function TotalCard({
  title,
  value,
  currency,
  tone
}: {
  title: string;
  value: string;
  currency: string;
  tone: 'income' | 'expense' | 'net';
}) {
  const positive = !value.startsWith('-');
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {tone === 'income' ? (
          <TrendingUp className="size-4 text-success" aria-hidden="true" />
        ) : tone === 'expense' ? (
          <TrendingDown className="size-4 text-danger" aria-hidden="true" />
        ) : (
          <Wallet className="size-4" aria-hidden="true" />
        )}
      </CardHeader>
      <CardContent>
        <div
          className={`font-mono text-2xl tabular-nums ${
            tone === 'net' ? (positive ? 'text-success' : 'text-danger') : ''
          }`}
        >
          {tone === 'net' && positive ? '+' : ''}
          {formatMoney(value, currency)}
        </div>
      </CardContent>
    </Card>
  );
}
