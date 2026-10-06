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
    private var pendingVoiceResult: MethodChannel.Result? = null

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
                    if (SpeechRecognizer.isRecognitionAvailable(this)) {
                        try {
                            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                                putExtra(
                                    RecognizerIntent.EXTRA_PROMPT,
                                    if (Locale.getDefault().language.startsWith("ar")) "تحدث بمهمتك الآن..." else "Speak your task now..."
                                )
                            }
                            startActivityForResult(intent, REQUEST_SPEECH)
                        } catch (e: Exception) {
                            startDirectMediaRecording(result)
                        }
                    } else {
                        startDirectMediaRecording(result)
                    }
                }
                else -> result.notImplemented()
            }
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
                    startDirectMediaRecording(res)
                } ?: run {
                    pendingVoiceResult?.success("")
                    pendingVoiceResult = null
                }
            }
        }
    }

    private var recorder: MediaRecorder? = null
    private var recordFile: File? = null

    private fun startDirectMediaRecording(result: MethodChannel.Result) {
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

            // Automatically stop after 4.5 seconds and transcribe
            Handler(Looper.getMainLooper()).postDelayed({
                stopAndTranscribeGemini(result)
            }, 4500)

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
            result.success("")
            return
        }

        Thread {
            try {
                val audioBytes = file.readBytes()
                val base64Audio = Base64.encodeToString(audioBytes, Base64.NO_WRAP)
                val text = transcribeAudioWithGemini(base64Audio)
                runOnUiThread {
                    result.success(text)
                }
            } catch (e: Exception) {
                runOnUiThread {
                    result.success("")
                }
            }
        }.start()
    }

    private fun transcribeAudioWithGemini(base64Audio: String): String {
        try {
            val url = URL(VoiceRecordingService.GEMINI_URL)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-goog-api-key", VoiceRecordingService.GEMINI_API_KEY)
                doOutput = true
                connectTimeout = 8000
                readTimeout = 8000
            }

            val prompt = "Transcribe the Arabic or English speech in this audio clip accurately. Return only the plain transcribed words without extra text or punctuation."

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

            val isArabic = Locale.getDefault().language.startsWith("ar")
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
