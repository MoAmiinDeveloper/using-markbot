package com.somtel.driver.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlTest {
    @Test
    fun normalizes() {
        assertEquals("https://fleet.example.com", ServerUrl.normalize("https://fleet.example.com/"))
        assertEquals("https://fleet.example.com", ServerUrl.normalize("  fleet.example.com "))
        assertEquals("http://192.168.1.10:8080", ServerUrl.normalize("http://192.168.1.10:8080"))
        assertEquals("http://192.168.1.10:8080", ServerUrl.normalize("http://192.168.1.10:8080/api/v1/"))
        assertEquals("https://host/fleet", ServerUrl.normalize("HTTPS://host/fleet/"))
    }

    @Test
    fun rejectsInvalid() {
        assertNull(ServerUrl.normalize(""))
        assertNull(ServerUrl.normalize("ftp://host"))
        assertNull(ServerUrl.normalize("http://"))
        assertNull(ServerUrl.normalize("https://host?x=1"))
        assertNull(ServerUrl.normalize("http://bad host"))
    }

    @Test
    fun apiBaseAndCleartext() {
        assertEquals("https://h/api/v1", ServerUrl.apiBase("https://h"))
        assertTrue(ServerUrl.isCleartext("http://10.0.0.2:8080"))
        assertFalse(ServerUrl.isCleartext("https://h"))
    }

    @Test
    fun resolvesFileUrls() {
        assertEquals("https://h/api/v1/files/9", ServerUrl.resolve("https://h", "/api/v1/files/9"))
        assertEquals("https://h/fleet/api/v1/files/9", ServerUrl.resolve("https://h/fleet", "/fleet/api/v1/files/9"))
        assertEquals("https://h/fleet/api/v1/files/9", ServerUrl.resolve("https://h/fleet", "/api/v1/files/9"))
        assertEquals("https://cdn/x.jpg", ServerUrl.resolve("https://h", "https://cdn/x.jpg"))
    }
}
