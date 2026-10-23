package com.somtel.driver.core

import com.somtel.driver.core.model.Job
import com.somtel.driver.core.model.JobStatus
import com.somtel.driver.core.queue.ActionQueue
import com.somtel.driver.core.queue.FileTextStorage
import com.somtel.driver.core.queue.InMemoryTextStorage
import com.somtel.driver.core.queue.JobStore
import com.somtel.driver.core.queue.PendingAction
import com.somtel.driver.core.queue.SyncEngine
import com.somtel.driver.core.queue.SyncOutcome
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files

class QueueAndSyncTest {
    private fun status(id: String, s: String) = PendingAction.StatusChange(id, 101, 0, s)
    private fun note(id: String, t: String) = PendingAction.AddNote(id, 101, 0, t)

    @Test
    fun queuePersistsPolymorphicActions() {
        val storage = InMemoryTextStorage()
        val q = ActionQueue(storage)
        q.enqueue(status("a", JobStatus.ACCEPTED))
        q.enqueue(PendingAction.ChecklistTick("b", 101, 0, 1, true))
        q.enqueue(PendingAction.Upload("c", 101, 0, "photo", "/x/p.jpg", "p.jpg", "image/jpeg", stopId = 2))
        assertTrue(storage.value!!.contains("\"type\":\"upload\""))

        val reloaded = ActionQueue(storage)
        assertEquals(q.snapshot(), reloaded.snapshot())
        assertEquals(3, reloaded.countForJob(101))
        reloaded.remove("b")
        assertEquals(listOf("a", "c"), reloaded.snapshot().map { it.id })
        reloaded.clear()
        assertTrue(ActionQueue(storage).snapshot().isEmpty())
    }

    @Test
    fun corruptQueueFileStartsEmpty() {
        val q = ActionQueue(InMemoryTextStorage("{not json"))
        assertTrue(q.snapshot().isEmpty())
    }

    @Test
    fun fileStorageRoundTrip() {
        val dir = Files.createTempDirectory("somtel").toFile()
        val file = File(dir, "sub/jobs.json")
        val store = JobStore(FileTextStorage(file))
        assertTrue(store.load().isEmpty())
        store.save(listOf(Fixtures.job()))
        assertEquals(Fixtures.job(), JobStore(FileTextStorage(file)).load().single())
        dir.deleteRecursively()
    }

    @Test
    fun syncDrainsInOrder() = runTest {
        val q = ActionQueue(InMemoryTextStorage())
        q.enqueue(status("1", JobStatus.ACCEPTED))
        q.enqueue(note("2", "hi"))
        val sentIds = mutableListOf<String>()
        val synced = mutableListOf<String>()
        val engine = SyncEngine(q, { a -> sentIds += a.id; null }, onSynced = { a, _ -> synced += a.id })
        val r = engine.runOnce()
        assertEquals(SyncOutcome.DONE, r.outcome)
        assertEquals(2, r.sent)
        assertEquals(listOf("1", "2"), sentIds)
        assertEquals(listOf("1", "2"), synced)
        assertTrue(q.snapshot().isEmpty())
    }

    @Test
    fun networkErrorStopsAndKeepsOrder() = runTest {
        val q = ActionQueue(InMemoryTextStorage())
        q.enqueue(status("1", JobStatus.ACCEPTED))
        q.enqueue(note("2", "hi"))
        var calls = 0
        val engine = SyncEngine(q, { _ -> calls++; throw IOException("offline") })
        val r = engine.runOnce()
        assertEquals(SyncOutcome.RETRY, r.outcome)
        assertEquals(1, calls)
        assertEquals(listOf("1", "2"), q.snapshot().map { it.id })
    }

    @Test
    fun serverErrorRetriesButConflictIsDropped() = runTest {
        val q = ActionQueue(InMemoryTextStorage())
        q.enqueue(status("1", JobStatus.ARRIVED))
        q.enqueue(note("2", "hi"))
        val dropped = mutableListOf<String>()
        val engine = SyncEngine(
            q,
            { a -> if (a.id == "1") throw ApiException(409, "invalid transition") else Fixtures.job() },
            onDropped = { dropped += it.action.id },
        )
        val r = engine.runOnce()
        assertEquals(SyncOutcome.DONE, r.outcome)
        assertEquals(1, r.sent)
        assertEquals(listOf("1"), dropped)
        assertEquals("invalid transition", r.dropped.single().message)

        q.enqueue(note("3", "again"))
        val r2 = SyncEngine(q, { _ -> throw ApiException(503, null) }).runOnce()
        assertEquals(SyncOutcome.RETRY, r2.outcome)
        assertEquals(1, q.snapshot().size)
    }

    @Test
    fun unauthorizedKeepsQueue() = runTest {
        val q = ActionQueue(InMemoryTextStorage())
        q.enqueue(note("1", "x"))
        val r = SyncEngine(q, { _ -> throw ApiException(401, "token expired") }).runOnce()
        assertEquals(SyncOutcome.UNAUTHORIZED, r.outcome)
        assertEquals(1, q.snapshot().size)
    }

    @Test
    fun unexpectedErrorIsDropped() = runTest {
        val q = ActionQueue(InMemoryTextStorage())
        q.enqueue(note("1", "x"))
        val r = SyncEngine(q, { _ -> throw IllegalStateException("file missing") }).runOnce()
        assertEquals(SyncOutcome.DONE, r.outcome)
        assertEquals("file missing", r.dropped.single().message)
    }

    @Test
    fun optimisticApply() {
        val job: Job = Fixtures.job()
        val actions = listOf(
            PendingAction.StatusChange("1", 101, 0, JobStatus.ACCEPTED),
            PendingAction.StopUpdate("2", 101, 0, stopId = 2, status = "arrived", notes = "gate 3"),
            PendingAction.ChecklistTick("3", 101, 0, itemId = 1, done = true),
            PendingAction.AddNote("4", 101, 0, "first"),
            PendingAction.AddNote("5", 101, 0, "second"),
            PendingAction.StatusChange("6", 999, 0, JobStatus.FAILED, reason = "other job"),
        )
        val out = OptimisticApplier.apply(job, actions)
        assertEquals(JobStatus.ACCEPTED, out.status)
        assertEquals("pending", out.stops[0].status)
        assertEquals("arrived", out.stops[1].status)
        assertEquals("gate 3", out.stops[1].notes)
        assertTrue(out.checklist[0].done)
        assertEquals("first\nsecond", out.notes)
        val failed = OptimisticApplier.apply(job, listOf(PendingAction.StatusChange("7", 101, 0, JobStatus.FAILED, "Flat tyre")))
        assertEquals("Flat tyre", failed.failureReason)
    }

    @Test
    fun newJobDetection() {
        val j = Fixtures.job()
        val first = NewJobDetector.detect(emptySet(), listOf(j, j.copy(id = 102, status = JobStatus.COMPLETED)))
        assertEquals(listOf(101L), first.newJobs.map { it.id })
        assertEquals(setOf(101L, 102L), first.known)
        val second = NewJobDetector.detect(first.known, listOf(j, j.copy(id = 103)))
        assertEquals(listOf(103L), second.newJobs.map { it.id })
    }
}
