package com.somtel.driver.core.net

import com.somtel.driver.core.model.Job
import com.somtel.driver.core.model.StatusRequest
import com.somtel.driver.core.model.StopUpdateRequest
import com.somtel.driver.core.queue.ActionExecutor
import com.somtel.driver.core.queue.PendingAction
import java.io.File

/** Maps queued actions to driver API calls. */
class ApiActionExecutor(private val api: ApiClient) : ActionExecutor {
    override suspend fun execute(action: PendingAction): Job? = when (action) {
        is PendingAction.StatusChange ->
            api.postStatus(action.jobId, StatusRequest(action.status, action.reason, action.lat, action.lng))
        is PendingAction.StopUpdate ->
            api.postStop(action.jobId, action.stopId, StopUpdateRequest(action.status, action.notes, action.lat, action.lng))
        is PendingAction.ChecklistTick -> api.postChecklist(action.jobId, action.itemId, action.done)
        is PendingAction.AddNote -> api.postNote(action.jobId, action.text)
        is PendingAction.Upload -> {
            val file = File(action.filePath)
            check(file.exists()) { "Upload file is missing: ${action.fileName}" }
            api.upload(action.jobId, file, action.fileName, action.mimeType, action.kind, action.stopId)
            file.delete()
            null
        }
    }
}
