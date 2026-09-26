/**
 * The bounds the home summary is computed over.
 *
 * Every bug this catches is a silent one. A month bound that stops on the 30th
 * loses a day of spending; an end bound that is inclusive counts midnight twice;
 * local-time arithmetic is correct for 363 days a year. None of them throw.
 */
import { describe, expect, it } from 'vitest';

import { dashboardWindow, GOAL_HORIZON_DAYS } from '@/features/dashboard/dashboard.window';

describe('dashboardWindow', () => {
  it('takes the day from UTC, not from the machine', () => {
    // 00:30 UTC. A server in Cairo (UTC+3) calls this 03:30 the same day, and a
    // server in Los Angeles (UTC-7) calls it 17:30 the PREVIOUS day. Only the
    // UTC answer is the same on both.
    const window = dashboardWindow(new Date('2026-09-24T00:30:00.000Z'));
    expect(window.day).toBe('2026-09-24');
  });

  it('is the same window from any instant within the day', () => {
    const early = dashboardWindow(new Date('2026-09-24T00:00:00.000Z'));
    const late = dashboardWindow(new Date('2026-09-24T23:59:59.999Z'));
    expect(early).toEqual(late);
  });

  it('bounds the day with an exclusive end, so no instant lands in two days', () => {
    const window = dashboardWindow(new Date('2026-09-24T12:00:00.000Z'));
    expect(window.dayStart).toBe('2026-09-24T00:00:00.000Z');
    expect(window.dayEnd).toBe('2026-09-25T00:00:00.000Z');
  });

  it('rolls the day over at the end of a month', () => {
    const window = dashboardWindow(new Date('2026-09-30T23:00:00.000Z'));
    expect(window.dayStart).toBe('2026-09-30T00:00:00.000Z');
    expect(window.dayEnd).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rolls the day over at the end of a year', () => {
    const window = dashboardWindow(new Date('2026-12-31T23:00:00.000Z'));
    expect(window.dayEnd).toBe('2027-01-01T00:00:00.000Z');
  });

  describe('the month', () => {
    it('runs from the first to the first of the next', () => {
      const window = dashboardWindow(new Date('2026-09-24T12:00:00.000Z'));
      expect(window.monthStart).toBe('2026-09-01');
      expect(window.monthEnd).toBe('2026-10-01');
    });

    it('rolls December into January of the following year', () => {
      const window = dashboardWindow(new Date('2026-12-15T12:00:00.000Z'));
      expect(window.monthStart).toBe('2026-12-01');
      expect(window.monthEnd).toBe('2027-01-01');
    });

    it('covers all of February in a common year', () => {
      const window = dashboardWindow(new Date('2026-02-10T12:00:00.000Z'));
      expect(window.monthEnd).toBe('2026-03-01');
    });

    it('covers all of February in a leap year', () => {
      // The exclusive bound needs no month-length table, which is the point:
      // there is no 28-versus-29 decision to get wrong.
      const window = dashboardWindow(new Date('2024-02-29T12:00:00.000Z'));
      expect(window.day).toBe('2024-02-29');
      expect(window.monthEnd).toBe('2024-03-01');
    });

    it('is unchanged by which day of the month it is asked on', () => {
      const first = dashboardWindow(new Date('2026-07-01T00:00:00.000Z'));
      const last = dashboardWindow(new Date('2026-07-31T23:59:59.000Z'));
      expect(first.monthStart).toBe(last.monthStart);
      expect(first.monthEnd).toBe(last.monthEnd);
    });
  });

  describe('the goal horizon', () => {
    it('is the stated number of days ahead', () => {
      const window = dashboardWindow(new Date('2026-09-01T12:00:00.000Z'));
      expect(GOAL_HORIZON_DAYS).toBe(30);
      expect(window.goalHorizon).toBe('2026-10-01');
    });

    it('crosses a year boundary without special handling', () => {
      const window = dashboardWindow(new Date('2026-12-20T12:00:00.000Z'));
      expect(window.goalHorizon).toBe('2027-01-19');
    });

    it('counts real days across a spring daylight-saving transition', () => {
      // Late March is when a local-time implementation loses an hour and, with
      // it, a whole day off the end of the horizon.
      const window = dashboardWindow(new Date('2026-03-01T12:00:00.000Z'));
      expect(window.goalHorizon).toBe('2026-03-31');
    });

    it('counts real days across an autumn transition too', () => {
      const window = dashboardWindow(new Date('2026-10-01T12:00:00.000Z'));
      expect(window.goalHorizon).toBe('2026-10-31');
    });
  });

  it('pads single-digit months and days, which would otherwise sort and compare wrongly', () => {
    const window = dashboardWindow(new Date('2026-01-05T12:00:00.000Z'));
    expect(window.day).toBe('2026-01-05');
    expect(window.monthStart).toBe('2026-01-01');
  });
});
