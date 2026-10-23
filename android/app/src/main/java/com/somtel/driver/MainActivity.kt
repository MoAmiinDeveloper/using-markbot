package com.somtel.driver

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.somtel.driver.location.LocationService
import com.somtel.driver.ui.AppRoot
import com.somtel.driver.ui.theme.SomtelTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    /** Job to open (from a "New job assigned" notification). */
    private val pendingJobId = mutableStateOf<Long?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Light status-bar icons over the navy app bar in both themes.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        addOnNewIntentListener { handleIntent(it) }

        val container = appContainer
        if (container.sessionStore.current != null) {
            container.requestSync()
            container.appScope.launch { container.loadDriverMe() }
            if (container.settings.shareLocation) LocationService.start(this)
        }

        // Foreground polling of /driver/updates every 30 s while the app is visible.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    if (container.sessionStore.current != null) {
                        try {
                            val newJobs = container.repository.pollUpdates()
                            container.notifier.notifyNewJobs(newJobs)
                        } catch (_: Exception) {
                        }
                    }
                    delay(30_000)
                }
            }
        }

        setContent {
            SomtelTheme {
                AppRoot(
                    container = container,
                    pendingJobId = pendingJobId.value,
                    onPendingJobConsumed = { pendingJobId.value = null },
                )
            }
        }
    }

    private fun handleIntent(intent: Intent?) {
        val id = intent?.getLongExtra(EXTRA_JOB_ID, -1L) ?: -1L
        if (id > 0) pendingJobId.value = id
    }

    companion object {
        const val EXTRA_JOB_ID = "jobId"
    }
}
