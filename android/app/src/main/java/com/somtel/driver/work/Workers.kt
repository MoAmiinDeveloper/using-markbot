package com.somtel.driver.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.somtel.driver.appContainer
import com.somtel.driver.core.queue.SyncOutcome
import java.util.concurrent.TimeUnit

object WorkScheduler {
    private const val SYNC_WORK = "somtel-sync"
    private const val UPDATES_WORK = "somtel-updates"

    private val networkConstraint: Constraints
        get() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Sends the offline queue once a network is available; retries with exponential backoff. */
    fun enqueueSync(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(networkConstraint)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(SYNC_WORK, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    /** Background poll of /driver/updates every 15 minutes (WorkManager minimum). */
    fun schedulePeriodicUpdates(context: Context) {
        val request = PeriodicWorkRequestBuilder<UpdatesWorker>(15, TimeUnit.MINUTES)
            .setConstraints(networkConstraint)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(UPDATES_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun cancelAll(context: Context) {
        val wm = WorkManager.getInstance(context)
        wm.cancelUniqueWork(SYNC_WORK)
        wm.cancelUniqueWork(UPDATES_WORK)
    }
}

class SyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val container = applicationContext.appContainer
        if (container.sessionStore.current == null) return Result.success()
        return when (container.runSync().outcome) {
            SyncOutcome.DONE -> Result.success()
            SyncOutcome.RETRY -> Result.retry()
            SyncOutcome.UNAUTHORIZED -> Result.success()
        }
    }
}

class UpdatesWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val container = applicationContext.appContainer
        if (container.sessionStore.current == null) return Result.success()
        try {
            container.runSync()
            val newJobs = container.repository.pollUpdates()
            container.notifier.notifyNewJobs(newJobs)
        } catch (_: Exception) {
            // Periodic work: the next run will try again.
        }
        return Result.success()
    }
}
