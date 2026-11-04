package com.example.lifestyle_mobile;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Device-local advisory reminders. No names, amounts, credentials or payment data are stored. */
public final class SubscriptionReminderScheduler {
    private static final String PREF = "subscription_reminders_v1";
    private static final String ACTION = "com.example.lifestyle_mobile.SUBSCRIPTION_REMINDER";
    private static final int ALARM_ID = 61023;
    private static final int NOTIFICATION_ID = 61024;
    private static final String CHANNEL = "subscription_renewal_reminders_v1";
    private static final int MAX_ITEMS = 200;
    private SubscriptionReminderScheduler() {}

    private static SharedPreferences preferences(Context ctx) {
        return ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    private static PendingIntent pendingIntent(Context ctx) {
        Intent i = new Intent(ctx, SubscriptionReminderReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(ctx, ALARM_ID, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static AlarmManager alarms(Context ctx) {
        return (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    }

    private static void cancelAlarm(Context ctx) {
        alarms(ctx).cancel(pendingIntent(ctx));
    }

    /** Atomically replaces only a complete fetched snapshot; bad input leaves the old snapshot intact. */
    public static synchronized void replace(Context ctx, String account, List<?> items) throws JSONException {
        UUID.fromString(account);
        if (items == null || items.size() > MAX_ITEMS) throw new IllegalArgumentException("Invalid reminder count");
        JSONArray snapshot = new JSONArray();
        HashSet<String> ids = new HashSet<>();
        for (Object item : items) {
            if (!(item instanceof Map)) throw new IllegalArgumentException("Invalid schedule");
            Map<?, ?> map = (Map<?, ?>) item;
            String id = string(map, "id");
            UUID.fromString(id);
            if (!ids.add(id)) throw new IllegalArgumentException("Duplicate schedule");
            LocalDate anchor = LocalDate.parse(string(map, "anchorDate"));
            LocalDate first = LocalDate.parse(string(map, "nextBillingDate"));
            String unit = string(map, "billingUnit");
            Object rawInterval = map.get("billingInterval");
            if (!(rawInterval instanceof Integer)) throw new IllegalArgumentException("Invalid interval");
            int interval = (Integer) rawInterval;
            SubscriptionRenewalSchedule.next(anchor, first, unit, interval, Instant.now(), ZoneId.systemDefault());
            snapshot.put(new JSONObject().put("id", id).put("anchorDate", anchor.toString())
                    .put("nextBillingDate", first.toString()).put("billingUnit", unit)
                    .put("billingInterval", interval));
        }
        if (!preferences(ctx).edit().putString("account", account).putString("schedules", snapshot.toString())
                .remove("scheduledAt").commit()) throw new IllegalStateException("Could not persist reminders");
        cancelAlarm(ctx);
        if (snapshot.length() == 0) return;
        ensurePermissions(ctx);
        scheduleNext(ctx, snapshot, Instant.now());
    }

    private static String string(Map<?, ?> map, String key) {
        Object value = map.get(key);
        if (!(value instanceof String)) throw new IllegalArgumentException("Invalid schedule field");
        return (String) value;
    }

    /** Removes deleted records even when a subsequent network refresh cannot run. */
    public static synchronized void remove(Context ctx, String account, String id) throws JSONException {
        UUID.fromString(id);
        if (!account.equals(preferences(ctx).getString("account", null))) return;
        JSONArray previous = snapshot(ctx);
        JSONArray remaining = new JSONArray();
        for (int i = 0; i < previous.length(); i++) {
            JSONObject item = previous.getJSONObject(i);
            if (!id.equals(item.getString("id"))) remaining.put(item);
        }
        if (!preferences(ctx).edit().putString("schedules", remaining.toString())
                .remove("scheduledAt").commit()) throw new IllegalStateException("Could not persist reminders");
        cancelAlarm(ctx);
        if (remaining.length() > 0) {
            ensurePermissions(ctx);
            scheduleNext(ctx, remaining, Instant.now());
        }
    }

    /** Sign-out removes all account-specific schedule metadata and visible reminders. */
    public static synchronized void clear(Context ctx) {
        boolean erased = preferences(ctx).edit().clear().commit();
        try {
            cancelAlarm(ctx);
        } finally {
            NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID);
        }
        if (!erased) throw new IllegalStateException("Could not clear reminders");
    }

    private static void ensurePermissions(Context ctx) {
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
            throw new IllegalStateException("Notification permission unavailable");
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            manager.createNotificationChannel(new NotificationChannel(CHANNEL,
                    ctx.getString(R.string.subscription_reminder_channel), NotificationManager.IMPORTANCE_DEFAULT));
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
            if (channel == null || channel.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                throw new IllegalStateException("Reminder channel unavailable");
            }
        }
        if (Build.VERSION.SDK_INT >= 31 && !alarms(ctx).canScheduleExactAlarms()) {
            throw new IllegalStateException("Exact alarm permission unavailable");
        }
    }

    private static JSONArray snapshot(Context ctx) throws JSONException {
        return new JSONArray(preferences(ctx).getString("schedules", "[]"));
    }

    private static void scheduleNext(Context ctx, JSONArray items, Instant now) throws JSONException {
        if (items.length() == 0) return;
        Instant earliest = null;
        ZoneId zone = ZoneId.systemDefault();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i);
            Instant next = SubscriptionRenewalSchedule.next(
                    LocalDate.parse(item.getString("anchorDate")),
                    LocalDate.parse(item.getString("nextBillingDate")), item.getString("billingUnit"),
                    item.getInt("billingInterval"), now, zone).toInstant();
            if (earliest == null || next.isBefore(earliest)) earliest = next;
        }
        if (earliest == null) return;
        long when = earliest.toEpochMilli();
        if (!preferences(ctx).edit().putLong("scheduledAt", when).commit()) {
            throw new IllegalStateException("Could not persist alarm");
        }
        try {
            alarms(ctx).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pendingIntent(ctx));
        } catch (RuntimeException error) {
            preferences(ctx).edit().remove("scheduledAt").commit();
            throw error;
        }
    }

    static synchronized void onReceive(Context ctx, String action) {
        try {
            JSONArray items = snapshot(ctx);
            if (items.length() == 0 || preferences(ctx).getString("account", null) == null) return;
            long nowMillis = System.currentTimeMillis();
            long scheduledAt = preferences(ctx).getLong("scheduledAt", 0);
            if (ACTION.equals(action) && scheduledAt > 0 && nowMillis >= scheduledAt &&
                    nowMillis - scheduledAt < 24L * 60 * 60 * 1000 &&
                    NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
                postGenericNotification(ctx);
            }
            // Avoid retaining or repeatedly firing stale alarms. Restart/timezone changes recompute local 09:00.
            cancelAlarm(ctx);
            ensurePermissions(ctx);
            scheduleNext(ctx, items, Instant.ofEpochMilli(nowMillis));
        } catch (RuntimeException | JSONException ignored) {
            // No raw subscription data in logs. App retries after the next successful sync.
        }
    }

    private static void postGenericNotification(Context ctx) {
        NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL,
                    ctx.getString(R.string.subscription_reminder_channel), NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent open = launch == null ? null : PendingIntent.getActivity(ctx, ALARM_ID, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(ctx.getString(R.string.subscription_reminder_title))
                .setContentText(ctx.getString(R.string.subscription_reminder_body))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true);
        if (open != null) builder.setContentIntent(open);
        NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, builder.build());
    }
}
