import { Decimal } from 'decimal.js';
import type { SubscriptionEntity, SubscriptionStatus, BillingUnit } from './money.types.js';
import {
  calculateMonthlyEquivalent,
  calculateDaysUntilNextBilling,
  projectedNextBillingDate
} from './money.cycle.js';

export const CURRENCY_EXPONENTS: Record<string, number> = {
  CLF: 4,
  UYW: 4,
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

export function toSubscriptionDto(entity: SubscriptionEntity, todayStr: string): SubscriptionDto {
  const nextBillingDate = projectedNextBillingDate(
    entity.anchorDate,
    entity.nextBillingDate,
    entity.billingUnit,
    entity.billingInterval,
    entity.status,
    todayStr
  );
  return {
    id: entity.id,
    name: entity.name,
    amount: formatAmountByCurrency(entity.amount, entity.currency),
    currency: entity.currency,
    billingUnit: entity.billingUnit,
    billingInterval: entity.billingInterval,
    anchorDate: entity.anchorDate,
    nextBillingDate,
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
    daysUntilNextBilling: calculateDaysUntilNextBilling(nextBillingDate, todayStr),
    createdAt:
      entity.createdAt instanceof Date ? entity.createdAt.toISOString() : String(entity.createdAt),
    updatedAt:
      entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : String(entity.updatedAt),
    version: entity.version
  };
}
