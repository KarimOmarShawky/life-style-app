package com.example.lifestyle_mobile

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Base64
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import androidx.core.app.NotificationCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.example.lifestyle_mobile/native_voice"
    private val REQUEST_SPEECH = 202
    private val REQUEST_SMS = 303
    private var pendingVoiceResult: MethodChannel.Result? = null
    private var pendingSmsResult: MethodChannel.Result? = null
    private var voiceFallbackTag: String = "en-US"
    private var pendingVoiceFallback: Boolean = false

    /**
     * Resolves the UI language: the language the user picked inside the app
     * (mirrored to SharedPreferences by Flutter) wins, otherwise the device
     * locale is used.
     */
    internal fun resolvedLanguageTag(): String {
        val saved = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            .getString("flutter.app_locale", null)
        if (!saved.isNullOrBlank()) return Locale.forLanguageTag(saved).toLanguageTag()
        return Locale.getDefault().toLanguageTag()
    }

    internal fun resolvedIsArabic(): Boolean = resolvedLanguageTag().startsWith("ar")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 101)
        }
        showNativePinnedNotification(this)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Native Voice Channel
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "refreshPinnedNotification" -> {
                    showNativePinnedNotification(this)
                    result.success(true)
                }
                "startVoiceRecognition" -> {
                    pendingVoiceResult = result
                    // Multilingual by design: record the utterance and let the
                    // Gemini audio model transcribe it in WHATEVER language is
                    // spoken (auto-detect), independent of the UI language.
                    // The platform recognizer is only a fallback when the AI
                    // path yields nothing, listening in the active app language
                    // (tag sent from Flutter).
                    val requestedTag = call.argument<String>("languageTag")
                    voiceFallbackTag = if (requestedTag.isNullOrBlank()) {
                        resolvedLanguageTag()
                    } else {
                        requestedTag
                    }
                    startDirectMediaRecording(result, fallbackToRecognizer = true)
                }
                "requestSmsPermission" -> {
                    if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED) {
                        result.success(true)
                    } else {
                        pendingSmsResult = result
                        requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS), REQUEST_SMS)
                    }
                }
                "checkSmsPermission" -> {
                    result.success(
                        checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
                    )
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_SMS) {
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            pendingSmsResult?.success(granted)
            pendingSmsResult = null
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_SPEECH) {
            val results = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val spokenText = results?.firstOrNull() ?: ""
            if (spokenText.isNotEmpty()) {
                pendingVoiceResult?.success(spokenText)
                pendingVoiceResult = null
            } else {
                pendingVoiceResult?.let { res ->
                    pendingVoiceResult = null
                    startDirectMediaRecording(res, fallbackToRecognizer = false)
                } ?: run {
                    pendingVoiceResult?.success("")
                    pendingVoiceResult = null
                }
            }
        }
    }

    private var recorder: MediaRecorder? = null
    private var recordFile: File? = null

    private fun startDirectMediaRecording(
        result: MethodChannel.Result,
        fallbackToRecognizer: Boolean = false
    ) {
        pendingVoiceFallback = fallbackToRecognizer
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 101)
            result.success("")
            return
        }

        try {
            recordFile = File(cacheDir, "dialog_voice.m4a")
            if (recordFile!!.exists()) recordFile!!.delete()

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
                setOutputFile(recordFile!!.absolutePath)
                prepare()
                start()
            }

            // Automatically stop after 6 seconds and transcribe in whatever
            // language was spoken (Gemini auto-detects the language).
            Handler(Looper.getMainLooper()).postDelayed({
                stopAndTranscribeGemini(result)
            }, 6000)

        } catch (e: Exception) {
            result.success("")
        }
    }

    private fun stopAndTranscribeGemini(result: MethodChannel.Result) {
        try {
            recorder?.stop()
            recorder?.release()
            recorder = null
        } catch (_: Exception) {}

        val file = recordFile
        if (file == null || !file.exists() || file.length() == 0L) {
            pendingVoiceResult = null
            if (pendingVoiceFallback) {
                startRecognizerIntent(result)
            } else {
                result.success("")
            }
            return
        }

        Thread {
            try {
                val audioBytes = file.readBytes()
                val base64Audio = Base64.encodeToString(audioBytes, Base64.NO_WRAP)
                val text = transcribeAudioWithGemini(base64Audio)
                runOnUiThread {
                    pendingVoiceResult = null
                    if (text.isBlank() && pendingVoiceFallback) {
                        startRecognizerIntent(result)
                    } else {
                        result.success(text)
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    pendingVoiceResult = null
                    if (pendingVoiceFallback) {
                        startRecognizerIntent(result)
                    } else {
                        result.success("")
                    }
                }
            }
        }.start()
    }

    /**
     * Platform speech recognizer (fallback path). Listens in the active app
     * language; the BCP-47 tag must be passed as a String or many devices
     * silently fall back to English.
     */
    private fun startRecognizerIntent(result: MethodChannel.Result) {
        val tag = voiceFallbackTag
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            result.success("")
            return
        }
        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, tag)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(
                    RecognizerIntent.EXTRA_PROMPT,
                    if (tag.startsWith("ar")) "تحدث بمهمتك الآن..." else "Speak your task now..."
                )
            }
            pendingVoiceResult = result
            startActivityForResult(intent, REQUEST_SPEECH)
        } catch (e: Exception) {
            result.success("")
        }
    }

    private fun transcribeAudioWithGemini(base64Audio: String): String {
        val apiKey = readGeminiApiKey(this)
        if (apiKey.isEmpty()) return ""
        try {
            val url = URL(VoiceRecordingService.GEMINI_URL)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-goog-api-key", apiKey)
                doOutput = true
                connectTimeout = 8000
                readTimeout = 8000
            }

            val prompt = "Transcribe the speech in this audio clip accurately, keeping the original language it is spoken in (any language: Arabic, English, French, Spanish, German, Turkish, or anything else). Return only the plain transcribed words without extra text or punctuation."

            val jsonPayload = org.json.JSONObject().apply {
                put("generationConfig", org.json.JSONObject().apply {
                    put("temperature", 0.1)
                })
                put("contents", org.json.JSONArray().apply {
                    put(org.json.JSONObject().apply {
                        put("parts", org.json.JSONArray().apply {
                            put(org.json.JSONObject().apply {
                                put("text", prompt)
                            })
                            put(org.json.JSONObject().apply {
                                put("inlineData", org.json.JSONObject().apply {
                                    put("mimeType", "audio/aac")
                                    put("data", base64Audio)
                                })
                            })
                        })
                    })
                })
            }

            OutputStreamWriter(conn.outputStream).use { it.write(jsonPayload.toString()) }

            if (conn.responseCode == 200) {
                val responseText = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
                val responseJson = org.json.JSONObject(responseText)
                val candidates = responseJson.optJSONArray("candidates")
                if (candidates != null && candidates.length() > 0) {
                    val parts = candidates.getJSONObject(0).optJSONObject("content")?.optJSONArray("parts")
                    if (parts != null && parts.length() > 0) {
                        return parts.getJSONObject(0).optString("text", "").trim()
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return ""
    }

    companion object {
        fun showNativePinnedNotification(context: Context) {
            val channelId = VoiceRecordingService.CHANNEL_ID
            val notificationId = VoiceRecordingService.NOTIFICATION_ID

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    channelId,
                    "LifeStyle Quick LockScreen Input",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "Lockscreen quick voice appointment setter"
                    setSound(null, null)
                    enableVibration(false)
                }
                val manager = context.getSystemService(NotificationManager::class.java)
                manager.createNotificationChannel(channel)
            }

            val recordIntent = Intent(context, VoiceActionReceiver::class.java).apply {
                action = "com.example.lifestyle_mobile.RECORD_VOICE"
            }
            val recordPendingIntent = PendingIntent.getBroadcast(
                context,
                101,
                recordIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val openAppIntent = Intent(context, MainActivity::class.java)
            val openAppPendingIntent = PendingIntent.getActivity(
                context,
                102,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val savedLocale = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
                .getString("flutter.app_locale", null)
            val isArabic = if (!savedLocale.isNullOrBlank()) {
                savedLocale.startsWith("ar")
            } else {
                Locale.getDefault().language.startsWith("ar")
            }
            val notifTitle = if (isArabic) "لايف ستايل: إضافة موعد سريع" else "LifeStyle: Quick Voice Add"
            val notifText = if (isArabic) "اضغط على الزر وتحدث بصوتك لضبط المنبه فوراً" else "Tap button & speak to set alarm instantly"
            val actionLabel = if (isArabic) "تسجيل صوتي بالمايك" else "Voice Record"

            val notif = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(notifTitle)
                .setContentText(notifText)
                .setContentIntent(openAppPendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setAutoCancel(false)
                .addAction(
                    0,
                    actionLabel,
                    recordPendingIntent
                )
                .build()

            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(notificationId, notif)
        }
    }
}
