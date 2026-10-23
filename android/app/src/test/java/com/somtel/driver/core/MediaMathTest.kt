package com.somtel.driver.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaMathTest {
    @Test
    fun sampleSize() {
        assertEquals(1, ImageScaling.inSampleSize(1600, 1200))
        assertEquals(1, ImageScaling.inSampleSize(3000, 2000))
        assertEquals(2, ImageScaling.inSampleSize(4000, 3000))
        assertEquals(4, ImageScaling.inSampleSize(8000, 6000))
        assertEquals(1, ImageScaling.inSampleSize(0, 0))
    }

    @Test
    fun fitWithin() {
        assertEquals(1600 to 1200, ImageScaling.fitWithin(4000, 3000))
        assertEquals(900 to 1600, ImageScaling.fitWithin(2250, 4000))
        assertEquals(800 to 600, ImageScaling.fitWithin(800, 600))
        assertEquals(1600 to 1, ImageScaling.fitWithin(10000, 2))
    }

    @Test
    fun exifRotation() {
        assertEquals(0, ImageScaling.rotationForExif(1))
        assertEquals(90, ImageScaling.rotationForExif(6))
        assertEquals(180, ImageScaling.rotationForExif(3))
        assertEquals(270, ImageScaling.rotationForExif(8))
        assertEquals(0, ImageScaling.rotationForExif(0))
    }

    @Test
    fun signaturePad() {
        var pad = SignaturePad()
        assertTrue(pad.isEmpty)
        pad = pad.startStroke(Pt(0f, 0f)).extend(Pt(10f, 0f)).startStroke(Pt(5f, 5f)).extend(Pt(5f, 8f))
        assertEquals(2, pad.strokes.size)
        assertEquals(2, pad.strokes[0].size)
        assertFalse(pad.isEmpty)
        pad = pad.undo()
        assertEquals(1, pad.strokes.size)
        assertTrue(pad.clear().isEmpty)
        assertEquals(1, SignaturePad().extend(Pt(1f, 1f)).strokes.size)
    }

    @Test
    fun signatureFitCentresAndKeepsAspect() {
        // A 100x50 drawing at offset (50,50) into 800x400 with 20px padding → scale min(760/100, 360/50, 4) = 4
        val strokes = listOf(listOf(Pt(50f, 50f), Pt(150f, 100f)))
        val t = SignatureGeometry.fit(strokes, 800, 400, 20f)
        assertEquals(4f, t.scale, 1e-4f)
        val a = t.map(Pt(50f, 50f))
        val b = t.map(Pt(150f, 100f))
        assertEquals(400f, (a.x + b.x) / 2f, 1e-3f)
        assertEquals(200f, (a.y + b.y) / 2f, 1e-3f)
        assertEquals(400f, b.x - a.x, 1e-3f)

        // A wide drawing is limited by width.
        val wide = listOf(listOf(Pt(0f, 0f), Pt(1000f, 10f)))
        val tw = SignatureGeometry.fit(wide, 800, 400, 20f)
        assertEquals(0.76f, tw.scale, 1e-4f)
        assertEquals(20f, tw.map(Pt(0f, 0f)).x, 1e-3f)
        assertEquals(780f, tw.map(Pt(1000f, 0f)).x, 1e-3f)

        assertNull(SignatureGeometry.bounds(emptyList()))
        assertEquals(1f, SignatureGeometry.fit(emptyList(), 10, 10, 1f).scale, 0f)
    }

    @Test
    fun mapsLinks() {
        assertEquals("geo:2.040000,45.310000?q=2.040000,45.310000(Warehouse%20A)", MapsLinks.geoUri(2.04, 45.31, "Warehouse A"))
        assertEquals("geo:2.040000,45.310000?q=2.040000,45.310000", MapsLinks.geoUri(2.04, 45.31, null))
        assertEquals("google.navigation:q=2.040000,45.310000", MapsLinks.googleNavigationUri(2.04, 45.31))
        assertEquals("https://www.google.com/maps/dir/?api=1&destination=-1.500000,45.000000", MapsLinks.webDirectionsUrl(-1.5, 45.0))
        assertEquals("tel:+252615550101", MapsLinks.telUri("+252 61 555-0101"))
        assertNull(MapsLinks.telUri("  "))
    }
}
