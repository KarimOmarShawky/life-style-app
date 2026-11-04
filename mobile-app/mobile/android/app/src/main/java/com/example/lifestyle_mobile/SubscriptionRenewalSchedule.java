package com.example.lifestyle_mobile;

import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;

/** Computes the next advisory reminder without altering any payment or subscription data. */
public final class SubscriptionRenewalSchedule {
    private SubscriptionRenewalSchedule() {}

    /** The returned reminder is strictly after now and occurs two calendar days before renewal. */
    public static ZonedDateTime next(LocalDate anchor, LocalDate firstBilling, String unit,
                                     int interval, Instant now, ZoneId zone) {
        if (anchor == null || firstBilling == null || now == null || zone == null ||
                interval < 1 || interval > 12 ||
                !("week".equals(unit) || "month".equals(unit) || "year".equals(unit))) {
            throw new IllegalArgumentException("Invalid subscription schedule");
        }
        ZonedDateTime firstReminder = reminderAt(firstBilling, zone);
        if (firstReminder.toInstant().isAfter(now)) return firstReminder;
        LocalDate target = now.atZone(zone).toLocalDate().plusDays(2);
        long estimate;
        switch (unit) {
            case "week": estimate = ChronoUnit.DAYS.between(anchor, target) / (7L * interval); break;
            case "month": estimate = ChronoUnit.MONTHS.between(YearMonth.from(anchor), YearMonth.from(target)) / interval; break;
            default: estimate = (target.getYear() - (long) anchor.getYear()) / interval;
        }
        long index = Math.max(0, estimate - 1);
        ZonedDateTime cycleReminder;
        while (true) {
            LocalDate billing = cycleDate(anchor, unit, interval, index++);
            cycleReminder = reminderAt(billing, zone);
            if (!billing.isBefore(firstBilling) && cycleReminder.toInstant().isAfter(now)) break;
        }
        return cycleReminder;
    }

    private static LocalDate cycleDate(LocalDate anchor, String unit, int interval, long index) {
        long count = Math.multiplyExact(index, (long) interval);
        switch (unit) {
            case "week": return anchor.plusWeeks(count);
            case "month": return anchor.plusMonths(count);
            default: return anchor.plusYears(count);
        }
    }

    private static ZonedDateTime reminderAt(LocalDate billing, ZoneId zone) {
        return billing.minusDays(2).atTime(9, 0).atZone(zone);
    }
}
