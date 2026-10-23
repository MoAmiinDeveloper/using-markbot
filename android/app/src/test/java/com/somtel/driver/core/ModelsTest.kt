package com.somtel.driver.core

import com.somtel.driver.core.model.AppJson
import com.somtel.driver.core.model.DriverMe
import com.somtel.driver.core.model.Job
import com.somtel.driver.core.model.LoginResponse
import com.somtel.driver.core.model.StatusRequest
import com.somtel.driver.core.model.UpdatesResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {
    @Test
    fun decodesContractJob() {
        val job = Fixtures.job()
        assertEquals(101L, job.id)
        assertEquals("JOB-000101", job.reference)
        assertEquals("high", job.priority)
        assertEquals(2, job.stops.size)
        assertEquals(2.04, job.stops[0].lat!!, 1e-9)
        assertEquals(99.5, job.stops[1].radius, 1e-9)
        assertTrue(job.checklist[0].required)
        assertEquals("/api/v1/files/9", job.attachments[0].url)
        assertNull(job.routeId)
    }

    @Test
    fun nullsForNonNullFieldsFallBackToDefaults() {
        val job = AppJson.decodeFromString(Job.serializer(), """{"id": 5, "title": null, "notes": null, "stops": null}""")
        assertEquals("", job.title)
        assertEquals("", job.notes)
        assertTrue(job.stops.isEmpty())
    }

    @Test
    fun decodesLoginAndDriverMeAndUpdates() {
        val login = AppJson.decodeFromString(
            LoginResponse.serializer(),
            """{"token":"abc","user":{"id":7,"email":"d@x","name":"Ali","role":"driver","groupIds":[1]}}""",
        )
        assertEquals("driver", login.user.role)
        val me = AppJson.decodeFromString(
            DriverMe.serializer(),
            """{"user":{"id":7,"role":"driver"},"driver":{"id":2,"name":"Ali","userId":7},"vehicle":null}""",
        )
        assertEquals(2L, me.driver!!.id)
        assertNull(me.vehicle)
        val upd = AppJson.decodeFromString(
            UpdatesResponse.serializer(),
            """{"jobs":[${Fixtures.JOB_JSON}],"now":"2026-10-24T08:00:00Z"}""",
        )
        assertEquals(1, upd.jobs.size)
        assertEquals("2026-10-24T08:00:00Z", upd.now)
    }

    @Test
    fun statusRequestOmitsNulls() {
        val s = AppJson.encodeToString(StatusRequest.serializer(), StatusRequest("accepted"))
        assertEquals("""{"status":"accepted"}""", s)
        val f = AppJson.encodeToString(StatusRequest.serializer(), StatusRequest("failed", reason = "Flat tyre"))
        assertTrue(f.contains("\"reason\":\"Flat tyre\""))
        assertFalse(f.contains("\"lat\""))
    }
}
