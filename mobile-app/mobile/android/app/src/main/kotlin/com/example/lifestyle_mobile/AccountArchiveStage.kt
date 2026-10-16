package com.example.lifestyle_mobile

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Android-free bounded encrypted staging; no plaintext temporary file or persistent key. */
internal class AccountArchiveStage(directory: File) : AutoCloseable {
    val id: String = UUID.randomUUID().toString()
    val file = File(directory, "$id.enc")
    private val key = ByteArray(32).also { SecureRandom().nextBytes(it) }
    private val digest = MessageDigest.getInstance("SHA-256")
    private val revoked = AtomicBoolean(false)
    private var output: DataOutputStream? = null
    private var chunks = 0
    private var bytes = 0L
    private var expectedHash: String? = null
    @Volatile private var closed = false
    @Volatile var sealed = false
        private set

    init {
        require(directory.isDirectory && file.createNewFile())
        try {
            check(file.setReadable(false, false) && file.setReadable(true, true))
            check(file.setWritable(false, false) && file.setWritable(true, true))
            output = DataOutputStream(FileOutputStream(file))
            output!!.write(MAGIC)
        } catch (error: Exception) { key.fill(0); file.delete(); throw error }
    }

    fun revoke() { revoked.set(true) }
    private fun checkActive() { check(!closed && !revoked.get()) }

    fun append(data: ByteArray) {
        checkActive(); check(!sealed)
        require(data.isNotEmpty() && data.size <= CHUNK_BYTES && chunks < MAX_CHUNKS)
        require(bytes + data.size <= MAX_BYTES)
        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = cipher(Cipher.ENCRYPT_MODE, nonce, chunks)
        val encrypted = cipher.doFinal(data)
        output!!.writeInt(encrypted.size)
        output!!.write(nonce)
        output!!.write(encrypted)
        digest.update(data); bytes += data.size; chunks++
    }

    fun seal(length: Long, hash: String) {
        checkActive(); check(!sealed && bytes > 0 && length == bytes)
        require(Regex("^[0-9a-f]{64}$").matches(hash))
        check(digest.digest().hex() == hash)
        output!!.flush(); output!!.close(); output = null
        expectedHash = hash; sealed = true
    }

    /** GCM is per bounded chunk, not a potentially whole-file-buffering CipherInputStream. */
    fun copyVerifiedTo(destination: OutputStream) {
        checkActive(); check(sealed)
        var written = 0L
        val copiedHash = MessageDigest.getInstance("SHA-256")
        DataInputStream(FileInputStream(file)).use { input ->
            val magic = ByteArray(MAGIC.size); input.readFully(magic); check(magic.contentEquals(MAGIC))
            repeat(chunks) { index ->
                checkActive()
                val size = input.readInt(); require(size in 17..(CHUNK_BYTES + 16))
                val nonce = ByteArray(12); input.readFully(nonce)
                val encrypted = ByteArray(size); input.readFully(encrypted)
                val plain = cipher(Cipher.DECRYPT_MODE, nonce, index).doFinal(encrypted)
                try {
                    written += plain.size; check(written <= bytes)
                    copiedHash.update(plain); destination.write(plain)
                } finally { plain.fill(0) }
            }
            check(input.read() == -1 && written == bytes && copiedHash.digest().hex() == expectedHash)
        }
        checkActive(); destination.flush()
    }

    /** Verify provider readback, without loading the selected plaintext document in memory. */
    fun verifySaved(input: InputStream) {
        checkActive(); check(sealed)
        val hash = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(CHUNK_BYTES)
        var readBytes = 0L
        try {
            while (true) {
                checkActive(); val count = input.read(buffer); if (count < 0) break
                readBytes += count; check(readBytes <= bytes)
                hash.update(buffer, 0, count)
            }
            checkActive() // A read may finish with EOF after revocation during blocking I/O.
            check(readBytes == bytes && hash.digest().hex() == expectedHash)
        } finally { buffer.fill(0) }
    }

    private fun cipher(mode: Int, nonce: ByteArray, index: Int): Cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
        init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        updateAAD("lifestyle-archive-stage-v1:$id:$index".toByteArray(Charsets.UTF_8))
    }

    override fun close() {
        if (closed) return
        revoked.set(true); closed = true
        try { output?.close() } finally {
            output = null; key.fill(0)
            check(!file.exists() || file.delete()) { "Encrypted staging cleanup incomplete" }
        }
    }

    companion object {
        const val MAX_BYTES = 128L * 1024 * 1024
        const val CHUNK_BYTES = 32 * 1024
        const val MAX_CHUNKS = 8192
        private val MAGIC = "LIFESTYLE-ARCHIVE-STAGE-1\n".toByteArray(Charsets.US_ASCII)
        private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it.toInt() and 255) }
    }
}
