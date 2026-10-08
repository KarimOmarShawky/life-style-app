package com.example.lifestyle_mobile

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Gemini API key supplied at build time (--dart-define=GEMINI_API_KEY). The Flutter side mirrors it
 * into the app's SharedPreferences, so native code can use it without a running engine. The key is
 * never part of the native source. An empty result means AI features are not configured.
 */
internal fun readGeminiApiKey(context: Context): String {
    return context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
        .getString("flutter.gemini_api_key", null)
        .orEmpty()
        .trim()
}

class VoiceRecordingService : Service() {

    companion object {
        const val TAG = "VoiceRecordingService"
        const val CHANNEL_ID = "lifestyle_quick_input_channel"
        const val NOTIFICATION_ID = 777
        const val GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
    }

    private var recorder: MediaRecorder? = null
    private var recordingFile: File? = null
    private val handler = Handler(Looper.getMainLooper())

    /**
     * UI language resolution: the language selected inside the app (mirrored
     * to SharedPreferences by Flutter) wins; the device locale is the
     * fallback. Notification copy follows the user's choice, not the phone's.
     */
    private fun savedLanguageTag(): String {
        val saved = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            .getString("flutter.app_locale", null)
        if (!saved.isNullOrBlank()) return Locale.forLanguageTag(saved).toLanguageTag()
        return Locale.getDefault().toLanguageTag()
    }

    private fun isArabic(): Boolean = savedLanguageTag().startsWith("ar")

    /** API endpoint mirrored from Flutter at startup (see main.dart). */
    private fun apiBaseUrl(): String {
        val saved = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            .getString("flutter.lifestyle.api_base_url", null)
        return if (!saved.isNullOrBlank()) saved.trimEnd('/') else "https://life-style-app-production.up.railway.app/api/v1"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureNotificationChannel()

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            updateNotification(
                title = if (isArabic()) "تنبيه: مطلوب إذن المايكروفون" else "Alert: Microphone Permission Required",
                text = if (isArabic()) "يرجى فتح التطبيق مرة واحدة للموافقة على إذن المايكروفون" else "Please open app once to grant microphone permission"
            )
            stopSelf()
            return START_NOT_STICKY
        }

