package com.somtel.driver.core

import java.net.URI

/** Server URL handling: users type `https://fleet.example.com` or `http://192.168.1.10:8080`. */
object ServerUrl {
    /**
     * Normalises user input to an origin (scheme://host[:port][/prefix]) without a trailing slash and
     * without a trailing `/api/v1`. Input without a scheme is assumed to be https. Returns null when invalid.
     */
    fun normalize(input: String): String? {
        var s = input.trim()
        if (s.isEmpty()) return null
        if (!s.contains("://")) s = "https://$s"
        s = s.trimEnd('/')
        if (s.endsWith("/api/v1", ignoreCase = true)) s = s.dropLast("/api/v1".length).trimEnd('/')
        val uri = try {
            URI(s)
        } catch (_: Exception) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host
        if (host.isNullOrBlank()) return null
        if (uri.rawQuery != null || uri.rawFragment != null) return null
        val port = if (uri.port != -1) ":${uri.port}" else ""
        val path = (uri.rawPath ?: "").trimEnd('/')
        val hostPart = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        return "$scheme://$hostPart$port$path"
    }

    fun apiBase(origin: String): String = "${origin.trimEnd('/')}/api/v1"

    fun isCleartext(origin: String): Boolean = origin.startsWith("http://", ignoreCase = true)

    /** Resolves an attachment url (`/api/v1/files/9`) against the server origin. */
    fun resolve(origin: String, url: String): String {
        if (url.startsWith("http://", true) || url.startsWith("https://", true)) return url
        val o = origin.trimEnd('/')
        if (!url.startsWith("/")) return "$o/$url"
        // Origin may itself carry a path prefix (reverse proxy); avoid doubling it.
        val uri = URI(o)
        val path = (uri.rawPath ?: "").trimEnd('/')
        return if (path.isNotEmpty() && url.startsWith("$path/")) {
            o.dropLast(path.length) + url
        } else {
            o + url
        }
    }
}
