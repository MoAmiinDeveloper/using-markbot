package com.somtel.driver.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException

class ApiErrorsTest {
    @Test
    fun parsesErrorBody() {
        assertEquals("invalid transition", ApiErrors.parseMessage("""{"error": "invalid transition"}"""))
        assertNull(ApiErrors.parseMessage("<html>502</html>"))
        assertNull(ApiErrors.parseMessage(""))
        assertNull(ApiErrors.parseMessage("""{"error": ""}"""))
        val e = ApiErrors.fromResponse(409, """{"error":"job is completed"}""")
        assertEquals(409, e.code)
        assertEquals("job is completed", e.message)
        assertEquals(ErrorKind.CONFLICT, e.kind)
        assertEquals("HTTP 502", ApiErrors.fromResponse(502, "Bad gateway").message)
    }

    @Test
    fun mapsKindsAndRetryPolicy() {
        assertEquals(ErrorKind.UNAUTHORIZED, ApiErrors.kindFor(401))
        assertEquals(ErrorKind.FORBIDDEN, ApiErrors.kindFor(403))
        assertEquals(ErrorKind.VALIDATION, ApiErrors.kindFor(400))
        assertEquals(ErrorKind.TOO_LARGE, ApiErrors.kindFor(413))
        assertEquals(ErrorKind.SERVER, ApiErrors.kindFor(503))
        assertEquals(RetryPolicy.UNAUTHORIZED, ApiErrors.retryPolicy(401))
        assertEquals(RetryPolicy.RETRY, ApiErrors.retryPolicy(500))
        assertEquals(RetryPolicy.RETRY, ApiErrors.retryPolicy(429))
        assertEquals(RetryPolicy.DROP, ApiErrors.retryPolicy(409))
        assertEquals(RetryPolicy.DROP, ApiErrors.retryPolicy(404))
        assertEquals(ErrorKind.NETWORK, ApiErrors.kindOf(IOException("offline")))
        assertEquals(ErrorKind.UNKNOWN, ApiErrors.kindOf(IllegalStateException()))
    }
}
