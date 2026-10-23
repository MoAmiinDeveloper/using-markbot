package com.somtel.driver.ui.detail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.somtel.driver.AppContainer
import com.somtel.driver.core.DriverAction
import com.somtel.driver.core.JobRules
import com.somtel.driver.core.model.AttachmentKind
import com.somtel.driver.core.model.Job
import com.somtel.driver.core.model.JobStatus
import com.somtel.driver.core.queue.PendingAction
import com.somtel.driver.media.MediaFiles
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

class JobDetailViewModel(private val container: AppContainer, val jobId: Long) : ViewModel() {
    private val repo = container.repository

    val job: StateFlow<Job?> = repo.jobs
        .map { list -> list.firstOrNull { it.id == jobId } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), repo.job(jobId))

    val pendingActions: StateFlow<List<PendingAction>> = repo.pendingActions
        .map { list -> list.filter { it.jobId == jobId } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val refreshingState = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = refreshingState.asStateFlow()

    private val errorState = MutableStateFlow<Throwable?>(null)
    val error: StateFlow<Throwable?> = errorState.asStateFlow()

    private val photoFailedState = MutableStateFlow(false)
    val photoFailed: StateFlow<Boolean> = photoFailedState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        if (refreshingState.value) return
        refreshingState.value = true
        viewModelScope.launch {
            try {
                container.runSync()
                repo.refreshJob(jobId)
                errorState.value = null
            } catch (e: Exception) {
                errorState.value = e
            } finally {
                refreshingState.value = false
            }
        }
    }

    fun dismissError() {
        errorState.value = null
        photoFailedState.value = false
    }

    fun perform(action: DriverAction) {
        val current = job.value ?: return
        if (!JobRules.canPerform(current, action)) return
        repo.changeStatus(jobId, action.targetStatus)
    }

    fun reportProblem(reason: String) {
        repo.changeStatus(jobId, JobStatus.FAILED, reason.trim())
    }

    fun updateStop(stopId: Long, status: String) = repo.updateStop(jobId, stopId, status)

    fun setChecklist(itemId: Long, done: Boolean) = repo.setChecklist(jobId, itemId, done)

    fun addNote(text: String) = repo.addNote(jobId, text)

    /** A fresh file for the camera to write into (exposed through FileProvider). */
    fun newCaptureFile(): File = File(container.captureDir, "capture_${System.currentTimeMillis()}.jpg")

    /** Downscale the captured photo (≤ 1600 px, JPEG 80 %) and queue it for upload. */
    fun onPhotoCaptured(path: String) {
        viewModelScope.launch {
            val dest = File(container.uploadsDir, "photo_${UUID.randomUUID()}.jpg")
            val ok = withContext(Dispatchers.IO) {
                val source = File(path)
                val result = try {
                    MediaFiles.downscaleJpeg(source, dest)
                } catch (_: Throwable) {
                    false
                }
                source.delete()
                result
            }
            if (ok) {
                repo.addUpload(jobId, dest, AttachmentKind.PHOTO, "image/jpeg")
            } else {
                dest.delete()
                photoFailedState.value = true
            }
        }
    }
}
