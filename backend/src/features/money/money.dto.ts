/**
 * src/features/money/money.dto.ts
 *
 * Implements Section 14.11 & 14.17.1: Money DTO interfaces and serialization mappers.
 */

import { Decimal } from 'decimal.js';
import type {
  CategoryEntity,
  TransactionEntity,
  SubscriptionEntity,
  BudgetEntity,
  BudgetUsage,
  ReportSummary,
  TransactionKind,
  SubscriptionStatus,
  BillingUnit,
  BudgetPeriod
} from './money.types.js';
import { calculateMonthlyEquivalent, calculateDaysUntilNextBilling } from './money.cycle.js';

export const CURRENCY_EXPONENTS: Record<string, number> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3
};

export function getCurrencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  return code in CURRENCY_EXPONENTS ? CURRENCY_EXPONENTS[code]! : 2;
}

export function formatAmountByCurrency(amount: string | Decimal, currency: string): string {
  const dec = amount instanceof Decimal ? amount : new Decimal(amount);
  const exponent = getCurrencyExponent(currency);
  return dec.toFixed(exponent);
}

export interface CategoryDto {
  id: string;
  kind: TransactionKind;
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TransactionDto {
  id: string;
  kind: TransactionKind;
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId: string | null;
  description: string | null;
  merchant: string | null;
  subscriptionId: string | null;
  billingDate: string | null;
  source: 'manual';
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SubscriptionDto {
  id: string;
  name: string;
  amount: string;
  currency: string;
  billingUnit: BillingUnit;
  billingInterval: number;
  anchorDate: string;
  nextBillingDate: string;
  status: SubscriptionStatus;
  cancelledOn: string | null;
  categoryId: string | null;
  reminderDaysBefore: number | null;
  notes: string | null;
  monthlyEquivalent: string;
  daysUntilNextBilling: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface BudgetUsageDto {
  periodStart: string;
  periodEnd: string;
  spent: string;
  remaining: string;
  percentUsed: number;
  overspent: boolean;
}

export interface BudgetDto {
  id: string;
  categoryId: string | null;
  amountLimit: string;
  currency: string;
  period: BudgetPeriod;
  usage?: BudgetUsageDto | undefined;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ReportCategoryItemDto {
  categoryId: string | null;
  name: string;
  kind: TransactionKind;
  total: string;
  count: number;
  share: number;
}

export interface ReportSeriesItemDto {
  periodStart: string;
  income: string;
  expense: string;
}

export interface ReportSummaryDto {
  currency: string;
  from: string;
  to: string;
  totals: {
    income: string;
    expense: string;
    net: string;
  };
  byCategory: ReportCategoryItemDto[];
  series?: ReportSeriesItemDto[] | undefined;
}

export function toCategoryDto(entity: CategoryEntity): CategoryDto {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    icon: entity.icon,
    color: entity.color,
    archived: entity.archivedAt !== null,
    createdAt:
      entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
    updatedAt:
      entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : String(entity.updatedAt),
    version: entity.version
  };
}

export function toTransactionDto(entity: TransactionEntity): TransactionDto {
  return {
    id: entity.id,
    kind: entity.kind,
    amount: formatAmountByCurrency(entity.amount, entity.currency),
    currency: entity.currency,
    occurredOn: entity.occurredOn,
    categoryId: entity.categoryId,
    description: entity.description,
    merchant: entity.merchant,
    subscriptionId: entity.subscriptionId,
    billingDate: entity.billingDate,
    source: entity.source,
    createdAt:
      entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
    updatedAt:
      entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : String(entity.updatedAt),
    version: entity.version
  };
}

export function toSubscriptionDto(entity: SubscriptionEntity, todayStr: string): SubscriptionDto {
  return {
    id: entity.id,
    name: entity.name,
    amount: formatAmountByCurrency(entity.amount, entity.currency),
    currency: entity.currency,
    billingUnit: entity.billingUnit,
    billingInterval: entity.billingInterval,
    anchorDate: entity.anchorDate,
    nextBillingDate: entity.nextBillingDate,
    status: entity.status,
    cancelledOn: entity.cancelledOn,
    categoryId: entity.categoryId,
    reminderDaysBefore: entity.reminderDaysBefore,
    notes: entity.notes,
    monthlyEquivalent: calculateMonthlyEquivalent(
      entity.amount,
      entity.billingUnit,
      entity.billingInterval
    ),
    daysUntilNextBilling: calculateDaysUntilNextBilling(entity.nextBillingDate, todayStr),
    createdAt:
      entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
    updatedAt:
      entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : String(entity.updatedAt),
    version: entity.version
  };
}

export function toBudgetDto(entity: BudgetEntity, usage?: BudgetUsage): BudgetDto {
  return {
    id: entity.id,
    categoryId: entity.categoryId,
    amountLimit: formatAmountByCurrency(entity.amountLimit, entity.currency),
    currency: entity.currency,
    period: entity.period,
    ...(usage
      ? {
          usage: {
            periodStart: usage.periodStart,
            periodEnd: usage.periodEnd,
            spent: formatAmountByCurrency(usage.spent, entity.currency),
            remaining: formatAmountByCurrency(usage.remaining, entity.currency),
            percentUsed: usage.percentUsed,
            overspent: usage.overspent
          }
        }
      : {}),
    createdAt:
      entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
    updatedAt:
      entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : String(entity.updatedAt),
    version: entity.version
  };
}

export function toReportSummaryDto(summary: ReportSummary): ReportSummaryDto {
  return {
    currency: summary.currency,
    from: summary.from,
    to: summary.to,
    totals: {
      income: formatAmountByCurrency(summary.totals.income, summary.currency),
      expense: formatAmountByCurrency(summary.totals.expense, summary.currency),
      net: formatAmountByCurrency(summary.totals.net, summary.currency)
    },
    byCategory: summary.byCategory.map((cat) => ({
      categoryId: cat.categoryId,
      name: cat.name,
      kind: cat.kind,
      total: formatAmountByCurrency(cat.total, summary.currency),
      count: cat.count,
      share: cat.share
    })),
    series: summary.series?.map((item) => ({
      periodStart: item.periodStart,
      income: formatAmountByCurrency(item.income, summary.currency),
      expense: formatAmountByCurrency(item.expense, summary.currency)
    }))
  };
}
