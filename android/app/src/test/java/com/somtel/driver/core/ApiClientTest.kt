package com.somtel.driver.core

import com.somtel.driver.core.model.JobStatus
import com.somtel.driver.core.model.StatusRequest
import com.somtel.driver.core.model.User
import com.somtel.driver.core.net.ApiActionExecutor
import com.somtel.driver.core.net.ApiClient
import com.somtel.driver.core.net.Session
import com.somtel.driver.core.queue.ActionQueue
import com.somtel.driver.core.queue.InMemoryTextStorage
import com.somtel.driver.core.queue.JobStore
import com.somtel.driver.core.queue.PendingAction
import com.somtel.driver.core.queue.SyncEngine
import com.somtel.driver.core.queue.SyncOutcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.time.Instant

class ApiClientTest {
    private lateinit var server: MockWebServer
    private var session: Session? = null
    private var unauthorizedCalls = 0
    private lateinit var api: ApiClient
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val origin = server.url("/").toString().trimEnd('/')
        session = Session(origin, "jwt-123", User(1, "d@x", "Ali", "driver"))
        api = ApiClient({ session }, { unauthorizedCalls++ })
    }

    @After
    fun tearDown() {
        server.shutdown()
        scope.cancel()
    }

    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun loginSendsCredentialsWithoutToken() = runTest {
        server.enqueue(json("""{"token":"t","user":{"id":1,"email":"d@x","name":"Ali","role":"driver"}}"""))
        val origin = session!!.serverUrl
        session = null
        val r = api.login(origin, "d@x", "pw")
        assertEquals("t", r.token)
        val req = server.takeRequest()
        assertEquals("/api/v1/auth/login", req.path)
        assertNull(req.getHeader("Authorization"))
        assertTrue(req.body.readUtf8().contains("\"password\":\"pw\""))
    }

    @Test
    fun loginFailureDoesNotTriggerLogout() = runTest {
        server.enqueue(json("""{"error":"invalid credentials"}""", 401))
        try {
            api.login(session!!.serverUrl, "d@x", "bad")
            fail()
        } catch (e: ApiException) {
            assertEquals(401, e.code)
            assertEquals("invalid credentials", e.message)
        }
        assertEquals(0, unauthorizedCalls)
    }

    @Test
    fun authenticatedCallsCarryBearerAndParseJobs() = runTest {
        server.enqueue(json("[${Fixtures.JOB_JSON}]"))
        val jobs = api.jobs("active")
        assertEquals(101L, jobs.single().id)
        val req = server.takeRequest()
        assertEquals("/api/v1/driver/jobs?status=active", req.path)
        assertEquals("Bearer jwt-123", req.getHeader("Authorization"))
    }

    @Test
    fun unauthorizedTriggersCallback() = runTest {
        server.enqueue(json("""{"error":"token expired"}""", 401))
        try {
            api.driverMe()
            fail()
        } catch (e: ApiException) {
            assertEquals(ErrorKind.UNAUTHORIZED, e.kind)
        }
        assertEquals(1, unauthorizedCalls)
    }

    @Test
    fun updatesEncodesSince() = runTest {
        server.enqueue(json("""{"jobs":[],"now":"2026-10-24T08:00:00Z"}"""))
        api.updates("2026-10-24T07:00:00+03:00")
        val req = server.takeRequest()
        assertEquals("/api/v1/driver/updates?since=2026-10-24T07%3A00%3A00%2B03%3A00", req.path)
    }

    @Test
    fun statusPostAcceptsEmptyOrJobBody() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))
        assertNull(api.postStatus(101, StatusRequest(JobStatus.ACCEPTED)))
        server.enqueue(json(Fixtures.JOB_JSON))
        assertEquals(101L, api.postStatus(101, StatusRequest(JobStatus.EN_ROUTE))!!.id)
        val first = server.takeRequest()
        assertEquals("/api/v1/driver/jobs/101/status", first.path)
        assertEquals("""{"status":"accepted"}""", first.body.readUtf8())
    }

    @Test
    fun uploadIsMultipartAndDeletesFile() = runTest {
        val dir = Files.createTempDirectory("up").toFile()
        val file = File(dir, "sig.png").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        server.enqueue(json("""{"id":9,"kind":"signature","url":"/api/v1/files/9","name":"sig.png"}""", 201))
        val executor = ApiActionExecutor(api)
        executor.execute(PendingAction.Upload("u", 101, 0, "signature", file.absolutePath, "sig.png", "image/png", stopId = 2))
        val req = server.takeRequest()
        assertEquals("/api/v1/driver/jobs/101/attachments", req.path)
        assertTrue(req.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        val body = req.body.readUtf8()
        assertTrue(body.contains("name=\"kind\""))
        assertTrue(body.contains("signature"))
        assertTrue(body.contains("name=\"stopId\""))
        assertTrue(body.contains("filename=\"sig.png\""))
        assertFalse(file.exists())
        dir.deleteRecursively()
    }

    @Test
    fun tokenNotSentToOtherHosts() = runTest {
        val other = MockWebServer()
        other.start()
        other.enqueue(MockResponse().setBody("x"))
        val call = api.httpClient.newCall(okhttp3.Request.Builder().url(other.url("/img.png")).build())
        call.execute().close()
        assertNull(other.takeRequest().getHeader("Authorization"))
        other.shutdown()
    }

    private class MemPrefs : SyncPrefs {
        override var updatesSince: String? = null
        override var knownJobIds: Set<Long> = emptySet()
    }

    @Test
    fun repositoryOfflineFirstFlow() = runTest {
        val queue = ActionQueue(InMemoryTextStorage())
        val prefs = MemPrefs()
        var syncRequests = 0
        val repo = JobRepository(api, queue, JobStore(InMemoryTextStorage()), prefs, scope, { syncRequests++ },
            clock = { Instant.parse("2026-10-24T08:00:00Z") })

        server.enqueue(json("[${Fixtures.JOB_JSON}]"))
        server.enqueue(json("[]"))
        repo.refresh()
        assertEquals(1, repo.jobs.value.size)
        assertEquals(setOf(101L), prefs.knownJobIds)
        assertEquals("2026-10-24T07:59:00Z", prefs.updatesSince)

        // Optimistic change is visible immediately and queued.
        repo.changeStatus(101, JobStatus.ACCEPTED)
        repo.setChecklist(101, 1, true)
        assertEquals(1, syncRequests.coerceAtMost(1))
        assertEquals(JobStatus.ACCEPTED, repo.job(101)!!.status)
        assertTrue(repo.job(101)!!.checklist[0].done)
        assertEquals(2, queue.snapshot().size)

        // Server down → retry, nothing lost.
        server.enqueue(json("""{"error":"db down"}""", 503))
        val engine = SyncEngine(queue, ApiActionExecutor(api), repo::onActionSynced, repo::onActionDropped)
        assertEquals(SyncOutcome.RETRY, engine.runOnce().outcome)
        assertEquals(2, queue.snapshot().size)

        // Server back: status returns job; checklist rejected (409) → dropped & surfaced.
        val accepted = Fixtures.JOB_JSON.replace("\"status\": \"assigned\"", "\"status\": \"accepted\"")
        server.enqueue(json(accepted))
        server.enqueue(json("""{"error":"item locked"}""", 409))
        val r = engine.runOnce()
        assertEquals(SyncOutcome.DONE, r.outcome)
        assertEquals(1, r.sent)
        assertEquals("item locked", repo.syncProblem.value)
        assertTrue(queue.snapshot().isEmpty())
        assertEquals(JobStatus.ACCEPTED, repo.job(101)!!.status)
        assertFalse(repo.job(101)!!.checklist[0].done)

        // Updates: a new job appears.
        val newJob = Fixtures.JOB_JSON.replace("\"id\": 101", "\"id\": 202")
        server.enqueue(json("""{"jobs":[$newJob],"now":"2026-10-24T08:01:00Z"}"""))
        val fresh = repo.pollUpdates()
        assertEquals(listOf(202L), fresh.map { it.id })
        assertEquals("2026-10-24T08:01:00Z", prefs.updatesSince)
        assertEquals(2, repo.jobs.value.size)
        assertTrue(repo.hasJobInProgress())

        repo.clearAll()
        assertTrue(repo.jobs.value.isEmpty())
        assertNull(prefs.updatesSince)
    }
}
