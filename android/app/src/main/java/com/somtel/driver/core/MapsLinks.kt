package com.somtel.driver.core

import java.net.URLEncoder
import java.util.Locale

/** URIs for the Navigate / Call actions (built as strings so they are unit-testable). */
object MapsLinks {
    private fun coord(v: Double) = String.format(Locale.US, "%.6f", v)

    /** Generic geo: URI understood by Google Maps, OsmAnd, Waze, … */
    fun geoUri(lat: Double, lng: Double, label: String?): String {
        val c = "${coord(lat)},${coord(lng)}"
        val q = if (label.isNullOrBlank()) c else "$c(${URLEncoder.encode(label, "UTF-8").replace("+", "%20")})"
        return "geo:$c?q=$q"
    }

    /** Google Maps turn-by-turn navigation intent URI. */
    fun googleNavigationUri(lat: Double, lng: Double): String = "google.navigation:q=${coord(lat)},${coord(lng)}"

    /** Web fallback when no maps app is installed. */
    fun webDirectionsUrl(lat: Double, lng: Double): String =
        "https://www.google.com/maps/dir/?api=1&destination=${coord(lat)},${coord(lng)}"

    fun telUri(phone: String): String? {
        val cleaned = phone.filter { it.isDigit() || it == '+' || it == '*' || it == '#' }
        return if (cleaned.isEmpty()) null else "tel:$cleaned"
    }
}
