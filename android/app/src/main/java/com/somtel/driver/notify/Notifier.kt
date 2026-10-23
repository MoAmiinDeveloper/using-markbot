package com.somtel.driver.notify

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.somtel.driver.MainActivity
import com.somtel.driver.R
import com.somtel.driver.core.model.Job

class Notifier(private val context: Context) {
    fun createChannels() {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val jobs = NotificationChannel(CHANNEL_JOBS, context.getString(R.string.channel_jobs), NotificationManager.IMPORTANCE_HIGH)
        jobs.description = context.getString(R.string.channel_jobs_description)
        val location = NotificationChannel(
            CHANNEL_LOCATION,
            context.getString(R.string.channel_location),
            NotificationManager.IMPORTANCE_LOW,
        )
        location.description = context.getString(R.string.channel_location_description)
        nm.createNotificationChannel(jobs)
        nm.createNotificationChannel(location)
    }

    fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun openJobIntent(jobId: Long?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (jobId != null) putExtra(MainActivity.EXTRA_JOB_ID, jobId)
        }
        return PendingIntent.getActivity(
            context,
            (jobId ?: 0L).toInt(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    @SuppressLint("MissingPermission")
    fun notifyNewJobs(jobs: List<Job>) {
        if (jobs.isEmpty() || !canPost()) return
        val manager = NotificationManagerCompat.from(context)
        for (job in jobs) {
            val title = context.getString(R.string.notification_new_job_title, job.title.ifBlank { job.reference })
            val text = listOf(job.reference, job.customerName).filter { it.isNotBlank() }.joinToString(" · ")
            val notification = NotificationCompat.Builder(context, CHANNEL_JOBS)
                .setSmallIcon(R.drawable.ic_stat_somtel)
                .setContentTitle(title)
                .setContentText(text)
                .setColor(ContextCompat.getColor(context, R.color.somtel_navy))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(openJobIntent(job.id))
                .build()
            try {
                manager.notify(NOTIFICATION_JOB_BASE + (job.id % 100_000).toInt(), notification)
            } catch (_: SecurityException) {
            }
        }
    }

    fun cancelAll() {
        NotificationManagerCompat.from(context).cancelAll()
    }

    companion object {
        const val CHANNEL_JOBS = "jobs"
        const val CHANNEL_LOCATION = "location"
        const val NOTIFICATION_LOCATION = 1
        private const val NOTIFICATION_JOB_BASE = 1000
    }
}
