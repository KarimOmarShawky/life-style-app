/**
 * tests/unit/notification-policy.test.ts
 *
 * Feature guide G2 (ADR-046): the shared notification policy. The JSON cases
 * are shared with the Dart implementation, so both sides must agree,
 * including on daylight-saving gaps and repeated hours.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  decideNotification,
  formatClockMinute,
  localDateOf,
  parseClockMinute,
  summaryDeliveryAt,
  type NotificationDecision,
  type NotificationPreferences,
  type NotificationTier
} from '../../src/features/notifications/notification-policy.js';

interface FixturePreferences {
  notificationsEnabled?: boolean;
  quietStart?: string | null;
  quietEnd?: string | null;
  dailyCap?: number | null;
  digestEnabled?: boolean;
  criticalBreaksQuiet?: boolean;
}

interface DecisionCase {
  name: string;
  timeZone: string;
  preferences: FixturePreferences;
  tier: NotificationTier;
  at: string;
  deliveredOn?: Record<string, number>;
  expect: { action: NotificationDecision['action']; at?: string; localDate?: string };
}

interface SummaryCase {
  name: string;
  timeZone: string;
  preferences: FixturePreferences;
  firstItemAt: string;
  expectAt: string;
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../mobile-app/mobile/test/fixtures/notification_policy_cases.json',
      import.meta.url
    ),
    'utf8'
  )
) as { version: number; decisionCases: DecisionCase[]; summaryCases: SummaryCase[] };

function clock(value: string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  const minute = parseClockMinute(value);
  if (minute === null) throw new Error(`bad clock value in fixture: ${value}`);
  return minute;
}

function preferencesFrom(input: FixturePreferences): NotificationPreferences {
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(input.notificationsEnabled !== undefined && {
      notificationsEnabled: input.notificationsEnabled
    }),
    ...(input.digestEnabled !== undefined && { digestEnabled: input.digestEnabled }),
    ...(input.criticalBreaksQuiet !== undefined && {
      criticalBreaksQuiet: input.criticalBreaksQuiet
    }),
    ...(input.dailyCap !== undefined && { dailyCap: input.dailyCap }),
    quietStartMinute: clock(input.quietStart),
    quietEndMinute: clock(input.quietEnd)
  };
}

function summarize(decision: NotificationDecision): Record<string, string> {
  switch (decision.action) {
    case 'allow':
    case 'delay':
      return { action: decision.action, at: decision.at.toISOString() };
    case 'digest':
      return { action: decision.action, localDate: decision.localDate };
    case 'drop':
      return { action: decision.action };
  }
}

function expected(raw: DecisionCase['expect']): Record<string, string> {
  if (raw.at !== undefined) return { action: raw.action, at: new Date(raw.at).toISOString() };
  if (raw.localDate !== undefined) return { action: raw.action, localDate: raw.localDate };
  return { action: raw.action };
}

describe('notification policy: shared cases (G2)', () => {
  it('loads a non-trivial, versioned case file', () => {
    expect(fixture.version).toBe(1);
    expect(fixture.decisionCases.length).toBeGreaterThanOrEqual(20);
    expect(fixture.summaryCases.length).toBeGreaterThanOrEqual(2);
  });

  for (const testCase of fixture.decisionCases) {
    it(testCase.name, () => {
      const decision = decideNotification({
        tier: testCase.tier,
        at: new Date(testCase.at),
        timeZone: testCase.timeZone,
        preferences: preferencesFrom(testCase.preferences),
        deliveredOn: (day) => testCase.deliveredOn?.[day] ?? 0
      });
      expect(summarize(decision)).toEqual(expected(testCase.expect));
    });
  }

  for (const testCase of fixture.summaryCases) {
    it(`summary: ${testCase.name}`, () => {
      const at = summaryDeliveryAt(
        new Date(testCase.firstItemAt),
        testCase.timeZone,
        preferencesFrom(testCase.preferences)
      );
      expect(at.toISOString()).toBe(new Date(testCase.expectAt).toISOString());
    });
  }
});

describe('notification policy: properties', () => {
  const quiet: NotificationPreferences = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    quietStartMinute: 22 * 60,
    quietEndMinute: 7 * 60
  };

  it('never delivers a non-critical notification inside quiet hours (every 10 minutes, 3 zones, DST months)', () => {
    const zones = ['Africa/Cairo', 'Europe/Berlin', 'America/New_York'];
    const windows = [
      ['2026-03-27T00:00:00Z', '2026-03-31T00:00:00Z'],
      ['2026-04-22T00:00:00Z', '2026-04-26T00:00:00Z'],
      ['2026-10-23T00:00:00Z', '2026-11-03T00:00:00Z']
    ] as const;
    for (const zone of zones) {
      for (const [from, to] of windows) {
        for (let t = Date.parse(from); t < Date.parse(to); t += 10 * 60_000) {
          const decision = decideNotification({
            tier: 'normal',
            at: new Date(t),
            timeZone: zone,
            preferences: quiet,
            deliveredOn: () => 0
          });
          expect(decision.action === 'allow' || decision.action === 'delay').toBe(true);
          if (decision.action !== 'allow' && decision.action !== 'delay') continue;
          expect(decision.at.getTime()).toBeGreaterThanOrEqual(t);
          // At most one quiet period (9 h) plus a DST hour of waiting.
          expect(decision.at.getTime() - t).toBeLessThanOrEqual(10 * 3_600_000);
          const delivered = decideNotification({
            tier: 'normal',
            at: decision.at,
            timeZone: zone,
            preferences: quiet,
            deliveredOn: () => 0
          });
          expect(delivered).toEqual({ action: 'allow', at: decision.at });
        }
      }
    }
  });

  it('defaults change nothing: every tier is allowed at its own time', () => {
    for (const tier of ['critical', 'normal', 'low'] as const) {
      const at = new Date('2026-11-11T21:30:00Z');
      expect(
        decideNotification({
          tier,
          at,
          timeZone: 'Africa/Cairo',
          preferences: DEFAULT_NOTIFICATION_PREFERENCES,
          deliveredOn: () => 99
        })
      ).toEqual({ action: 'allow', at });
    }
  });

  it('treats equal start and end as quiet hours off', () => {
    const at = new Date('2026-11-11T21:30:00Z');
    expect(
      decideNotification({
        tier: 'normal',
        at,
        timeZone: 'Africa/Cairo',
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          quietStartMinute: 600,
          quietEndMinute: 600
        },
        deliveredOn: () => 0
      })
    ).toEqual({ action: 'allow', at });
  });
});

describe('notification policy: clock helpers', () => {
  it('parses only strict 24-hour HH:MM', () => {
    expect(parseClockMinute('00:00')).toBe(0);
    expect(parseClockMinute('07:05')).toBe(425);
    expect(parseClockMinute('23:59')).toBe(1439);
    for (const bad of ['24:00', '7:00', '07:60', '07-00', ' 07:00', '07:00 ', '']) {
      expect(parseClockMinute(bad)).toBeNull();
    }
  });

  it('formats minutes as HH:MM and round-trips', () => {
    for (const minute of [0, 59, 60, 425, 1320, 1439]) {
      expect(parseClockMinute(formatClockMinute(minute))).toBe(minute);
    }
    expect(formatClockMinute(1440)).toBe('00:00');
    expect(formatClockMinute(-1)).toBe('23:59');
  });

  it('computes the local date in the account time zone', () => {
    expect(localDateOf(new Date('2026-11-11T21:59:00Z'), 'Africa/Cairo')).toBe('2026-11-11');
    expect(localDateOf(new Date('2026-11-11T22:00:00Z'), 'Africa/Cairo')).toBe('2026-11-12');
    expect(localDateOf(new Date('2026-11-11T22:00:00Z'), 'Not/AZone')).toBe('2026-11-11');
  });
});
