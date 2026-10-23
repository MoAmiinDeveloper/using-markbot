package com.somtel.driver.core.queue

import com.somtel.driver.core.model.AppJson
import com.somtel.driver.core.model.Job
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** Last known server copy of the driver's jobs, persisted so the app works offline after a restart. */
class JobStore(private val storage: TextStorage, private val json: Json = AppJson) {
    private val serializer = ListSerializer(Job.serializer())

    fun load(): List<Job> {
        val text = storage.read() ?: return emptyList()
        return try {
            json.decodeFromString(serializer, text)
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun save(jobs: Collection<Job>) {
        storage.write(json.encodeToString(serializer, jobs.toList()))
    }
}
