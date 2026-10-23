package com.somtel.driver.core.queue

import com.somtel.driver.core.model.AppJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** Persisted FIFO of [PendingAction]s. Thread-safe; every mutation is written through to [storage]. */
class ActionQueue(
    private val storage: TextStorage,
    private val json: Json = AppJson,
) {
    private val serializer = ListSerializer(PendingAction.serializer())
    private val lock = Any()
    private val state = MutableStateFlow(load())

    val actions: StateFlow<List<PendingAction>> = state.asStateFlow()

    private fun load(): List<PendingAction> {
        val text = storage.read() ?: return emptyList()
        return try {
            json.decodeFromString(serializer, text)
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun snapshot(): List<PendingAction> = state.value

    fun peek(): PendingAction? = state.value.firstOrNull()

    fun enqueue(action: PendingAction) = mutate { it + action }

    fun remove(id: String) = mutate { list -> list.filterNot { it.id == id } }

    fun clear() = mutate { emptyList() }

    /** Removes every queued action of [jobId] and returns them (e.g. the job was reassigned). */
    fun removeForJob(jobId: Long): List<PendingAction> {
        synchronized(lock) {
            val removed = state.value.filter { it.jobId == jobId }
            if (removed.isNotEmpty()) mutate { list -> list.filterNot { it.jobId == jobId } }
            return removed
        }
    }

    fun countForJob(jobId: Long): Int = state.value.count { it.jobId == jobId }

    private fun mutate(change: (List<PendingAction>) -> List<PendingAction>) {
        synchronized(lock) {
            val next = change(state.value)
            storage.write(json.encodeToString(serializer, next))
            state.value = next
        }
    }
}
