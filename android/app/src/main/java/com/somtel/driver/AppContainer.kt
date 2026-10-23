package com.somtel.driver

import android.content.Context
import com.somtel.driver.core.JobRepository
import com.somtel.driver.core.model.DriverMe
import com.somtel.driver.core.net.ApiActionExecutor
import com.somtel.driver.core.net.ApiClient
import com.somtel.driver.core.net.Session
import com.somtel.driver.core.queue.ActionQueue
import com.somtel.driver.core.queue.FileTextStorage
import com.somtel.driver.core.queue.JobStore
import com.somtel.driver.core.queue.SyncEngine
import com.somtel.driver.core.queue.SyncResult
import com.somtel.driver.data.AppSettings
import com.somtel.driver.data.SessionStore
import com.somtel.driver.location.LocationService
import com.somtel.driver.notify.Notifier
import com.somtel.driver.work.WorkScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

/** Manual dependency container (one per process, owned by [SomtelDriverApp]). */
class AppContainer(context: Context) {
    private val appContext: Context = context.applicationContext

    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val settings = AppSettings(appContext)
    val sessionStore = SessionStore(appContext)
    val notifier = Notifier(appContext)

    val api = ApiClient(session = { sessionStore.current }, onUnauthorized = { onUnauthorized() })

    private val queue = ActionQueue(FileTextStorage(File(appContext.filesDir, "queue/actions.json")))
    private val jobStore = JobStore(FileTextStorage(File(appContext.filesDir, "cache/jobs.json")))

    val repository = JobRepository(
        api = api,
        queue = queue,
        store = jobStore,
        prefs = settings,
        scope = appScope,
        requestSync = { requestSync() },
    )

    private val syncEngine = SyncEngine(
        queue = queue,
        executor = ApiActionExecutor(api),
        onSynced = { action, job -> repository.onActionSynced(action, job) },
        onDropped = { repository.onActionDropped(it) },
    )

    private val driverMeState = MutableStateFlow<DriverMe?>(null)
    val driverMe: StateFlow<DriverMe?> = driverMeState.asStateFlow()

    /** Directory for files waiting to be uploaded (kept until the upload succeeds). */
    val uploadsDir: File get() = File(appContext.filesDir, "uploads").apply { mkdirs() }

    /** Directory the camera writes full-size captures into (shared through FileProvider). */
    val captureDir: File get() = File(appContext.cacheDir, "photos").apply { mkdirs() }

    /** Try to send queued actions now; WorkManager retries with backoff if we are offline. */
    fun requestSync() {
        WorkScheduler.enqueueSync(appContext)
        appScope.launch { runSync() }
    }

    suspend fun runSync(): SyncResult {
        val result = syncEngine.runOnce()
        repository.refreshDirty()
        return result
    }

    /** Loads `/driver/me`; remembers the driver id so jobs reassigned to someone else are dropped. */
    suspend fun loadDriverMe(): DriverMe? = try {
        api.driverMe().also {
            driverMeState.value = it
            repository.setDriverId(it.driver?.id)
        }
    } catch (_: Exception) {
        driverMeState.value
    }

    fun onLoggedIn(session: Session, email: String) {
        val accountKey = "${session.serverUrl}#${session.user.id}"
        if (settings.lastAccountKey != accountKey) {
            repository.clearAll()
            settings.lastAccountKey = accountKey
        }
        settings.lastServerUrl = session.serverUrl
        settings.lastEmail = email
        sessionStore.save(session)
        WorkScheduler.schedulePeriodicUpdates(appContext)
        requestSync()
        appScope.launch {
            loadDriverMe()
            try {
                repository.refresh()
            } catch (_: Exception) {
            }
        }
    }

    /** Explicit logout: forget the session and all local job data. */
    fun logout() {
        sessionStore.clear()
        repository.clearAll()
        settings.lastAccountKey = ""
        settings.shareLocation = false
        driverMeState.value = null
        WorkScheduler.cancelAll(appContext)
        LocationService.stop(appContext)
        notifier.cancelAll()
        uploadsDir.listFiles()?.forEach { it.delete() }
    }

    /** Token rejected: drop the session but keep queued work so it syncs after the next login. */
    private fun onUnauthorized() {
        if (sessionStore.current != null) {
            sessionStore.clear()
            LocationService.stop(appContext)
        }
    }
}
