package com.example.lifestyle_mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.CancellationSignal
import android.provider.DocumentsContract
import android.util.Log
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Per-file SAF consent only; no storage permission, FileProvider or reusable URI grant. */
internal class AccountArchiveBridge(private val activity: Activity, messenger: BinaryMessenger) : AutoCloseable {
    private val channel = MethodChannel(messenger, "lifestyle/account_archive")
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val closed = AtomicBoolean(false)
    private val directory = File(activity.noBackupFilesDir, "account_archive_v1")
    @Volatile private var active: AccountArchiveStage? = null
    @Volatile private var pickerBusy = false
    private var pendingSave: Pair<String, MethodChannel.Result>? = null
    @Volatile private var providerCancellation: CancellationSignal? = null
    private var expiry: Runnable? = null

    init {
        worker.execute {
            if (directory.exists() || directory.mkdirs()) {
                // Only this new feature's opaque encrypted orphan files, never recursive cleanup.
                synchronized(stageLock) {
                    directory.listFiles()?.filter { Regex("^[0-9a-f-]{36}\\.enc$").matches(it.name) && it.name !in ownedStages }
                        ?.forEach { if (!it.delete()) cleanupWarning() }
                }
            }
        }
        channel.setMethodCallHandler(::handle)
    }

    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        if (closed.get()) { result.error("ARCHIVE_UNAVAILABLE", "Archive operation unavailable", null); return }
        if (call.method == "discard") {
            val id = call.argument<String>("id")
            active?.takeIf { it.id == id }?.let { it.revoke(); providerCancellation?.cancel() }
        }
        worker.execute {
            try {
                check(!closed.get())
                when (call.method) {
                    "begin" -> {
                        check(active == null && !pickerBusy && (directory.isDirectory || directory.mkdirs()))
                        val stage = synchronized(stageLock) {
                            check(ownedStages.isEmpty())
                            requireNotNull(directory.listFiles()).filter { Regex("^[0-9a-f-]{36}\\.enc$").matches(it.name) }
                                .forEach { check(it.delete()) }
                            AccountArchiveStage(directory).also { ownedStages.add(it.file.name) }
                        }; active = stage
                        main.post {
                            if (closed.get() || active?.id != stage.id) {
                                result.error("ARCHIVE_UNAVAILABLE", "Archive cancelled on activity disposal", null)
                                return@post
                            }
                            expiry?.let(main::removeCallbacks)
                            expiry = Runnable {
                                active?.takeIf { it.id == stage.id }?.let { it.revoke(); providerCancellation?.cancel() }
                                pendingSave?.takeIf { it.first == stage.id }?.let {
                                    pendingSave = null
                                    it.second.error("ARCHIVE_EXPIRED", "Archive expired; download again", null)
                                }
                                if (!closed.get()) worker.execute { discard(stage.id) }
                            }.also { main.postDelayed(it, 10 * 60 * 1000L) }
                            result.success(stage.id)
                        }
                    }
                    "append" -> {
                        val stage = requireStage(call)
                        val bytes = requireNotNull(call.argument<ByteArray>("bytes"))
                        try { stage.append(bytes) } finally { bytes.fill(0) }
                        main.post { result.success(null) }
                    }
                    "seal" -> {
                        requireStage(call).seal(requireNotNull(call.argument<Number>("bytes")).toLong(),
                            requireNotNull(call.argument<String>("sha256")))
                        main.post { result.success(null) }
                    }
                    "discard" -> {
                        check(discard(requireNotNull(call.argument<String>("id"))))
                        main.post { result.success(null) }
                    }
                    "save" -> {
                        val stage = requireStage(call); check(stage.sealed && !pickerBusy)
                        pickerBusy = true
                        main.post {
                            try {
                                check(!closed.get() && active?.id == stage.id)
                                pendingSave = stage.id to result
                                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                                    addCategory(Intent.CATEGORY_OPENABLE)
                                    type = "application/x-ndjson"
                                    putExtra(Intent.EXTRA_TITLE, "lifestyle-domain-archive-v1.ndjson")
                                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                                }
                                activity.startActivityForResult(intent, REQUEST_SAVE)
                            } catch (_: Exception) {
                                pickerBusy = false; pendingSave = null
                                result.error("ARCHIVE_UNAVAILABLE", "Document chooser unavailable", null)
                            }
                        }
                    }
                    else -> main.post { result.notImplemented() }
                }
            } catch (_: Exception) {
                if (call.method in listOf("append", "seal")) {
                    call.argument<String>("id")?.let { discard(it) }
                }
                main.post { result.error("ARCHIVE_UNAVAILABLE", "Archive operation unavailable; download again", null) }
            }
        }
    }

    private fun requireStage(call: MethodCall): AccountArchiveStage {
        val stage = requireNotNull(active)
        check(stage.id == call.argument<String>("id"))
        return stage
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != REQUEST_SAVE) return false
        pickerBusy = false
        val pending = pendingSave ?: return true
        pendingSave = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) { pending.second.success("cancelled"); return true }
        worker.execute { saveToChosenDocument(pending.first, uri, pending.second) }
        return true
    }

    private fun saveToChosenDocument(id: String, uri: Uri, result: MethodChannel.Result) {
        var created = false
        try {
            check(!closed.get() && uri.scheme == "content")
            val stage = requireNotNull(active); check(stage.id == id && stage.sealed)
            val cancellation = CancellationSignal(); providerCancellation = cancellation
            // ACTION_CREATE_DOCUMENT creates a user-chosen new document; no arbitrary path/URI input from Dart.
            val descriptor = requireNotNull(activity.contentResolver.openFileDescriptor(uri, "w", cancellation))
            created = true
            android.os.ParcelFileDescriptor.AutoCloseOutputStream(descriptor).use { stage.copyVerifiedTo(it) }
            val readDescriptor = requireNotNull(activity.contentResolver.openFileDescriptor(uri, "r", cancellation))
            android.os.ParcelFileDescriptor.AutoCloseInputStream(readDescriptor).use { stage.verifySaved(it) }
            check(!closed.get() && !cancellation.isCanceled)
            check(discard(id))
            main.post { result.success("saved") }
        } catch (_: Exception) {
            // Only attempt removal of this newly chosen document. A provider can refuse;
            // UI always warns that an unconfirmed/partial destination may remain.
            if (created) {
                try { DocumentsContract.deleteDocument(activity.contentResolver, uri) }
                catch (_: Exception) { cleanupWarning() }
            }
            discard(id)
            main.post { result.error("ARCHIVE_SAVE_UNCONFIRMED", "Save not confirmed; a partial document may remain at your chosen location", null) }
        } finally { providerCancellation = null }
    }

    private fun discard(id: String): Boolean {
        val stage = active ?: return true
        if (stage.id != id) return true // Never delete a different session's staging.
        active = null
        return try { stage.close(); true } catch (_: Exception) { cleanupWarning(); false }
        finally { synchronized(stageLock) { ownedStages.remove(stage.file.name) } }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        channel.setMethodCallHandler(null)
        expiry?.let(main::removeCallbacks); expiry = null
        active?.revoke(); providerCancellation?.cancel()
        pendingSave?.second?.error("ARCHIVE_UNAVAILABLE", "Archive cancelled on activity disposal", null)
        pendingSave = null
        worker.execute { active?.id?.let { discard(it) } }
        worker.shutdown()
    }

    private fun cleanupWarning() { Log.w("AccountArchive", "Encrypted staging or new destination cleanup could not be confirmed") }
    companion object {
        const val REQUEST_SAVE = 8421
        private val stageLock = Any()
        private val ownedStages = mutableSetOf<String>()
    }
}
