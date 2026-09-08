package app.paperead.credentials

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class CredentialRequest {
    lateinit var account: String
    var action: Int = 0
    var secret: String = ""
}

@TauriPlugin
class CredentialsPlugin(private val activity: Activity) : Plugin(activity) {
    private val alias = "app.paperead.reader.ai.v1"
    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        check(create) { "Credential key unavailable" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }

    @Command
    @Synchronized
    fun access(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(CredentialRequest::class.java)
            require(args.account.matches(Regex("^[a-fA-F0-9]{64}$")))
            val directory = File(activity.noBackupFilesDir, "paperead-credentials")
            check(directory.isDirectory || directory.mkdirs())
            val file = AtomicFile(File(directory, args.account))
            var value: String? = null
            when (args.action) {
                1 -> {
                    val bytes = args.secret.toByteArray(Charsets.UTF_8)
                    require(bytes.isNotEmpty() && bytes.size <= 2400)
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.ENCRYPT_MODE, key(true))
                    cipher.updateAAD(args.account.toByteArray(Charsets.UTF_8))
                    val encrypted = cipher.iv + cipher.doFinal(bytes)
                    val stream = file.startWrite()
                    try { stream.write(encrypted); file.finishWrite(stream) }
                    catch (error: Exception) { file.failWrite(stream); throw error }
                }
                2 -> file.delete()
                0 -> if (file.baseFile.exists()) {
                    val bytes = file.readFully()
                    require(bytes.size in 29..2500)
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(0,12)))
                    cipher.updateAAD(args.account.toByteArray(Charsets.UTF_8))
                    value = cipher.doFinal(bytes.copyOfRange(12,bytes.size)).toString(Charsets.UTF_8)
                }
                else -> error("Unsupported action")
            }
            invoke.resolve(JSObject().apply { if (value != null) put("value",value) })
        } catch (_: Exception) {
            // Do not echo account details, plaintext secrets, or native crypto errors.
            invoke.reject("Android credential storage unavailable")
        }
    }
}
