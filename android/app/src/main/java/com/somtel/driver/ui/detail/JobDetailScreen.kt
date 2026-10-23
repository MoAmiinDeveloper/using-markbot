@file:OptIn(ExperimentalMaterial3Api::class)

package com.somtel.driver.ui.detail

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import coil.compose.AsyncImage
import com.somtel.driver.AppContainer
import com.somtel.driver.R
import com.somtel.driver.core.DriverAction
import com.somtel.driver.core.JobRules
import com.somtel.driver.core.MapsLinks
import com.somtel.driver.core.ServerUrl
import com.somtel.driver.core.TimeFormat
import com.somtel.driver.core.model.Attachment
import com.somtel.driver.core.model.AttachmentKind
import com.somtel.driver.core.model.ChecklistItem
import com.somtel.driver.core.model.Job
import com.somtel.driver.core.model.JobStatus
import com.somtel.driver.core.model.Stop
import com.somtel.driver.core.model.StopStatus
import com.somtel.driver.core.queue.PendingAction
import com.somtel.driver.ui.common.PendingSyncPill
import com.somtel.driver.ui.common.PriorityPill
import com.somtel.driver.ui.common.StatusPill
import com.somtel.driver.ui.common.errorMessage
import com.somtel.driver.ui.common.stopStatusLabel
import com.somtel.driver.ui.theme.SomtelColors
import com.somtel.driver.ui.theme.appBarColor
import com.somtel.driver.ui.theme.lateColor
import java.io.File
import java.time.Instant

@Composable
fun JobDetailScreen(container: AppContainer, jobId: Long, onBack: () -> Unit, onSignature: () -> Unit) {
    val vm: JobDetailViewModel = viewModel(
        key = "job-$jobId",
        factory = viewModelFactory { initializer { JobDetailViewModel(container, jobId) } },
    )
    val job by vm.job.collectAsStateWithLifecycle()
    val pending by vm.pendingActions.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val photoFailed by vm.photoFailed.collectAsStateWithLifecycle()
    val serverUrl = container.sessionStore.current?.serverUrl.orEmpty()

    val context = LocalContext.current
    var captureTarget by rememberSaveable { mutableStateOf<String?>(null) }
    var cameraMissing by remember { mutableStateOf(false) }
    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val path = captureTarget
        captureTarget = null
        if (path != null) {
            if (success) vm.onPhotoCaptured(path) else File(path).delete()
        }
    }
    val onTakePhoto: () -> Unit = {
        val file = vm.newCaptureFile()
        captureTarget = file.absolutePath
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        try {
            takePicture.launch(uri)
        } catch (_: ActivityNotFoundException) {
            captureTarget = null
            cameraMissing = true
        }
        Unit
    }

    var showProblemDialog by rememberSaveable { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(job?.reference ?: stringResource(R.string.job_title_fallback)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                actions = {
                    IconButton(onClick = vm::refresh, enabled = !refreshing) {
                        Icon(Icons.Filled.Refresh, contentDescription = stringResource(R.string.action_refresh))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = appBarColor(),
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                    actionIconContentColor = Color.White,
                ),
            )
        },
    ) { padding ->
        val current = job
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            if (refreshing) LinearProgressIndicator(Modifier.fillMaxWidth(), color = SomtelColors.Gold)
            if (current == null) {
                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text(
                        text = error?.let { errorMessage(it) } ?: stringResource(R.string.job_loading),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            } else {
                JobContent(
                    current = current,
                    pending = pending,
                    error = error,
                    photoFailed = photoFailed,
                    cameraMissing = cameraMissing,
                    serverUrl = serverUrl,
                    vm = vm,
                    onDismissError = {
                        cameraMissing = false
                        vm.dismissError()
                    },
                    onCall = { dial(context, current.customerPhone) },
                    onNavigate = { stop -> navigate(context, stop) },
                    onReportProblem = { showProblemDialog = true },
                    onTakePhoto = onTakePhoto,
                    onSignature = onSignature,
                )
            }
        }
    }

    if (showProblemDialog) {
        ReportProblemDialog(
            onDismiss = { showProblemDialog = false },
            onConfirm = { reason ->
                showProblemDialog = false
                vm.reportProblem(reason)
            },
        )
    }
}