        val listeningTitle = if (isArabic()) "جاري الاستماع... تكلم الآن (5 ثوانٍ)" else "Listening... Speak now (5s)"
        val listeningText = if (isArabic()) "تحدث بموعدك بصوتك (مثال: عندي مشوار الساعة 4)" else "Speak your appointment (e.g. Doctor tomorrow at 7 PM)"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(listeningTitle, listeningText),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(listeningTitle, listeningText)
            )
        }
        vibratePhone(100)

        startRecording()

        // Automatically stop recording after 5.5 seconds
        handler.postDelayed({
            stopAndProcessAudio()
        }, 5500)

        return START_NOT_STICKY
    }

    private fun startRecording() {
        try {
            recordingFile = File(cacheDir, "lockscreen_voice.m4a")
            if (recordingFile!!.exists()) recordingFile!!.delete()

            recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(this)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            recorder?.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(64000)
                setAudioSamplingRate(44100)
                setOutputFile(recordingFile!!.absolutePath)
                prepare()
                start()
            }
            Log.d(TAG, "MediaRecorder started successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start MediaRecorder", e)
            updateNotification("تعذر تسجيل الصوت", "يرجى المحاولة مرة أخرى")
            stopSelf()
        }
    }

    private fun stopAndProcessAudio() {
        try {
            recorder?.apply {
                stop()
                release()
            }
            recorder = null
            Log.d(TAG, "MediaRecorder stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping recorder", e)
        }

        updateNotification(
            if (isArabic()) "جاري تحليل موعدك بالذكاء الاصطناعي..." else "Analyzing appointment with AI...",
            if (isArabic()) "جاري استخراج الموعد والتاريخ وضبط المنبه" else "Extracting date/time & scheduling alarm"
        )

        val file = recordingFile
        if (file == null || !file.exists() || file.length() == 0L) {
            updateNotification(
                if (isArabic()) "لم يتم تسجيل صوت" else "No audio detected",
                if (isArabic()) "اضغط على الزر وحاول التحدث مرة أخرى" else "Tap button & try speaking again"
            )
            stopSelf()
            return
        }

        Thread {
            try {
                val apiKey = readGeminiApiKey(this)
                if (apiKey.isEmpty()) {
                    updateNotification(
                        if (isArabic()) "الذكاء الاصطناعي غير مفعّل" else "AI is not configured",
                        if (isArabic()) "شغّل التطبيق ببناء فيه GEMINI_API_KEY" else "Build the app with GEMINI_API_KEY to enable it"
                    )
                    stopSelf()
                    return@Thread
                }
                val audioBytes = file.readBytes()
                val base64Audio = Base64.encodeToString(audioBytes, Base64.NO_WRAP)

                val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm EEEE", Locale.ENGLISH)
                val currentDateTime = sdf.format(Date())

                val prompt = "Current datetime is $currentDateTime. Extract task title, dueDate (YYYY-MM-DD), and dueTime (HH:mm 24-hr format) from this speech, whatever language it is spoken in (detect the language automatically: Arabic, English, French, Spanish, German, Turkish, or any other). Return JSON with keys: title, dueDate, dueTime, hasTime."

                val jsonPayload = JSONObject().apply {
                    put("generationConfig", JSONObject().apply {
                        put("responseMimeType", "application/json")
                        put("temperature", 0.1)
                    })
                    put("contents", JSONArray().apply {
                        put(JSONObject().apply {
                            put("parts", JSONArray().apply {
                                put(JSONObject().apply {
                                    put("text", prompt)
                                })
                                put(JSONObject().apply {
                                    put("inlineData", JSONObject().apply {
                                        put("mimeType", "audio/aac")
                                        put("data", base64Audio)
                                    })
                                })
                            })
                        })
                    })
                }

                val url = URL(GEMINI_URL)
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("X-goog-api-key", apiKey)
                    doOutput = true
                    connectTimeout = 10000
                    readTimeout = 10000
                }

                OutputStreamWriter(conn.outputStream).use { writer ->
                    writer.write(jsonPayload.toString())
                    writer.flush()
                }

                val responseCode = conn.responseCode
                if (responseCode == 200) {
                    val responseText = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
                    val responseJson = JSONObject(responseText)
                    val candidates = responseJson.optJSONArray("candidates")
                    if (candidates != null && candidates.length() > 0) {
                        val content = candidates.getJSONObject(0).optJSONObject("content")
                        val parts = content?.optJSONArray("parts")
                        if (parts != null && parts.length() > 0) {
                            val resultText = parts.getJSONObject(0).optString("text")
                            val parsed = JSONObject(resultText)

                            val defaultTitle = if (isArabic()) "موعد جديد" else "New Appointment"
                            val title = parsed.optString("title", defaultTitle)
                            val dueDate = parsed.optString("dueDate", "")
                            val dueTime = parsed.optString("dueTime", "")

                            // Schedule alarm if date/time available
                            if (dueDate.isNotEmpty() && dueTime.isNotEmpty()) {
                                scheduleAlarm(title, dueDate, dueTime)
                            }

                            vibrateSuccess()
                            updateNotification(
                                title = if (isArabic()) "تم ضبط المنبه بنجاح!" else "Alarm Scheduled Successfully!",
                                text = if (isArabic()) "المهمة: $title ($dueDate $dueTime)" else "Task: $title ($dueDate $dueTime)"
                            )
                            stopSelf()
                            return@Thread
                        }
                    }
                }

                updateNotification(
                    if (isArabic()) "تم استلام صوتك" else "Voice received",
                    if (isArabic()) "لم نتمكن من تحديد الموعد بدقة" else "Could not determine exact date & time"
                )
            } catch (e: Exception) {
                Log.e(TAG, "Gemini API call failed", e)
                updateNotification(
                    if (isArabic()) "تعذر الاتصال بالذكاء الاصطناعي" else "Could not connect to AI",
                    if (isArabic()) "تحقق من اتصال الإنترنت وحاول مجدداً" else "Check internet connection & try again"
                )
            } finally {
                stopSelf()
            }
        }.start()
    }

    private fun scheduleAlarm(title: String, dueDate: String, dueTime: String) {
        try {
            val format = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ENGLISH)
            val date = format.parse("$dueDate $dueTime") ?: return

            val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val notificationId = (title + dueDate + dueTime).hashCode() and 0x7FFFFFFF

            val intent = Intent(this, AlarmReceiver::class.java).apply {
                putExtra("title", title)
                putExtra("due_time", dueTime)
                putExtra("notification_id", notificationId)
            }

            val pendingIntent = PendingIntent.getBroadcast(
                this,
                notificationId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    date.time,
                    pendingIntent
                )
            } else {
                alarmManager.setExact(
                    AlarmManager.RTC_WAKEUP,
                    date.time,
                    pendingIntent
                )
            }
            Log.d(TAG, "Alarm scheduled successfully for ${date.time} (id=$notificationId)")

            // Also attempt background sync to backend
            syncTaskToBackend(title, dueDate, dueTime)
        } catch (e: Exception) {
            Log.e(TAG, "Error scheduling alarm", e)
        }
    }

    private fun syncTaskToBackend(title: String, dueDate: String, dueTime: String) {
        try {
            val prefs = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            val sessionJsonStr = prefs.getString("flutter.lifestyle.session.v1", null) ?: return
            val sessionJson = JSONObject(sessionJsonStr)
            val accessToken = sessionJson.optString("accessToken", "")
            if (accessToken.isEmpty()) return

            val taskUrl = URL("${apiBaseUrl()}/tasks")
            val conn = (taskUrl.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $accessToken")
                doOutput = true
                connectTimeout = 5000
                readTimeout = 5000
            }

            val body = JSONObject().apply {
                put("title", title)
                put("dueDate", dueDate)
                put("dueTime", dueTime)
                put("priority", "high")
            }

            OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }
            val code = conn.responseCode
            Log.d(TAG, "Task synced to backend with response code: $code")
        } catch (e: Exception) {
            Log.w(TAG, "Could not sync task to backend: ${e.message}")
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "LifeStyle Quick LockScreen Input",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Lockscreen quick voice appointment setter"
                setSound(null, null)
                enableVibration(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(title: String, text: String): android.app.Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()
    }

    private fun updateNotification(title: String, text: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val recordIntent = Intent(this, VoiceActionReceiver::class.java).apply {
            action = "com.example.lifestyle_mobile.RECORD_VOICE"
        }
        val recordPendingIntent = PendingIntent.getBroadcast(
            this,
            101,
            recordIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val actionLabel = if (isArabic()) "تسجيل صوتي بالمايك" else "Voice Record"
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setAutoCancel(false)
            .addAction(
                NotificationCompat.Action.Builder(
                    0,
                    actionLabel,
                    recordPendingIntent
                ).build()
            )
            .build()

        manager.notify(NOTIFICATION_ID, notif)
    }

    private fun vibratePhone(durationMs: Long) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vm.defaultVibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    v.vibrate(durationMs)
                }
            }
        } catch (_: Exception) {}
    }

    private fun vibrateSuccess() {
        try {
            val timings = longArrayOf(0, 100, 100, 150)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vm.defaultVibrator.vibrate(VibrationEffect.createWaveform(timings, -1))
            } else {
                @Suppress("DEPRECATION")
                val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(timings, -1))
                } else {
                    v.vibrate(timings, -1)
                }
            }
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        recorder?.release()
        recorder = null
        super.onDestroy()
    }
}
