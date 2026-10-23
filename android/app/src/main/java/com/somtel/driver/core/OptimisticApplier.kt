package com.somtel.driver.core

import com.somtel.driver.core.model.Job
import com.somtel.driver.core.model.JobStatus
import com.somtel.driver.core.queue.PendingAction

/** Applies not-yet-synced actions on top of the last known server state so the UI updates instantly. */
object OptimisticApplier {
    fun apply(job: Job, actions: List<PendingAction>): Job =
        actions.filter { it.jobId == job.id }.fold(job) { acc, action -> applyOne(acc, action) }

    fun applyOne(job: Job, action: PendingAction): Job = when (action) {
        is PendingAction.StatusChange -> job.copy(
            status = action.status,
            failureReason = if (action.status == JobStatus.FAILED) action.reason.orEmpty() else job.failureReason,
        )
        is PendingAction.StopUpdate -> job.copy(
            stops = job.stops.map { stop ->
                if (stop.id == action.stopId) {
                    stop.copy(status = action.status, notes = action.notes ?: stop.notes)
                } else {
                    stop
                }
            },
        )
        is PendingAction.ChecklistTick -> job.copy(
            checklist = job.checklist.map { if (it.id == action.itemId) it.copy(done = action.done) else it },
        )
        is PendingAction.AddNote -> job.copy(
            notes = if (job.notes.isBlank()) action.text else job.notes.trimEnd() + "\n" + action.text,
        )
        // Uploads are shown separately (local thumbnails) until the server returns the attachment.
        is PendingAction.Upload -> job
    }
}