@Composable
private fun JobContent(
    current: Job,
    pending: List<PendingAction>,
    error: Throwable?,
    photoFailed: Boolean,
    cameraMissing: Boolean,
    serverUrl: String,
    vm: JobDetailViewModel,
    onDismissError: () -> Unit,
    onCall: () -> Unit,
    onNavigate: (Stop) -> Unit,
    onReportProblem: () -> Unit,
    onTakePhoto: () -> Unit,
    onSignature: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val err = error
        if (err != null || photoFailed || cameraMissing) {
            item {
                val msg = when {
                    cameraMissing -> stringResource(R.string.error_no_camera)
                    photoFailed -> stringResource(R.string.error_photo_failed)
                    err != null -> errorMessage(err)
                    else -> ""
                }
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(msg, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                        TextButton(onClick = onDismissError) { Text(stringResource(R.string.action_dismiss)) }
                    }
                }
            }
        }
        item { HeaderCard(current, pending.size, onCall = onCall) }
        item {
            PrimaryActions(
                job = current,
                onAction = vm::perform,
                onReportProblem = onReportProblem,
            )
        }
        if (current.stops.isNotEmpty()) {
            item { SectionTitle(stringResource(R.string.section_stops)) }
            items(current.stops.sortedBy { it.seq }, key = { "stop-${it.id}" }) { stop ->
                StopCard(
                    stop = stop,
                    editable = JobRules.isActive(current.status),
                    onNavigate = { onNavigate(stop) },
                    onStatus = { status -> vm.updateStop(stop.id, status) },
                )
            }
        }
        if (current.checklist.isNotEmpty()) {
            item { SectionTitle(stringResource(R.string.section_checklist)) }
            item {
                ChecklistCard(
                    items = current.checklist,
                    editable = JobRules.isActive(current.status),
                    onToggle = vm::setChecklist,
                )
            }
        }
        item { SectionTitle(stringResource(R.string.section_notes)) }
        item {
            NotesCard(
                notes = current.notes,
                editable = JobRules.isActive(current.status),
                onAdd = vm::addNote,
            )
        }
        item { SectionTitle(stringResource(R.string.section_attachments)) }
        item {
            AttachmentsCard(
                serverUrl = serverUrl,
                attachments = current.attachments,
                pendingUploads = pending.filterIsInstance<PendingAction.Upload>(),
                editable = JobRules.isActive(current.status),
                onTakePhoto = onTakePhoto,
                onSignature = onSignature,
            )
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(top = 4.dp, start = 4.dp),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HeaderCard(job: Job, pendingCount: Int, onCall: () -> Unit) {
    val late = JobRules.isLate(job, Instant.now())
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusPill(job.status)
                PriorityPill(job.priority)
                PendingSyncPill(pendingCount)
            }
            Text(job.title.ifBlank { job.reference }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (job.description.isNotBlank()) {
                Text(job.description, style = MaterialTheme.typography.bodyMedium)
            }
            TimeFormat.display(job.scheduledStart)?.let {
                Text(stringResource(R.string.job_scheduled, it), style = MaterialTheme.typography.bodyMedium)
            }
            TimeFormat.display(job.dueBy)?.let { due ->
                Text(
                    text = if (late) stringResource(R.string.job_due_late, due) else stringResource(R.string.job_due, due),
                    color = if (late) lateColor() else MaterialTheme.colorScheme.onSurface,
                    fontWeight = if (late) FontWeight.Bold else FontWeight.Normal,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            if (job.customerName.isNotBlank() || job.customerPhone.isNotBlank()) {
                HorizontalDivider()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        if (job.customerName.isNotBlank()) {
                            Text(stringResource(R.string.job_customer, job.customerName), style = MaterialTheme.typography.bodyLarge)
                        }
                        if (job.customerPhone.isNotBlank()) {
                            Text(job.customerPhone, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    if (MapsLinks.telUri(job.customerPhone) != null) {
                        OutlinedButton(onClick = onCall) {
                            Icon(Icons.Filled.Call, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.action_call_customer))
                        }
                    }
                }
            }
            if (job.status == JobStatus.FAILED && job.failureReason.isNotBlank()) {
                Text(
                    stringResource(R.string.job_failure_reason, job.failureReason),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun actionLabel(action: DriverAction): String = when (action) {
    DriverAction.ACCEPT -> stringResource(R.string.action_accept)
    DriverAction.START_TRIP -> stringResource(R.string.action_start_trip)
    DriverAction.ARRIVED -> stringResource(R.string.action_arrived)
    DriverAction.START_WORK -> stringResource(R.string.action_start_work)
    DriverAction.COMPLETE -> stringResource(R.string.action_complete)
}

@Composable
private fun PrimaryActions(job: Job, onAction: (DriverAction) -> Unit, onReportProblem: () -> Unit) {
    val next = JobRules.nextAction(job.status)
    if (next == null && !JobRules.canReportProblem(job.status)) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (next != null) {
            val allowed = JobRules.canPerform(job, next)
            Button(
                onClick = { onAction(next) },
                enabled = allowed,
                colors = ButtonDefaults.buttonColors(containerColor = SomtelColors.Gold, contentColor = SomtelColors.Navy),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(60.dp),
            ) {
                Text(actionLabel(next), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            if (!allowed) {
                Text(
                    stringResource(R.string.complete_blocked, JobRules.missingRequired(job).size),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        if (JobRules.canReportProblem(job.status)) {
            OutlinedButton(onClick = onReportProblem, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Warning, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.action_report_problem))
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StopCard(stop: Stop, editable: Boolean, onNavigate: () -> Unit, onStatus: (String) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(RoundedCornerShape(50))
                        .background(if (stop.status == StopStatus.PENDING) SomtelColors.Navy else SomtelColors.Gold),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        stop.seq.toString(),
                        color = if (stop.status == StopStatus.PENDING) Color.White else SomtelColors.Navy,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(stop.name.ifBlank { stringResource(R.string.stop_fallback_name, stop.seq) }, fontWeight = FontWeight.SemiBold)
                    if (stop.address.isNotBlank()) Text(stop.address, style = MaterialTheme.typography.bodySmall)
                }
                Text(stopStatusLabel(stop.status), style = MaterialTheme.typography.labelMedium)
            }
            if (stop.notes.isNotBlank()) Text(stop.notes, style = MaterialTheme.typography.bodySmall)
            val actions = if (editable) JobRules.stopActions(stop.status) else emptyList()
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (stop.lat != null && stop.lng != null) {
                    OutlinedButton(onClick = onNavigate) {
                        Icon(Icons.Filled.Place, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.action_navigate))
                    }
                }
                for (status in actions) {
                    val label = when (status) {
                        StopStatus.ARRIVED -> stringResource(R.string.action_stop_arrived)
                        StopStatus.COMPLETED -> stringResource(R.string.action_stop_completed)
                        else -> stringResource(R.string.action_stop_skip)
                    }
                    if (status == StopStatus.SKIPPED) {
                        TextButton(onClick = { onStatus(status) }) { Text(label) }
                    } else {
                        Button(
                            onClick = { onStatus(status) },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.secondary,
                                contentColor = MaterialTheme.colorScheme.onSecondary,
                            ),
                        ) { Text(label) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChecklistCard(items: List<ChecklistItem>, editable: Boolean, onToggle: (Long, Boolean) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(vertical = 4.dp)) {
            for (item in items) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(horizontal = 4.dp),
                ) {
                    Checkbox(
                        checked = item.done,
                        onCheckedChange = if (editable) ({ checked -> onToggle(item.id, checked) }) else null,
                    )
                    Text(item.text, modifier = Modifier.weight(1f))
                    if (item.required) {
                        Text(
                            stringResource(R.string.checklist_required),
                            color = if (item.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(end = 12.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NotesCard(notes: String, editable: Boolean, onAdd: (String) -> Unit) {
    var draft by rememberSaveable { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = notes.ifBlank { stringResource(R.string.notes_empty) },
                style = MaterialTheme.typography.bodyMedium,
                color = if (notes.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            if (editable) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    label = { Text(stringResource(R.string.notes_add_hint)) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
                Button(
                    onClick = {
                        onAdd(draft)
                        draft = ""
                    },
                    enabled = draft.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = SomtelColors.Gold, contentColor = SomtelColors.Navy),
                ) { Text(stringResource(R.string.notes_add)) }
            }
        }
    }
}

@Composable
private fun AttachmentsCard(
    serverUrl: String,
    attachments: List<Attachment>,
    pendingUploads: List<PendingAction.Upload>,
    editable: Boolean,
    onTakePhoto: () -> Unit,
    onSignature: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (editable) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = onTakePhoto,
                        colors = ButtonDefaults.buttonColors(containerColor = SomtelColors.Gold, contentColor = SomtelColors.Navy),
                    ) {
                        Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.action_take_photo))
                    }
                    OutlinedButton(onClick = onSignature) {
                        Icon(Icons.Filled.Create, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.action_signature))
                    }
                }
            }
            if (attachments.isEmpty() && pendingUploads.isEmpty()) {
                Text(
                    stringResource(R.string.attachments_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(pendingUploads, key = { "p-${it.id}" }) { upload ->
                        Thumbnail(
                            model = File(upload.filePath),
                            label = stringResource(R.string.attachment_pending),
                            pending = true,
                        )
                    }
                    items(attachments, key = { "a-${it.id}" }) { att ->
                        val isImage = att.kind == AttachmentKind.PHOTO || att.kind == AttachmentKind.SIGNATURE ||
                            att.name.lowercase().let { it.endsWith(".jpg") || it.endsWith(".jpeg") || it.endsWith(".png") || it.endsWith(".webp") }
                        Thumbnail(
                            model = if (isImage && serverUrl.isNotBlank()) ServerUrl.resolve(serverUrl, att.url) else null,
                            label = attachmentLabel(att),
                            pending = false,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun attachmentLabel(att: Attachment): String = when (att.kind) {
    AttachmentKind.PHOTO -> stringResource(R.string.attachment_photo)
    AttachmentKind.SIGNATURE -> stringResource(R.string.attachment_signature)
    else -> att.name.ifBlank { stringResource(R.string.attachment_document) }
}

@Composable
private fun Thumbnail(model: Any?, label: String, pending: Boolean) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(104.dp)) {
        Box(
            modifier = Modifier
                .size(104.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            if (model != null) {
                AsyncImage(
                    model = model,
                    contentDescription = label,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Text(label, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(6.dp))
            }
            if (pending) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(SomtelColors.Gold),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(stringResource(R.string.pending_sync), color = SomtelColors.Navy, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1)
    }
}

@Composable
private fun ReportProblemDialog(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var reason by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.problem_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.problem_message))
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text(stringResource(R.string.problem_reason)) },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(reason) }, enabled = reason.isNotBlank()) {
                Text(stringResource(R.string.problem_confirm), color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}

private fun dial(context: Context, phone: String) {
    val tel = MapsLinks.telUri(phone) ?: return
    try {
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(tel)))
    } catch (_: ActivityNotFoundException) {
    }
}

private fun navigate(context: Context, stop: Stop) {
    val lat = stop.lat ?: return
    val lng = stop.lng ?: return
    val candidates = listOf(
        MapsLinks.geoUri(lat, lng, stop.name),
        MapsLinks.webDirectionsUrl(lat, lng),
    )
    for (uri in candidates) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
            return
        } catch (_: ActivityNotFoundException) {
        }
    }
}
