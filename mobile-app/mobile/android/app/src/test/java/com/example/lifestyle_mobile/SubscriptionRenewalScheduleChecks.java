package com.example.lifestyle_mobile;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/** Standalone checks usable without Android SDK, and invoked by the JVM unit test. */
public final class SubscriptionRenewalScheduleChecks {
    private static void next(String anchor, String nextBilling, String unit, int interval,
                             String now, String expected) {
        ZoneId cairo = ZoneId.of("Africa/Cairo");
        ZonedDateTime actual = SubscriptionRenewalSchedule.next(
                LocalDate.parse(anchor), LocalDate.parse(nextBilling), unit, interval,
                ZonedDateTime.parse(now).toInstant(), cairo);
        ZonedDateTime wanted = ZonedDateTime.parse(expected);
        if (!actual.equals(wanted)) throw new AssertionError("expected " + wanted + " got " + actual);
    }
    public static void main(String[] args) {
        // Never infer paid state or move the persisted subscription schedule.
        next("2024-01-31", "2024-01-31", "month", 1,
                "2024-02-01T12:00:00+02:00[Africa/Cairo]", "2024-02-27T09:00:00+02:00[Africa/Cairo]");
        next("2024-01-31", "2024-01-31", "month", 1,
                "2024-02-27T10:00:00+02:00[Africa/Cairo]", "2024-03-29T09:00:00+02:00[Africa/Cairo]");
        next("2024-02-29", "2024-02-29", "year", 1,
                "2025-01-01T10:00:00+02:00[Africa/Cairo]", "2025-02-26T09:00:00+02:00[Africa/Cairo]");
        next("2026-11-05", "2026-11-05", "week", 2,
                "2026-11-06T10:00:00+02:00[Africa/Cairo]", "2026-11-17T09:00:00+02:00[Africa/Cairo]");
        // Explicit next billing date need not be on the anchor's cycle.
        next("2026-01-31", "2026-04-15", "month", 1,
                "2026-04-01T10:00:00+02:00[Africa/Cairo]", "2026-04-13T09:00:00+02:00[Africa/Cairo]");
        next("2026-01-31", "2026-04-15", "month", 1,
                "2026-04-14T10:00:00+02:00[Africa/Cairo]", "2026-04-28T09:00:00+03:00[Africa/Cairo]");
        // Before the exact alarm time, it is still due today; at or after it, move on.
        next("2024-01-31", "2024-01-31", "month", 1,
                "2024-02-27T08:59:59+02:00[Africa/Cairo]", "2024-02-27T09:00:00+02:00[Africa/Cairo]");
        next("2026-11-05", "2026-11-05", "week", 1,
                "2026-11-03T09:00:00+02:00[Africa/Cairo]", "2026-11-10T09:00:00+02:00[Africa/Cairo]");
        // A very old anchor is handled efficiently and remains on its original weekday.
        next("1900-01-01", "1900-01-01", "week", 1,
                "2026-11-06T10:00:00+02:00[Africa/Cairo]", "2026-11-07T09:00:00+02:00[Africa/Cairo]");
        // The same instant maps to 09:00 in each device's own local timezone.
        Instant instant = Instant.parse("2026-01-01T12:00:00Z");
        for (String[] example : new String[][] {
                {"Pacific/Kiritimati", "2026-01-02T09:00:00+14:00[Pacific/Kiritimati]"},
                {"America/Los_Angeles", "2026-01-02T09:00:00-08:00[America/Los_Angeles]"}
        }) {
            ZoneId deviceZone = ZoneId.of(example[0]);
            ZonedDateTime actual = SubscriptionRenewalSchedule.next(LocalDate.parse("2026-01-04"),
                    LocalDate.parse("2026-01-04"), "month", 1, instant, deviceZone);
            if (!actual.equals(ZonedDateTime.parse(example[1]))) {
                throw new AssertionError("device local time incorrect: " + actual);
            }
        }
        ZoneId ny = ZoneId.of("America/New_York");
        ZonedDateTime dst = SubscriptionRenewalSchedule.next(LocalDate.parse("2026-03-10"),
                LocalDate.parse("2026-03-10"), "month", 1,
                Instant.parse("2026-03-01T14:00:00Z"), ny);
        if (!dst.equals(ZonedDateTime.parse("2026-03-08T09:00:00-04:00[America/New_York]"))) {
            throw new AssertionError("DST/local time incorrect: " + dst);
        }
        try {
            SubscriptionRenewalSchedule.next(LocalDate.now(), LocalDate.now(), "month", 0,
                    Instant.now(), ny);
            throw new AssertionError("invalid interval was accepted");
        } catch (IllegalArgumentException expected) { /* expected */ }
        System.out.println("13 subscription renewal schedule checks passed");
    }
}
