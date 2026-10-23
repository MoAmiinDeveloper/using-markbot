package com.somtel.driver.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** JSON models mirroring docs/API.md ("Phase 4a → Driver app API"). Unknown fields are ignored. */

@Serializable
data class User(
    val id: Long = 0,
    val email: String = "",
    val name: String = "",
    val role: String = "",
)

@Serializable
data class Driver(
    val id: Long = 0,
    val name: String = "",
    val phone: String = "",
    val deviceId: Long? = null,
    val userId: Long? = null,
)

@Serializable
data class Device(
    val id: Long = 0,
    val name: String = "",
    val uniqueId: String = "",
)

@Serializable
data class DriverMe(
    val user: User? = null,
    val driver: Driver? = null,
    val vehicle: Device? = null,
)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class LoginResponse(val token: String, val user: User)

@Serializable
data class Stop(
    val id: Long,
    val seq: Int = 0,
    val name: String = "",
    val address: String = "",
    val lat: Double? = null,
    val lng: Double? = null,
    val radius: Double = 0.0,
    val status: String = StopStatus.PENDING,
    val arrivedAt: String? = null,
    val departedAt: String? = null,
    val completedAt: String? = null,
    val notes: String = "",
)

@Serializable
data class ChecklistItem(
    val id: Long,
    val text: String = "",
    val required: Boolean = false,
    val done: Boolean = false,
    val doneAt: String? = null,
)

@Serializable
data class Attachment(
    val id: Long,
    val kind: String = "",
    val stopId: Long? = null,
    val url: String = "",
    val name: String = "",
    val createdAt: String? = null,
)

@Serializable
data class Job(
    val id: Long,
    val reference: String = "",
    val title: String = "",
    val description: String = "",
    val priority: String = JobPriority.NORMAL,
    val status: String = JobStatus.ASSIGNED,
    val deviceId: Long? = null,
    val driverId: Long? = null,
    val customerName: String = "",
    val customerPhone: String = "",
    val scheduledStart: String? = null,
    val dueBy: String? = null,
    val stops: List<Stop> = emptyList(),
    val checklist: List<ChecklistItem> = emptyList(),
    val attachments: List<Attachment> = emptyList(),
    val notes: String = "",
    val failureReason: String = "",
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val completedAt: String? = null,
    val routeId: Long? = null,
    /** Server-computed: dueBy passed and not completed/failed/cancelled. */
    val late: Boolean = false,
)

@Serializable
data class UpdatesResponse(
    val jobs: List<Job> = emptyList(),
    val now: String? = null,
)

/** `POST /driver/location` → `{"stored": true, "deviceId": 12}` (stored=false when the vehicle tracks the driver). */
@Serializable
data class LocationResponse(val stored: Boolean = false, val deviceId: Long? = null)

@Serializable
data class ErrorBody(val error: String? = null)

@Serializable
data class StatusRequest(
    val status: String,
    val reason: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
)

@Serializable
data class StopUpdateRequest(
    val status: String,
    val notes: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
)

@Serializable
data class ChecklistRequest(val done: Boolean)

@Serializable
data class NoteRequest(val text: String)

@Serializable
data class LocationRequest(
    val lat: Double,
    val lng: Double,
    val speed: Double? = null,
    val course: Double? = null,
    val accuracy: Double? = null,
    val time: String? = null,
)

object JobStatus {
    const val UNASSIGNED = "unassigned"
    const val ASSIGNED = "assigned"
    const val ACCEPTED = "accepted"
    const val EN_ROUTE = "enRoute"
    const val ARRIVED = "arrived"
    const val IN_PROGRESS = "inProgress"
    const val COMPLETED = "completed"
    const val FAILED = "failed"
    const val CANCELLED = "cancelled"
}

object StopStatus {
    const val PENDING = "pending"
    const val ARRIVED = "arrived"
    const val COMPLETED = "completed"
    const val SKIPPED = "skipped"
}

object JobPriority {
    const val NORMAL = "normal"
    const val HIGH = "high"
    const val URGENT = "urgent"
}

object AttachmentKind {
    const val PHOTO = "photo"
    const val SIGNATURE = "signature"
    const val DOCUMENT = "document"
}

object Roles {
    const val DRIVER = "driver"
    const val ADMIN = "admin"
    val ALLOWED = setOf(DRIVER, ADMIN)
}

/** The one Json instance used across the app (lenient about the server adding fields). */
val AppJson: Json = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    isLenient = true
}
