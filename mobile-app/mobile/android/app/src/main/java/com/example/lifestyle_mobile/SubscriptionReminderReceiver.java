package com.example.lifestyle_mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restores/reschedules a single device alarm without depending on a running Flutter engine. */
public final class SubscriptionReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        SubscriptionReminderScheduler.onReceive(context, intent.getAction());
    }
}
