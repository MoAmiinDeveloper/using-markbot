package com.somtel.driver.core

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object TimeFormat {
    /** Parses an RFC 3339 timestamp; returns null when absent or malformed. */
    fun parse(value: String?): Instant? {
        if (value.isNullOrBlank()) return null
        return try {
            OffsetDateTime.parse(value).toInstant()
        } catch (_: Exception) {
            try {
                Instant.parse(value)
            } catch (_: Exception) {
                null
            }
        }
    }

    fun format(instant: Instant): String = DateTimeFormatter.ISO_INSTANT.format(instant)

    fun display(value: String?, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String? {
        val instant = parse(value) ?: return null
        return DateTimeFormatter.ofPattern("EEE d MMM, HH:mm", locale).withZone(zone).format(instant)
    }
}
