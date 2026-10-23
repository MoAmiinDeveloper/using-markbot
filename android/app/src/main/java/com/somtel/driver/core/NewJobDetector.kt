package com.somtel.driver.core

import com.somtel.driver.core.model.Job

/** Finds jobs the driver has not seen before so a "New job assigned" notification can be posted. */
object NewJobDetector {
    data class Result(val newJobs: List<Job>, val known: Set<Long>)

    fun detect(known: Set<Long>, incoming: List<Job>): Result {
        val fresh = incoming
            .filter { it.id !in known && JobRules.isActive(it.status) }
            .distinctBy { it.id }
        return Result(fresh, known + incoming.map { it.id })
    }
}
