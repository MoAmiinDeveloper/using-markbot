package com.somtel.driver.core

import kotlin.math.max
import kotlin.math.min

data class Pt(val x: Float, val y: Float)

/** Immutable signature pad model: a list of strokes, each a list of points. */
data class SignaturePad(val strokes: List<List<Pt>> = emptyList()) {
    val isEmpty: Boolean get() = strokes.none { it.isNotEmpty() }

    fun startStroke(p: Pt): SignaturePad = copy(strokes = strokes + listOf(listOf(p)))

    fun extend(p: Pt): SignaturePad {
        if (strokes.isEmpty()) return startStroke(p)
        return copy(strokes = strokes.dropLast(1) + listOf(strokes.last() + p))
    }

    fun undo(): SignaturePad = if (strokes.isEmpty()) this else copy(strokes = strokes.dropLast(1))

    fun clear(): SignaturePad = SignaturePad()
}

/** Uniform scale + offset mapping drawing coordinates into an output bitmap. */
data class FitTransform(val scale: Float, val dx: Float, val dy: Float) {
    fun map(p: Pt): Pt = Pt(p.x * scale + dx, p.y * scale + dy)
}

object SignatureGeometry {
    data class Bounds(val minX: Float, val minY: Float, val maxX: Float, val maxY: Float) {
        val width: Float get() = maxX - minX
        val height: Float get() = maxY - minY
    }

    fun bounds(strokes: List<List<Pt>>): Bounds? {
        val pts = strokes.flatten()
        if (pts.isEmpty()) return null
        var minX = Float.MAX_VALUE
        var minY = Float.MAX_VALUE
        var maxX = -Float.MAX_VALUE
        var maxY = -Float.MAX_VALUE
        for (p in pts) {
            minX = min(minX, p.x); minY = min(minY, p.y)
            maxX = max(maxX, p.x); maxY = max(maxY, p.y)
        }
        return Bounds(minX, minY, maxX, maxY)
    }

    /**
     * Fits the strokes' bounding box into [outW]x[outH] minus [padding] on each side, centred, without
     * distorting (uniform scale). Never upscales more than [maxScale] so a tiny scribble stays small-ish.
     */
    fun fit(strokes: List<List<Pt>>, outW: Int, outH: Int, padding: Float, maxScale: Float = 4f): FitTransform {
        val b = bounds(strokes) ?: return FitTransform(1f, 0f, 0f)
        val availW = max(1f, outW - 2 * padding)
        val availH = max(1f, outH - 2 * padding)
        val sx = if (b.width > 0f) availW / b.width else maxScale
        val sy = if (b.height > 0f) availH / b.height else maxScale
        val scale = min(min(sx, sy), maxScale)
        val dx = (outW - b.width * scale) / 2f - b.minX * scale
        val dy = (outH - b.height * scale) / 2f - b.minY * scale
        return FitTransform(scale, dx, dy)
    }
}
