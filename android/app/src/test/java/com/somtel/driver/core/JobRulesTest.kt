package com.somtel.driver.core

import com.somtel.driver.core.model.JobStatus
import com.somtel.driver.core.model.StopStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class JobRulesTest {
    @Test
    fun primaryActionFollowsDriverLifecycle() {
        assertEquals(DriverAction.ACCEPT, JobRules.nextAction(JobStatus.ASSIGNED))
        assertEquals(DriverAction.START_TRIP, JobRules.nextAction(JobStatus.ACCEPTED))
        assertEquals(DriverAction.ARRIVED, JobRules.nextAction(JobStatus.EN_ROUTE))
        assertEquals(DriverAction.START_WORK, JobRules.nextAction(JobStatus.ARRIVED))
        assertEquals(DriverAction.COMPLETE, JobRules.nextAction(JobStatus.IN_PROGRESS))
        assertNull(JobRules.nextAction(JobStatus.COMPLETED))
        assertNull(JobRules.nextAction(JobStatus.FAILED))
        assertNull(JobRules.nextAction(JobStatus.CANCELLED))
        assertNull(JobRules.nextAction(JobStatus.UNASSIGNED))
        assertNull(JobRules.nextAction("somethingNew"))
    }

    @Test
    fun transitions() {
        assertTrue(JobRules.canTransition(JobStatus.ASSIGNED, JobStatus.ACCEPTED))
        assertFalse(JobRules.canTransition(JobStatus.ASSIGNED, JobStatus.IN_PROGRESS))
        assertTrue(JobRules.canTransition(JobStatus.IN_PROGRESS, JobStatus.FAILED))
        assertFalse(JobRules.canTransition(JobStatus.COMPLETED, JobStatus.FAILED))
        assertFalse(JobRules.canReportProblem(JobStatus.CANCELLED))
    }

    @Test
    fun requiredChecklistBlocksComplete() {
        val job = Fixtures.job().copy(status = JobStatus.IN_PROGRESS)
        assertFalse(JobRules.canPerform(job, DriverAction.COMPLETE))
        assertTrue(JobRules.canPerform(job, DriverAction.START_WORK))
        val ticked = job.copy(checklist = job.checklist.map { if (it.required) it.copy(done = true) else it })
        assertTrue(JobRules.canPerform(ticked, DriverAction.COMPLETE))
        assertTrue(JobRules.missingRequired(ticked).isEmpty())
    }

    @Test
    fun stopActionsAndProgress() {
        assertEquals(listOf(StopStatus.ARRIVED, StopStatus.COMPLETED, StopStatus.SKIPPED), JobRules.stopActions(StopStatus.PENDING))
        assertEquals(listOf(StopStatus.COMPLETED, StopStatus.SKIPPED), JobRules.stopActions(StopStatus.ARRIVED))
        assertTrue(JobRules.stopActions(StopStatus.COMPLETED).isEmpty())
        val job = Fixtures.job()
        assertEquals(0 to 2, JobRules.stopProgress(job))
        val one = job.copy(stops = job.stops.mapIndexed { i, s -> if (i == 0) s.copy(status = StopStatus.SKIPPED) else s })
        assertEquals(1 to 2, JobRules.stopProgress(one))
    }

    @Test
    fun lateDetection() {
        val job = Fixtures.job() // due 2026-10-24T09:30:00Z
        assertFalse(JobRules.isLate(job, Instant.parse("2026-10-24T09:00:00Z")))
        assertTrue(JobRules.isLate(job, Instant.parse("2026-10-24T10:00:00Z")))
        assertFalse(JobRules.isLate(job.copy(status = JobStatus.COMPLETED), Instant.parse("2026-10-24T10:00:00Z")))
        assertFalse(JobRules.isLate(job.copy(dueBy = null), Instant.parse("2030-01-01T00:00:00Z")))
        // Server-computed flag wins (e.g. phone clock behind).
        assertTrue(JobRules.isLate(job.copy(late = true), Instant.parse("2026-10-24T09:00:00Z")))
        assertFalse(JobRules.isLate(job.copy(late = true, status = "completed"), Instant.parse("2026-10-24T09:00:00Z")))
    }

    @Test
    fun sorting() {
        val base = Fixtures.job()
        val a = base.copy(id = 1, dueBy = "2026-10-25T00:00:00Z")
        val b = base.copy(id = 2, dueBy = "2026-10-24T00:00:00Z")
        val c = base.copy(id = 3, dueBy = null)
        assertEquals(listOf(2L, 1L, 3L), JobRules.sortActive(listOf(a, b, c)).map { it.id })
        val h1 = base.copy(id = 1, completedAt = "2026-10-20T00:00:00Z")
        val h2 = base.copy(id = 2, completedAt = "2026-10-22T00:00:00Z")
        assertEquals(listOf(2L, 1L), JobRules.sortHistory(listOf(h1, h2)).map { it.id })
    }

    @Test
    fun timeParsing() {
        assertEquals(Instant.parse("2026-10-24T06:00:00Z"), TimeFormat.parse("2026-10-24T09:00:00+03:00"))
        assertEquals(Instant.parse("2026-10-24T06:00:00.123Z"), TimeFormat.parse("2026-10-24T06:00:00.123Z"))
        assertNull(TimeFormat.parse("nope"))
        assertNull(TimeFormat.parse(null))
    }
}
