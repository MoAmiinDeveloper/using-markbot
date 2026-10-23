@file:OptIn(ExperimentalMaterial3Api::class)

package com.somtel.driver.ui.jobs

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.somtel.driver.AppContainer
import com.somtel.driver.R
import com.somtel.driver.core.JobRules
import com.somtel.driver.core.TimeFormat
import com.somtel.driver.core.model.Job
import com.somtel.driver.ui.common.PendingSyncPill
import com.somtel.driver.ui.common.PriorityPill
import com.somtel.driver.ui.common.StatusPill
import com.somtel.driver.ui.common.errorMessage
import com.somtel.driver.ui.theme.SomtelColors
import com.somtel.driver.ui.theme.appBarColor
import com.somtel.driver.ui.theme.lateColor
import java.time.Instant

@Composable
fun JobsScreen(container: AppContainer, onOpenJob: (Long) -> Unit, onOpenProfile: () -> Unit) {
    val vm: JobsViewModel = viewModel(factory = viewModelFactory { initializer { JobsViewModel(container) } })
    val state by vm.uiState.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val syncProblem by vm.syncProblem.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }

    RequestNotificationPermissionOnce(container)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.jobs_title), fontWeight = FontWeight.SemiBold) },
                actions = {
                    IconButton(onClick = onOpenProfile) {
                        Icon(Icons.Filled.Person, contentDescription = stringResource(R.string.profile_title))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = appBarColor(),
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            TabRow(
                selectedTabIndex = tab,
                containerColor = appBarColor(),
                contentColor = SomtelColors.Gold,
            ) {
                Tab(
                    selected = tab == 0,
                    onClick = { tab = 0 },
                    text = { Text(stringResource(R.string.jobs_tab_active, state.active.size)) },
                    selectedContentColor = SomtelColors.Gold,
                    unselectedContentColor = Color.White,
                )
                Tab(
                    selected = tab == 1,
                    onClick = { tab = 1 },
                    text = { Text(stringResource(R.string.jobs_tab_history)) },
                    selectedContentColor = SomtelColors.Gold,
                    unselectedContentColor = Color.White,
                )
            }

            if (state.totalPending > 0) {
                Banner(
                    text = stringResource(R.string.pending_sync_banner, state.totalPending),
                    background = MaterialTheme.colorScheme.primaryContainer,
                    content = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
            syncProblem?.let { problem ->
                Banner(
                    text = stringResource(R.string.sync_rejected, problem),
                    background = MaterialTheme.colorScheme.errorContainer,
                    content = MaterialTheme.colorScheme.onErrorContainer,
                    action = stringResource(R.string.action_dismiss),
                    onAction = vm::dismissSyncProblem,
                )
            }
            error?.let { e ->
                Banner(
                    text = stringResource(R.string.jobs_refresh_failed, errorMessage(e)),
                    background = MaterialTheme.colorScheme.errorContainer,
                    content = MaterialTheme.colorScheme.onErrorContainer,
                    action = stringResource(R.string.action_dismiss),
                    onAction = vm::dismissError,
                )
            }

            val list = if (tab == 0) state.active else state.history
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = vm::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (list.isEmpty()) {
                        item {
                            Text(
                                text = stringResource(if (tab == 0) R.string.jobs_empty_active else R.string.jobs_empty_history),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 48.dp, start = 16.dp, end = 16.dp),
                            )
                        }
                    }
                    items(list, key = { it.id }) { job ->
                        JobCard(job = job, pending = state.pendingByJob[job.id] ?: 0, onClick = { onOpenJob(job.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun Banner(
    text: String,
    background: Color,
    content: Color,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    Surface(color = background, contentColor = content, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            if (action != null) {
                TextButton(onClick = onAction) { Text(action, color = content) }
            }
        }
    }
}

@Composable
private fun JobCard(job: Job, pending: Int, onClick: () -> Unit) {
    val late = JobRules.isLate(job, Instant.now())
    val (done, total) = JobRules.stopProgress(job)
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = job.reference,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                PriorityPill(job.priority)
                Spacer(Modifier.width(6.dp))
                StatusPill(job.status)
            }
            Text(
                text = job.title.ifBlank { job.reference },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (job.customerName.isNotBlank()) {
                Text(
                    text = stringResource(R.string.job_customer, job.customerName),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            TimeFormat.display(job.dueBy)?.let { due ->
                Text(
                    text = if (late) stringResource(R.string.job_due_late, due) else stringResource(R.string.job_due, due),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (late) lateColor() else MaterialTheme.colorScheme.onSurface,
                    fontWeight = if (late) FontWeight.Bold else FontWeight.Normal,
                )
            }
            if (total > 0) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LinearProgressIndicator(
                        progress = { done.toFloat() / total },
                        modifier = Modifier.weight(1f),
                        color = SomtelColors.Gold,
                        trackColor = MaterialTheme.colorScheme.surfaceVariant,
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        text = stringResource(R.string.job_stops_progress, done, total),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            if (pending > 0) PendingSyncPill(pending)
        }
    }
}

@Composable
private fun RequestNotificationPermissionOnce(container: AppContainer) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted && !container.settings.notificationPermissionAsked) {
            container.settings.notificationPermissionAsked = true
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
