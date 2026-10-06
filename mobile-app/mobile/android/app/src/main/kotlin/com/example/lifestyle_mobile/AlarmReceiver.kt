package com.example.lifestyle_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat

class AlarmReceiver : BroadcastReceiver() {

    companion object {
        const val ALARM_CHANNEL_ID = "lifestyle_voice_alarm_channel"
        const val ACTION_DISMISS = "com.example.lifestyle_mobile.DISMISS_ALARM"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val notificationId = intent.getIntExtra("notification_id", 888)

        if (action == ACTION_DISMISS) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.cancel(notificationId)
            return
        }

        val title = intent.getStringExtra("title") ?: "موعد مجدول"
        val dueTime = intent.getStringExtra("due_time") ?: ""

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val audioAttributes = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build()

            val channel = NotificationChannel(
                ALARM_CHANNEL_ID,
                "LifeStyle Voice Alarms",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "High priority alarms for scheduled voice appointments"
                setSound(alarmSound, audioAttributes)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 1000)
            }
            notificationManager.createNotificationChannel(channel)
        }

        val openAppIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val dismissIntent = Intent(context, AlarmReceiver::class.java).apply {
            this.action = ACTION_DISMISS
            putExtra("notification_id", notificationId)
        }
        val dismissPendingIntent = PendingIntent.getBroadcast(
            context,
            notificationId + 1,
            dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val isArabic = java.util.Locale.getDefault().language.startsWith("ar")
        val alarmTitle = if (isArabic) "منبه موعد: $title" else "Appointment Alarm: $title"
        val alarmText = if (isArabic) "حان الآن موعد: $title ${if (dueTime.isNotEmpty()) "($dueTime)" else ""}" else "It's time for: $title ${if (dueTime.isNotEmpty()) "($dueTime)" else ""}"
        val dismissLabel = if (isArabic) "إيقاف المنبه" else "Dismiss"

        val builder = NotificationCompat.Builder(context, ALARM_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(alarmTitle)
            .setContentText(alarmText)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setSound(alarmSound)
            .setVibrate(longArrayOf(0, 500, 200, 500, 200, 1000))
            .setAutoCancel(true)
            .setContentIntent(openAppPendingIntent)
            .setFullScreenIntent(openAppPendingIntent, true)
            .addAction(0, dismissLabel, dismissPendingIntent)

        val notification = builder.build()
        // INSISTENT flag keeps audio ringing until user dismisses
        notification.flags = notification.flags or android.app.Notification.FLAG_INSISTENT

        notificationManager.notify(notificationId, notification)
    }
}
