package com.example.lifestyle_mobile

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest

/** Real JVM/AES-GCM checks only; does NOT execute Android/SAF/Flutter. */
fun main(args: Array<String>) {
    val directory = File(args.single()); check(directory.isDirectory)
    var passed = 0
    fun test(name: String, body: () -> Unit) { body(); passed++; println("PASS: $name (JVM staging only)") }
    fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun rejects(body: () -> Unit) {
        var rejected = false
        try { body() } catch (_: Exception) { rejected = true }
        check(rejected) { "Expected controlled rejection" }
    }
    val payload = "synthetic personal record: مهمة — 900719925474099.1234\n".repeat(50).toByteArray(Charsets.UTF_8)
    test("encrypted bytes are not a plaintext staging file; verified copy/readback and cleanup") {
        val stage = AccountArchiveStage(directory)
        stage.append(payload); stage.seal(payload.size.toLong(), hash(payload))
        check(!stage.file.readText(Charsets.ISO_8859_1).contains("synthetic personal record"))
        val result = ByteArrayOutputStream(); stage.copyVerifiedTo(result)
        check(result.toByteArray().contentEquals(payload))
        stage.verifySaved(ByteArrayInputStream(result.toByteArray()))
        stage.close(); check(!stage.file.exists())
    }
    test("cannot publish before seal") {
        AccountArchiveStage(directory).use { stage -> stage.append(payload); rejects { stage.copyVerifiedTo(ByteArrayOutputStream()) } }
    }
    test("mismatched whole-file hash cannot seal") {
        AccountArchiveStage(directory).use { stage -> stage.append(payload); rejects { stage.seal(payload.size.toLong(), "0".repeat(64)) } }
    }
    test("mismatched byte length cannot seal") {
        AccountArchiveStage(directory).use { stage -> stage.append(payload); rejects { stage.seal(1, hash(payload)) } }
    }
    test("oversized and empty codec chunks fail") {
        AccountArchiveStage(directory).use { stage ->
            rejects { stage.append(ByteArray(AccountArchiveStage.CHUNK_BYTES + 1)) }
            rejects { stage.append(ByteArray(0)) }
        }
    }
    test("ciphertext corruption fails authenticated decryption") {
        AccountArchiveStage(directory).use { stage ->
            stage.append(payload); stage.seal(payload.size.toLong(), hash(payload))
            RandomAccessFile(stage.file, "rw").use { file -> file.seek(file.length() - 1); val old = file.readByte(); file.seek(file.length() - 1); file.writeByte(old.toInt() xor 1) }
            rejects { stage.copyVerifiedTo(ByteArrayOutputStream()) }
        }
    }
    test("truncated stage is not a successful copy") {
        AccountArchiveStage(directory).use { stage ->
            stage.append(payload); stage.seal(payload.size.toLong(), hash(payload))
            RandomAccessFile(stage.file, "rw").use { it.setLength(it.length() - 1) }
            rejects { stage.copyVerifiedTo(ByteArrayOutputStream()) }
        }
    }
    test("provider readback mismatch/truncation cannot confirm save") {
        AccountArchiveStage(directory).use { stage ->
            stage.append(payload); stage.seal(payload.size.toLong(), hash(payload))
            rejects { stage.verifySaved(ByteArrayInputStream(byteArrayOf(1, 2))) }
        }
    }
    test("revoked stage cannot continue copy or append") {
        AccountArchiveStage(directory).use { stage ->
            stage.append(payload); stage.seal(payload.size.toLong(), hash(payload)); stage.revoke()
            rejects { stage.copyVerifiedTo(ByteArrayOutputStream()) }; rejects { stage.append(payload) }
        }
        AccountArchiveStage(directory).use { stage ->
            stage.append(payload); stage.seal(payload.size.toLong(), hash(payload))
            val cancelledAtEof = object : ByteArrayInputStream(payload) {
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
                    super.read(buffer, offset, length).also { if (it < 0) stage.revoke() }
            }
            rejects { stage.verifySaved(cancelledAtEof) }
        }
    }
    test("multi-chunk stream preserves exact bytes and ordering") {
        val data = ByteArray(AccountArchiveStage.CHUNK_BYTES * 3 + 7) { (it % 251).toByte() }
        AccountArchiveStage(directory).use { stage ->
            data.asList().chunked(AccountArchiveStage.CHUNK_BYTES).forEach { stage.append(it.toByteArray()) }
            stage.seal(data.size.toLong(), hash(data)); val result = ByteArrayOutputStream(); stage.copyVerifiedTo(result)
            check(result.toByteArray().contentEquals(data))
        }
    }
    check(directory.listFiles()!!.isEmpty())
    println("PASS: $passed JVM encryption/staging checks; Android document provider, lifecycle, permissions and Flutter NOT RUN")
}
