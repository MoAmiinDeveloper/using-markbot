package com.somtel.driver.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.somtel.driver.R
import com.somtel.driver.appContainer
import com.somtel.driver.core.TimeFormat
import com.somtel.driver.core.model.LocationRequest
import com.somtel.driver.notify.Notifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Foreground service (type "location") that shares the phone's GPS position with the server every
 * 15 s while the driver has a job in progress. Uses the platform LocationManager (no Play Services).
 */
class LocationService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var loop: Job? = null
    private var locationManager: LocationManager? = null

    @Volatile
    private var lastLocation: Location? = null

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            lastLocation = location
        }

        override fun onProviderEnabled(provider: String) {}

        override fun onProviderDisabled(provider: String) {}

        // Must be implemented for Android 8–10, where this method is still abstract.
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            ServiceCompat.startForeground(
                this,
                Notifier.NOTIFICATION_LOCATION,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } catch (e: Exception) {
            Log.w(TAG, "Cannot start location foreground service", e)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!hasLocationPermission(this) || applicationContext.appContainer.sessionStore.current == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        startLocationUpdates()
        if (loop?.isActive != true) loop = scope.launch { sendLoop() }
        return START_STICKY
    }

    private fun buildNotification(): Notification {
        val container = applicationContext.appContainer
        return NotificationCompat.Builder(this, Notifier.CHANNEL_LOCATION)
            .setSmallIcon(R.drawable.ic_stat_somtel)
            .setContentTitle(getString(R.string.location_notification_title))
            .setContentText(getString(R.string.location_notification_text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(container.notifier.openJobIntent(null))
            .build()
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        if (locationManager != null) return
        val lm = getSystemService(LocationManager::class.java) ?: return
        locationManager = lm
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        for (provider in providers) {
            try {
                if (lm.isProviderEnabled(provider)) {
                    lm.requestLocationUpdates(provider, UPDATE_INTERVAL_MS, 0f, listener, Looper.getMainLooper())
                    val last = lm.getLastKnownLocation(provider)
                    if (last != null && (lastLocation == null || last.time > (lastLocation?.time ?: 0L))) lastLocation = last
                }
            } catch (e: Exception) {
                Log.w(TAG, "Provider $provider unavailable", e)
            }
        }
    }

    private suspend fun sendLoop() {
        val container = applicationContext.appContainer
        while (scope.isActive) {
            delay(UPDATE_INTERVAL_MS)
            val loc = lastLocation ?: continue
            if (container.sessionStore.current == null) {
                stopSelf()
                return
            }
            if (!container.repository.hasJobInProgress()) continue
            val body = LocationRequest(
                lat = loc.latitude,
                lng = loc.longitude,
                speed = if (loc.hasSpeed()) loc.speed * 3.6 else null, // m/s → km/h like tracker positions
                course = if (loc.hasBearing()) loc.bearing.toDouble() else null,
                accuracy = if (loc.hasAccuracy()) loc.accuracy.toDouble() else null,
                time = TimeFormat.format(Instant.ofEpochMilli(loc.time)),
            )
            try {
                container.api.postLocation(body)
            } catch (e: Exception) {
                Log.d(TAG, "Location upload failed: ${e.message}")
            }
        }
    }

    override fun onDestroy() {
        try {
            locationManager?.removeUpdates(listener)
        } catch (_: Exception) {
        }
        locationManager = null
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "LocationService"
        private const val UPDATE_INTERVAL_MS = 15_000L

        fun hasLocationPermission(context: Context): Boolean =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

        fun start(context: Context) {
            if (!hasLocationPermission(context)) return
            try {
                ContextCompat.startForegroundService(context, Intent(context, LocationService::class.java))
            } catch (e: Exception) {
                Log.w(TAG, "Cannot start location service", e)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationService::class.java))
        }
    }
}
