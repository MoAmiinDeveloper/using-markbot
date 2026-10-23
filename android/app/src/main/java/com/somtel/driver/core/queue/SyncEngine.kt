package com.somtel.driver.core.queue

import com.somtel.driver.core.ApiErrors
import com.somtel.driver.core.ApiException
import com.somtel.driver.core.RetryPolicy
import com.somtel.driver.core.model.Job
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/** Sends one queued action to the server; returns the updated job when the server returns one. */
fun interface ActionExecutor {
    suspend fun execute(action: PendingAction): Job?
}

enum class SyncOutcome {
    /** Queue drained. */
    DONE,

    /** Network / server trouble: try again later (WorkManager backoff). */
    RETRY,

    /** Token rejected: the user must log in again. */
    UNAUTHORIZED,
}

/** An action the server rejected permanently; [code] is the HTTP status (null for local failures). */
data class DroppedAction(val action: PendingAction, val message: String, val code: Int? = null)

data class SyncResult(val outcome: SyncOutcome, val sent: Int, val dropped: List<DroppedAction>)

/**
 * Drains [ActionQueue] in FIFO order. A transient failure stops the run (to preserve ordering); a
 * permanent rejection (4xx such as 409 "invalid transition") drops that action and continues.
 */
class SyncEngine(
    private val queue: ActionQueue,
    private val executor: ActionExecutor,
    private val onSynced: (PendingAction, Job?) -> Unit = { _, _ -> },
    private val onDropped: (DroppedAction) -> Unit = {},
) {
    private val mutex = Mutex()

    suspend fun runOnce(): SyncResult = mutex.withLock { drain() }

    private suspend fun drain(): SyncResult {
        var sent = 0
        val dropped = mutableListOf<DroppedAction>()
        while (true) {
            val next = queue.peek() ?: return SyncResult(SyncOutcome.DONE, sent, dropped)
            try {
                val job = executor.execute(next)
                queue.remove(next.id)
                sent++
                onSynced(next, job)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                when (ApiErrors.retryPolicy(e.code)) {
                    RetryPolicy.RETRY -> return SyncResult(SyncOutcome.RETRY, sent, dropped)
                    RetryPolicy.UNAUTHORIZED -> return SyncResult(SyncOutcome.UNAUTHORIZED, sent, dropped)
                    RetryPolicy.DROP -> {
                        dropped += drop(next, e.message ?: "HTTP ${e.code}", e.code)
                    }
                }
            } catch (e: IOException) {
                return SyncResult(SyncOutcome.RETRY, sent, dropped)
            } catch (e: Exception) {
                // Unexpected (e.g. unreadable local file): drop so the queue cannot get stuck forever.
                dropped += drop(next, e.message ?: e.javaClass.simpleName)
            }
        }
    }

    private fun drop(action: PendingAction, message: String, code: Int? = null): DroppedAction {
        queue.remove(action.id)
        val d = DroppedAction(action, message, code)
        onDropped(d)
        return d
    }
}
