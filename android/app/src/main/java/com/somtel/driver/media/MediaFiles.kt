package com.somtel.driver.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.media.ExifInterface
import com.somtel.driver.core.ImageScaling
import com.somtel.driver.core.SignatureGeometry
import com.somtel.driver.core.SignaturePad
import java.io.File
import java.io.FileOutputStream

/** Bitmap work for uploads. Runs on a background thread. */
object MediaFiles {
    /** Decodes [source], downsizes to ≤ [maxDim] px, applies EXIF rotation and writes a JPEG to [dest]. */
    fun downscaleJpeg(
        source: File,
        dest: File,
        maxDim: Int = ImageScaling.MAX_DIMENSION,
        quality: Int = ImageScaling.JPEG_QUALITY,
    ): Boolean {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return false

        val options = BitmapFactory.Options().apply {
            inSampleSize = ImageScaling.inSampleSize(bounds.outWidth, bounds.outHeight, maxDim)
        }
        val decoded = BitmapFactory.decodeFile(source.absolutePath, options) ?: return false
        val (tw, th) = ImageScaling.fitWithin(decoded.width, decoded.height, maxDim)
        var bitmap = if (tw != decoded.width || th != decoded.height) {
            Bitmap.createScaledBitmap(decoded, tw, th, true).also { if (it != decoded) decoded.recycle() }
        } else {
            decoded
        }

        val orientation = try {
            ExifInterface(source.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        val rotation = ImageScaling.rotationForExif(orientation)
        if (rotation != 0) {
            val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
            val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            if (rotated != bitmap) bitmap.recycle()
            bitmap = rotated
        }

        dest.parentFile?.mkdirs()
        FileOutputStream(dest).use { out -> bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out) }
        bitmap.recycle()
        return true
    }

    /** Renders the signature strokes, centred and scaled, as black ink on white into a PNG. */
    fun renderSignaturePng(pad: SignaturePad, dest: File, width: Int = 1000, height: Int = 400) {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)
        val transform = SignatureGeometry.fit(pad.strokes, width, height, padding = 24f)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            style = Paint.Style.STROKE
            strokeWidth = 6f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        for (stroke in pad.strokes) {
            if (stroke.isEmpty()) continue
            val first = transform.map(stroke.first())
            if (stroke.size == 1) {
                canvas.drawPoint(first.x, first.y, paint)
                continue
            }
            val path = Path()
            path.moveTo(first.x, first.y)
            for (i in 1 until stroke.size) {
                val p = transform.map(stroke[i])
                path.lineTo(p.x, p.y)
            }
            canvas.drawPath(path, paint)
        }
        dest.parentFile?.mkdirs()
        FileOutputStream(dest).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
        bitmap.recycle()
    }
}
