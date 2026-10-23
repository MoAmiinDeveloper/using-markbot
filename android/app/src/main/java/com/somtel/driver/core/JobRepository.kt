package com.somtel.driver.core

import com.somtel.driver.core.model.Job
import com.somtel.driver.core.net.ApiClient
import com.somtel.driver.core.queue.ActionQueue
import com.somtel.driver.core.queue.DroppedAction
import com.somtel.driver.core.queue.JobStore
import com.somtel.driver.core.queue.PendingAction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import java.io.File
import java.time.Instant
import java.util.UUID

/** Small persisted bits the repository needs (implemented with SharedPreferences on Android). */
interface SyncPrefs {
    var updatesSince: String?
    var knownJobIds: Set<Long>

    /** The logged-in driver's `Driver.id` (from `/driver/me`), used to drop jobs reassigned to someone else. */
    var driverId: Long?
}

/** A queued change the server rejected permanently, shown once in the UI. */
data class SyncProblem(val message: String, val kind: ErrorKind?, val upload: Boolean)

/**
 * Single source of truth for jobs: last server state (persisted) + pending offline actions applied
 * optimistically. All driver changes go through [ActionQueue]; [requestSync] kicks the sync engine.
 */
class JobRepository(
    private val api: ApiClient,
    private val queue: ActionQueue,
    private val store: JobStore,
    private val prefs: SyncPrefs,
    scope: CoroutineScope,
    private val requestSync: () -> Unit,
    private val clock: () -> Instant = { Instant.now() },
) {
    private val serverJobs = MutableStateFlow(store.load().associateBy { it.id })
    private val dirtyJobIds = mutableSetOf<Long>()
    private val _syncProblem = MutableStateFlow<SyncProblem?>(null)

    val pendingActions: StateFlow<List<PendingAction>> = queue.actions

    /** Last action the server rejected permanently (shown once in the UI). */
    val syncProblem: StateFlow<SyncProblem?> = _syncProblem.asStateFlow()

    val jobs: StateFlow<List<Job>> = combine(serverJobs, queue.actions) { map, actions -> merge(map, actions) }
        .stateIn(scope, SharingStarted.Eagerly, merge(serverJobs.value, queue.snapshot()))

    private fun merge(map: Map<Long, Job>, actions: List<PendingAction>): List<Job> =
        map.values.map { OptimisticApplier.apply(it, actions) }

    fun job(id: Long): Job? = jobs.value.firstOrNull { it.id == id }

    fun hasJobInProgress(): Boolean = jobs.value.any { JobRules.isOnJob(it.status) }

    /**
     * Whether [job] is still assigned to this driver. The server also sends a job to its previous driver
     * after a reassignment (or after it was moved back to `unassigned`, which clears `driverId`).
     */
    fun belongsToMe(job: Job): Boolean {
        val owner = job.driverId ?: return false
        val me = prefs.driverId ?: return true
        return owner == me
    }

    /** Records the driver id from `/driver/me` and drops cached jobs that are no longer ours. */
    fun setDriverId(id: Long?) {
        if (id == null || prefs.driverId == id) return
        prefs.driverId = id
        val foreign = serverJobs.value.values.filterNot { belongsToMe(it) }
        if (foreign.isNotEmpty()) upsert(foreign)
    }

    // ---- Server reads -------------------------------------------------------------------------

    /** Full reload of active + history jobs (pull-to-refresh, app start). */
    suspend fun refresh() {
        val active = api.jobs("active")
        val history = api.jobs("history")
        val all = (active + history).filter { belongsToMe(it) }.associateBy { it.id }
        val gone = serverJobs.value.keys - all.keys
        serverJobs.value = all
        gone.forEach { discardQueued(it) }
        store.save(all.values)
        prefs.knownJobIds = prefs.knownJobIds + all.keys
        if (prefs.updatesSince == null) {
            prefs.updatesSince = TimeFormat.format(clock().minusSeconds(60))
        }
    }

    suspend fun refreshJob(id: Long) {
        try {
            upsert(listOf(api.job(id)))
        } catch (e: ApiException) {
            if (e.code == 404 || e.code == 403) {
                serverJobs.update { it - id }
                store.save(serverJobs.value.values)
                discardQueued(id)
            } else {
                throw e
            }
        }
    }

    /** Polls `/driver/updates`; returns jobs never seen before (for "New job assigned" notifications). */
    suspend fun pollUpdates(): List<Job> {
        val since = prefs.updatesSince
        if (since == null) {
            refresh()
            return emptyList()
        }
        val response = api.updates(since)
        if (response.jobs.isNotEmpty()) upsert(response.jobs)
        response.now?.let { prefs.updatesSince = it }
        val detected = NewJobDetector.detect(prefs.knownJobIds, response.jobs.filter { belongsToMe(it) })
        prefs.knownJobIds = detected.known
        return detected.newJobs
    }

    /** Merges server copies; jobs no longer assigned to this driver are removed with their queued actions. */
    private fun upsert(jobs: List<Job>) {
        val (mine, foreign) = jobs.partition { belongsToMe(it) }
        val foreignIds = foreign.map { it.id }.toSet()
        serverJobs.update { current -> current - foreignIds + mine.associateBy { it.id } }
        store.save(serverJobs.value.values)
        foreignIds.forEach { discardQueued(it) }
    }

    /** Drops queued actions (and pending upload files) of a job we no longer own. */
    private fun discardQueued(jobId: Long) {
        queue.removeForJob(jobId).filterIsInstance<PendingAction.Upload>().forEach { File(it.filePath).delete() }
    }

    // ---- Sync callbacks -----------------------------------------------------------------------

    fun onActionSynced(action: PendingAction, job: Job?) {
        if (job != null) upsert(listOf(job)) else synchronized(dirtyJobIds) { dirtyJobIds += action.jobId }
    }

    fun onActionDropped(dropped: DroppedAction) {
        synchronized(dirtyJobIds) { dirtyJobIds += dropped.action.jobId }
        _syncProblem.value = SyncProblem(
            message = dropped.message,
            kind = dropped.code?.let { ApiErrors.kindFor(it) },
            upload = dropped.action is PendingAction.Upload,
        )
        if (dropped.action is PendingAction.Upload) File(dropped.action.filePath).delete()
    }

    fun clearSyncProblem() {
        _syncProblem.value = null
    }

    /** Re-fetches jobs whose server copy may be stale after a sync run. Errors are ignored. */
    suspend fun refreshDirty() {
        val ids = synchronized(dirtyJobIds) { dirtyJobIds.toList().also { dirtyJobIds.clear() } }
        for (id in ids) {
            try {
                refreshJob(id)
            } catch (_: Exception) {
            }
        }
    }

    // ---- Driver changes (offline-first) -------------------------------------------------------

    private fun newId() = UUID.randomUUID().toString()
    private fun now() = clock().toEpochMilli()

    fun changeStatus(jobId: Long, status: String, reason: String? = null, lat: Double? = null, lng: Double? = null) =
        enqueue(PendingAction.StatusChange(newId(), jobId, now(), status, reason?.takeIf { it.isNotBlank() }, lat, lng))

    fun updateStop(jobId: Long, stopId: Long, status: String, notes: String? = null) =
        enqueue(PendingAction.StopUpdate(newId(), jobId, now(), stopId, status, notes))

    fun setChecklist(jobId: Long, itemId: Long, done: Boolean) =
        enqueue(PendingAction.ChecklistTick(newId(), jobId, now(), itemId, done))

    fun addNote(jobId: Long, text: String) {
        val trimmed = text.trim()
        if (trimmed.isNotEmpty()) enqueue(PendingAction.AddNote(newId(), jobId, now(), trimmed))
    }

    fun addUpload(jobId: Long, file: File, kind: String, mimeType: String, stopId: Long? = null) =
        enqueue(PendingAction.Upload(newId(), jobId, now(), kind, file.absolutePath, file.name, mimeType, stopId))

    private fun enqueue(action: PendingAction) {
        queue.enqueue(action)
        requestSync()
    }

    /** Forget everything (logout / different account). */
    fun clearAll() {
        queue.snapshot().filterIsInstance<PendingAction.Upload>().forEach { File(it.filePath).delete() }
        queue.clear()
        serverJobs.value = emptyMap()
        store.save(emptyList())
        prefs.updatesSince = null
        prefs.knownJobIds = emptySet()
        prefs.driverId = null
        _syncProblem.value = null
    }
}
