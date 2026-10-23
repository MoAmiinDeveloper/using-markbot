package com.somtel.driver.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.somtel.driver.R
import com.somtel.driver.core.ApiErrors
import com.somtel.driver.core.ApiException
import com.somtel.driver.core.ErrorKind
import com.somtel.driver.core.SyncProblem
import com.somtel.driver.core.model.JobPriority
import com.somtel.driver.core.model.JobStatus
import com.somtel.driver.core.model.StopStatus
import com.somtel.driver.ui.theme.SomtelColors

@Composable
fun Pill(text: String, background: Color, content: Color, modifier: Modifier = Modifier) {
    Text(
        text = text,
        color = content,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(background)
            .padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

@Composable
fun jobStatusLabel(status: String): String = when (status) {
    JobStatus.UNASSIGNED -> stringResource(R.string.status_unassigned)
    JobStatus.ASSIGNED -> stringResource(R.string.status_assigned)
    JobStatus.ACCEPTED -> stringResource(R.string.status_accepted)
    JobStatus.EN_ROUTE -> stringResource(R.string.status_en_route)
    JobStatus.ARRIVED -> stringResource(R.string.status_arrived)
    JobStatus.IN_PROGRESS -> stringResource(R.string.status_in_progress)
    JobStatus.COMPLETED -> stringResource(R.string.status_completed)
    JobStatus.FAILED -> stringResource(R.string.status_failed)
    JobStatus.CANCELLED -> stringResource(R.string.status_cancelled)
    else -> status
}

@Composable
fun StatusPill(status: String, modifier: Modifier = Modifier) {
    val (bg, fg) = when (status) {
        JobStatus.COMPLETED -> SomtelColors.Green to Color.White
        JobStatus.FAILED, JobStatus.CANCELLED -> SomtelColors.Red to Color.White
        JobStatus.ASSIGNED, JobStatus.UNASSIGNED -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
        else -> SomtelColors.Navy to Color.White
    }
    Pill(jobStatusLabel(status), bg, fg, modifier)
}

@Composable
fun PriorityPill(priority: String, modifier: Modifier = Modifier) {
    when (priority) {
        JobPriority.URGENT -> Pill(stringResource(R.string.priority_urgent), SomtelColors.Red, Color.White, modifier)
        JobPriority.HIGH -> Pill(stringResource(R.string.priority_high), SomtelColors.Orange, Color.White, modifier)
        else -> Pill(
            stringResource(R.string.priority_normal),
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
            modifier,
        )
    }
}

@Composable
fun PendingSyncPill(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    Pill(stringResource(R.string.pending_sync_count, count), SomtelColors.Gold, SomtelColors.Navy, modifier)
}

@Composable
fun stopStatusLabel(status: String): String = when (status) {
    StopStatus.PENDING -> stringResource(R.string.stop_pending)
    StopStatus.ARRIVED -> stringResource(R.string.stop_arrived)
    StopStatus.COMPLETED -> stringResource(R.string.stop_completed)
    StopStatus.SKIPPED -> stringResource(R.string.stop_skipped)
    else -> status
}

/** Friendly text for a change the server rejected (uploads get specific 413 / 415 messages). */
@Composable
fun syncProblemText(problem: SyncProblem): String = when {
    problem.upload && problem.kind == ErrorKind.TOO_LARGE -> stringResource(R.string.error_upload_too_large)
    problem.upload && problem.kind == ErrorKind.UNSUPPORTED_TYPE -> stringResource(R.string.error_upload_type)
    problem.upload -> stringResource(R.string.error_upload_rejected, problem.message)
    else -> stringResource(R.string.sync_rejected, problem.message)
}

/** User-facing text for an error: the server's `{"error"}` message when present, else a generic one. */
@Composable
fun errorMessage(t: Throwable): String {
    val serverMessage = (t as? ApiException)?.serverMessage
    if (!serverMessage.isNullOrBlank()) return serverMessage
    return when (ApiErrors.kindOf(t)) {
        ErrorKind.NETWORK -> stringResource(R.string.error_network)
        ErrorKind.UNAUTHORIZED -> stringResource(R.string.error_unauthorized)
        ErrorKind.FORBIDDEN -> stringResource(R.string.error_forbidden)
        ErrorKind.NOT_FOUND -> stringResource(R.string.error_not_found)
        ErrorKind.CONFLICT -> stringResource(R.string.error_conflict)
        ErrorKind.VALIDATION -> stringResource(R.string.error_validation)
        ErrorKind.TOO_LARGE -> stringResource(R.string.error_too_large)
        ErrorKind.UNSUPPORTED_TYPE -> stringResource(R.string.error_unsupported_type)
        ErrorKind.SERVER -> stringResource(R.string.error_server)
        ErrorKind.UNKNOWN -> stringResource(R.string.error_unknown)
    }
}
