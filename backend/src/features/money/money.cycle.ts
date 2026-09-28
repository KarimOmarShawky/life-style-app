/**
 * src/features/money/money.cycle.ts
 *
 * Implements Section 14.11 & AC-MON-05: Subscription cycle date math and monthly equivalent calculation.
 * Computes cycles strictly from anchorDate (never from previous dates) and clamps to month's last day.
 */

import { Decimal } from 'decimal.js';
import type { BillingUnit } from './money.types.js';

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/**
 * Calculates the cycle date at index n strictly derived from anchor_date.
 * Clamps target day to the last day of shorter months (e.g. 31st -> 28th/29th in Feb, 30th in Apr).
 */
export function calculateCycleDate(
  anchorDateStr: string,
  cycleIndex: number,
  unit: BillingUnit,
  interval: number
): string {
  if (cycleIndex <= 0) {
    return anchorDateStr;
  }

  const parts = anchorDateStr.split('-').map(Number);
  const anchorYear = parts[0] ?? 2026;
  const anchorMonth = parts[1] ?? 1;
  const anchorDay = parts[2] ?? 1;

  if (unit === 'week') {
    const totalDays = cycleIndex * interval * 7;
    const d = new Date(Date.UTC(anchorYear, anchorMonth - 1, anchorDay + totalDays));
    return d.toISOString().slice(0, 10);
  }

  if (unit === 'month') {
    const totalMonths = cycleIndex * interval;
    const targetMonthIndex = anchorMonth - 1 + totalMonths;
    const targetYear = anchorYear + Math.floor(targetMonthIndex / 12);
    const targetMonth = (((targetMonthIndex % 12) + 12) % 12) + 1;
    const maxDay = daysInMonth(targetYear, targetMonth);
    const targetDay = Math.min(anchorDay, maxDay);
    return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
  }

  if (unit === 'year') {
    const targetYear = anchorYear + cycleIndex * interval;
    const targetMonth = anchorMonth;
    const maxDay = daysInMonth(targetYear, targetMonth);
    const targetDay = Math.min(anchorDay, maxDay);
    return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
  }

  throw new Error(`Unsupported billing unit: ${unit}`);
}

/**
 * Computes the subsequent billing date after currentNextBillingDate.
 */
export function calculateNextBillingDate(
  anchorDateStr: string,
  currentBillingDateStr: string,
  unit: BillingUnit,
  interval: number
): string {
  const curParts = currentBillingDateStr.split('-').map(Number);
  const curYear = curParts[0] ?? 2026;
  const curMonth = curParts[1] ?? 1;

  const ancParts = anchorDateStr.split('-').map(Number);
  const ancYear = ancParts[0] ?? 2026;
  const ancMonth = ancParts[1] ?? 1;

  let cycleIndex = 1;

  if (unit === 'month') {
    const diffMonths = (curYear - ancYear) * 12 + (curMonth - ancMonth);
    cycleIndex = Math.max(1, Math.floor(diffMonths / interval));
  } else if (unit === 'year') {
    const diffYears = curYear - ancYear;
    cycleIndex = Math.max(1, Math.floor(diffYears / interval));
  }

  let nextDate = calculateCycleDate(anchorDateStr, cycleIndex, unit, interval);
  while (nextDate <= currentBillingDateStr) {
    cycleIndex++;
    nextDate = calculateCycleDate(anchorDateStr, cycleIndex, unit, interval);
  }

  return nextDate;
}

/**
 * Computes the initial nextBillingDate defaulting to the first cycle date >= today.
 */
export function calculateInitialNextBillingDate(
  anchorDateStr: string,
  todayStr: string,
  unit: BillingUnit,
  interval: number
): string {
  if (anchorDateStr >= todayStr) {
    return anchorDateStr;
  }

  const todayParts = todayStr.split('-').map(Number);
  const todayYear = todayParts[0] ?? 2026;
  const todayMonth = todayParts[1] ?? 1;

  const ancParts = anchorDateStr.split('-').map(Number);
  const ancYear = ancParts[0] ?? 2026;
  const ancMonth = ancParts[1] ?? 1;

  let cycleIndex = 1;

  if (unit === 'month') {
    const diffMonths = (todayYear - ancYear) * 12 + (todayMonth - ancMonth);
    cycleIndex = Math.max(1, Math.floor(diffMonths / interval));
  } else if (unit === 'year') {
    const diffYears = todayYear - ancYear;
    cycleIndex = Math.max(1, Math.floor(diffYears / interval));
  }

  let cycleDate = calculateCycleDate(anchorDateStr, cycleIndex, unit, interval);
  while (cycleDate < todayStr) {
    cycleIndex++;
    cycleDate = calculateCycleDate(anchorDateStr, cycleIndex, unit, interval);
  }

  return cycleDate;
}

/**
 * Computes monthly equivalent with exact Decimal.js math to 4 decimal places.
 */
export function calculateMonthlyEquivalent(
  amount: string,
  unit: BillingUnit,
  interval: number
): string {
  const decAmount = new Decimal(amount);
  const decInterval = new Decimal(interval);

  if (unit === 'month') {
    return decAmount.dividedBy(decInterval).toFixed(4);
  }

  if (unit === 'year') {
    return decAmount.dividedBy(decInterval.times(12)).toFixed(4);
  }

  if (unit === 'week') {
    return decAmount.times(52).dividedBy(decInterval.times(12)).toFixed(4);
  }

  return decAmount.toFixed(4);
}

/**
 * Computes integer difference in days between nextBillingDate and user's today.
 */
export function calculateDaysUntilNextBilling(
  nextBillingDateStr: string,
  todayStr: string
): number {
  const nextTime = Date.parse(`${nextBillingDateStr}T00:00:00Z`);
  const todayTime = Date.parse(`${todayStr}T00:00:00Z`);
  return Math.round((nextTime - todayTime) / (24 * 60 * 60 * 1000));
}
