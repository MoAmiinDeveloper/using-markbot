package com.somtel.driver.core

import kotlin.math.max
import kotlin.math.roundToInt

/** Pure maths for downscaling camera photos before upload. */
object ImageScaling {
    const val MAX_DIMENSION = 1600
    const val JPEG_QUALITY = 80

    /** Largest power-of-two sample size that still decodes to at least [maxDim] on the longest side. */
    fun inSampleSize(width: Int, height: Int, maxDim: Int = MAX_DIMENSION): Int {
        if (width <= 0 || height <= 0) return 1
        var sample = 1
        val longest = max(width, height)
        while (longest / (sample * 2) >= maxDim) sample *= 2
        return sample
    }

    /** Target size so that the longest side is at most [maxDim], keeping aspect ratio. */
    fun fitWithin(width: Int, height: Int, maxDim: Int = MAX_DIMENSION): Pair<Int, Int> {
        if (width <= 0 || height <= 0) return width to height
        val longest = max(width, height)
        if (longest <= maxDim) return width to height
        val scale = maxDim.toDouble() / longest
        return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
    }

    /** Degrees to rotate for an EXIF orientation value (1, 3, 6, 8; mirrored variants approximated). */
    fun rotationForExif(orientation: Int): Int = when (orientation) {
        3, 4 -> 180
        6, 5 -> 90
        8, 7 -> 270
        else -> 0
    }
}
