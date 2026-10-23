package com.somtel.driver.core.queue

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A driver change waiting to be sent to the server. Persisted as JSON (polymorphic, discriminator "type"). */
@Serializable
sealed class PendingAction {
    abstract val id: String
    abstract val jobId: Long
    abstract val createdAt: Long

    @Serializable
    @SerialName("status")
    data class StatusChange(
        override val id: String,
        override val jobId: Long,
        override val createdAt: Long,
        val status: String,
        val reason: String? = null,
        val lat: Double? = null,
        val lng: Double? = null,
    ) : PendingAction()

    @Serializable
    @SerialName("stop")
    data class StopUpdate(
        override val id: String,
        override val jobId: Long,
        override val createdAt: Long,
        val stopId: Long,
        val status: String,
        val notes: String? = null,
        val lat: Double? = null,
        val lng: Double? = null,
    ) : PendingAction()

    @Serializable
    @SerialName("checklist")
    data class ChecklistTick(
        override val id: String,
        override val jobId: Long,
        override val createdAt: Long,
        val itemId: Long,
        val done: Boolean,
    ) : PendingAction()

    @Serializable
    @SerialName("note")
    data class AddNote(
        override val id: String,
        override val jobId: Long,
        override val createdAt: Long,
        val text: String,
    ) : PendingAction()

    @Serializable
    @SerialName("upload")
    data class Upload(
        override val id: String,
        override val jobId: Long,
        override val createdAt: Long,
        val kind: String,
        val filePath: String,
        val fileName: String,
        val mimeType: String,
        val stopId: Long? = null,
    ) : PendingAction()
}
