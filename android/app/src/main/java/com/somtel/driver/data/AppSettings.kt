package com.somtel.driver.data

import android.content.Context
import com.somtel.driver.core.SyncPrefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Non-secret preferences: last server/email, location toggle, polling cursor. */
class AppSettings(context: Context) : SyncPrefs {
    private val prefs = context.applicationContext.getSharedPreferences("somtel_settings", Context.MODE_PRIVATE)
    private val shareLocationState = MutableStateFlow(prefs.getBoolean(KEY_SHARE_LOCATION, false))

    var lastServerUrl: String
        get() = prefs.getString(KEY_SERVER, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_SERVER, value).apply()

    var lastEmail: String
        get() = prefs.getString(KEY_EMAIL, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_EMAIL, value).apply()

    /** "origin#userId" of the last account, to wipe local data when a different account logs in. */
    var lastAccountKey: String
        get() = prefs.getString(KEY_ACCOUNT, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_ACCOUNT, value).apply()

    val shareLocationFlow: StateFlow<Boolean> = shareLocationState.asStateFlow()

    var shareLocation: Boolean
        get() = shareLocationState.value
        set(value) {
            prefs.edit().putBoolean(KEY_SHARE_LOCATION, value).apply()
            shareLocationState.value = value
        }

    var notificationPermissionAsked: Boolean
        get() = prefs.getBoolean(KEY_NOTIF_ASKED, false)
        set(value) = prefs.edit().putBoolean(KEY_NOTIF_ASKED, value).apply()

    override var updatesSince: String?
        get() = prefs.getString(KEY_SINCE, null)
        set(value) = prefs.edit().putString(KEY_SINCE, value).apply()

    override var knownJobIds: Set<Long>
        get() = prefs.getStringSet(KEY_KNOWN, emptySet()).orEmpty().mapNotNull { it.toLongOrNull() }.toSet()
        set(value) = prefs.edit().putStringSet(KEY_KNOWN, value.map { it.toString() }.toSet()).apply()

    override var driverId: Long?
        get() = prefs.getLong(KEY_DRIVER_ID, -1L).takeIf { it > 0 }
        set(value) = prefs.edit().putLong(KEY_DRIVER_ID, value ?: -1L).apply()

    private companion object {
        const val KEY_SERVER = "server_url"
        const val KEY_EMAIL = "email"
        const val KEY_ACCOUNT = "account_key"
        const val KEY_SHARE_LOCATION = "share_location"
        const val KEY_NOTIF_ASKED = "notif_asked"
        const val KEY_SINCE = "updates_since"
        const val KEY_KNOWN = "known_job_ids"
        const val KEY_DRIVER_ID = "driver_id"
    }
}
