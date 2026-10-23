@file:OptIn(ExperimentalMaterial3Api::class)

package com.somtel.driver.ui.profile

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.somtel.driver.AppContainer
import com.somtel.driver.BuildConfig
import com.somtel.driver.R
import com.somtel.driver.location.LocationService
import com.somtel.driver.ui.theme.SomtelColors
import com.somtel.driver.ui.theme.appBarColor

@Composable
fun ProfileScreen(container: AppContainer, onBack: () -> Unit) {
    val context = LocalContext.current
    val session by container.sessionStore.session.collectAsStateWithLifecycle()
    val driverMe by container.driverMe.collectAsStateWithLifecycle()
    val shareLocation by container.settings.shareLocationFlow.collectAsStateWithLifecycle()
    val pending by container.repository.pendingActions.collectAsStateWithLifecycle()
    var permissionDenied by remember { mutableStateOf(false) }
    var confirmLogout by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { container.loadDriverMe() }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result.values.any { it }) {
            permissionDenied = false
            container.settings.shareLocation = true
            LocationService.start(context)
        } else {
            permissionDenied = true
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.profile_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = appBarColor(),
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                ),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    val user = session?.user
                    Text(user?.name?.ifBlank { null } ?: user?.email.orEmpty(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(user?.email.orEmpty(), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(R.string.profile_role, user?.role.orEmpty()), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(R.string.profile_server, session?.serverUrl.orEmpty()), style = MaterialTheme.typography.bodyMedium)
                    val vehicle = driverMe?.vehicle?.name
                    Text(
                        if (vehicle.isNullOrBlank()) stringResource(R.string.profile_no_vehicle) else stringResource(R.string.profile_vehicle, vehicle),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            stringResource(R.string.location_share),
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f),
                        )
                        Switch(
                            checked = shareLocation,
                            onCheckedChange = { on ->
                                if (on) {
                                    if (LocationService.hasLocationPermission(context)) {
                                        container.settings.shareLocation = true
                                        LocationService.start(context)
                                    } else {
                                        permissionLauncher.launch(
                                            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                                        )
                                    }
                                } else {
                                    container.settings.shareLocation = false
                                    LocationService.stop(context)
                                }
                            },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = SomtelColors.Navy,
                                checkedTrackColor = SomtelColors.Gold,
                            ),
                        )
                    }
                    Text(stringResource(R.string.location_explanation), style = MaterialTheme.typography.bodySmall)
                    if (permissionDenied) {
                        Text(stringResource(R.string.location_permission_denied), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = { confirmLogout = true }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.action_logout), color = MaterialTheme.colorScheme.error)
            }
            Row {
                Spacer(Modifier.width(4.dp))
                Text(
                    stringResource(R.string.profile_version, BuildConfig.VERSION_NAME),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text(stringResource(R.string.logout_title)) },
            text = {
                Text(
                    if (pending.isEmpty()) stringResource(R.string.logout_message)
                    else stringResource(R.string.logout_message_pending, pending.size),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    container.logout()
                }) { Text(stringResource(R.string.action_logout), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmLogout = false }) { Text(stringResource(R.string.action_cancel)) }
            },
        )
    }
}
