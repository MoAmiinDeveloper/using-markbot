package com.somtel.driver.core

import com.somtel.driver.core.model.Job
import com.somtel.driver.core.model.JobStatus
import com.somtel.driver.core.model.StopStatus
import java.time.Instant

/** The single "big button" step a driver can take next. */
enum class DriverAction(val targetStatus: String) {
    ACCEPT(JobStatus.ACCEPTED),
    START_TRIP(JobStatus.EN_ROUTE),
    ARRIVED(JobStatus.ARRIVED),
    START_WORK(JobStatus.IN_PROGRESS),
    COMPLETE(JobStatus.COMPLETED),
}

/** Driver-side job lifecycle rules (assigned → accepted → enRoute → arrived → inProgress → completed | failed). */
object JobRules {
    private val TERMINAL = setOf(JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED)

    /** Statuses in which the driver is actively working the job (used for location sharing). */
    private val ON_JOB = setOf(JobStatus.ACCEPTED, JobStatus.EN_ROUTE, JobStatus.ARRIVED, JobStatus.IN_PROGRESS)

    private val FAILABLE = setOf(
        JobStatus.ASSIGNED, JobStatus.ACCEPTED, JobStatus.EN_ROUTE, JobStatus.ARRIVED, JobStatus.IN_PROGRESS,
    )

    fun isTerminal(status: String): Boolean = status in TERMINAL

    fun isActive(status: String): Boolean = !isTerminal(status)

    fun isOnJob(status: String): Boolean = status in ON_JOB

    /** Next primary action for a status, or null when there is none (terminal / unassigned). */
    fun nextAction(status: String): DriverAction? = when (status) {
        JobStatus.ASSIGNED -> DriverAction.ACCEPT
        JobStatus.ACCEPTED -> DriverAction.START_TRIP
        JobStatus.EN_ROUTE -> DriverAction.ARRIVED
        JobStatus.ARRIVED -> DriverAction.START_WORK
        JobStatus.IN_PROGRESS -> DriverAction.COMPLETE
        else -> null
    }

    fun canTransition(from: String, to: String): Boolean =
        nextAction(from)?.targetStatus == to || (to == JobStatus.FAILED && from in FAILABLE)

    fun canReportProblem(status: String): Boolean = status in FAILABLE

    /** Required checklist items that are not ticked yet. */
    fun missingRequired(job: Job) = job.checklist.filter { it.required && !it.done }

    /** Whether the primary action may be performed (Complete is blocked by unticked required items). */
    fun canPerform(job: Job, action: DriverAction): Boolean =
        action != DriverAction.COMPLETE || missingRequired(job).isEmpty()

    /** Per-stop actions available to the driver. */
    fun stopActions(stopStatus: String): List<String> = when (stopStatus) {
        StopStatus.PENDING -> listOf(StopStatus.ARRIVED, StopStatus.COMPLETED, StopStatus.SKIPPED)
        StopStatus.ARRIVED -> listOf(StopStatus.COMPLETED, StopStatus.SKIPPED)
        else -> emptyList()
    }

    fun stopProgress(job: Job): Pair<Int, Int> {
        val done = job.stops.count { it.status == StopStatus.COMPLETED || it.status == StopStatus.SKIPPED }
        return done to job.stops.size
    }

    fun isLate(job: Job, now: Instant): Boolean {
        if (isTerminal(job.status)) return false
        val due = TimeFormat.parse(job.dueBy) ?: return false
        return now.isAfter(due)
    }

    /** Active jobs first by due time (nulls last), then by id. */
    fun sortActive(jobs: List<Job>): List<Job> = jobs.sortedWith(
        compareBy<Job> { TimeFormat.parse(it.dueBy) ?: Instant.MAX }.thenBy { it.id },
    )

    /** History newest first. */
    fun sortHistory(jobs: List<Job>): List<Job> = jobs.sortedWith(
        compareByDescending<Job> { TimeFormat.parse(it.completedAt ?: it.updatedAt ?: it.createdAt) ?: Instant.MIN }
            .thenByDescending { it.id },
    )
}
