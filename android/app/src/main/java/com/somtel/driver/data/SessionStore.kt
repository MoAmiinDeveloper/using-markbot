package com.somtel.driver.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.somtel.driver.core.model.AppJson
import com.somtel.driver.core.net.Session
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Keeps the JWT session in EncryptedSharedPreferences (falls back to private prefs if the keystore fails). */
class SessionStore(context: Context) {
    private val prefs: SharedPreferences = createPrefs(context.applicationContext)
    private val state = MutableStateFlow(read())

    val session: StateFlow<Session?> = state.asStateFlow()

    val current: Session? get() = state.value

    fun save(session: Session) {
        prefs.edit().putString(KEY_SESSION, AppJson.encodeToString(Session.serializer(), session)).apply()
        state.value = session
    }

    fun clear() {
        prefs.edit().remove(KEY_SESSION).apply()
        state.value = null
    }

    private fun read(): Session? {
        val text = prefs.getString(KEY_SESSION, null) ?: return null
        return try {
            AppJson.decodeFromString(Session.serializer(), text)
        } catch (_: Exception) {
            null
        }
    }

    private companion object {
        const val KEY_SESSION = "session"

        fun createPrefs(context: Context): SharedPreferences = try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                "somtel_secure_session",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (e: Exception) {
            Log.w("SessionStore", "Encrypted prefs unavailable, using private prefs", e)
            context.getSharedPreferences("somtel_session_fallback", Context.MODE_PRIVATE)
        }
    }
}
