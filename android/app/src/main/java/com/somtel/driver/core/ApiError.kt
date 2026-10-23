package com.somtel.driver.core

import com.somtel.driver.core.model.AppJson
import com.somtel.driver.core.model.ErrorBody
import java.io.IOException

/** Category of failure, mapped to a localised message in the UI. */
enum class ErrorKind { NETWORK, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, VALIDATION, TOO_LARGE, UNSUPPORTED_TYPE, SERVER, UNKNOWN }

/** What the offline queue should do with an action that failed with an HTTP status. */
enum class RetryPolicy { RETRY, DROP, UNAUTHORIZED }

/** A non-2xx response. [serverMessage] is the `error` field of `{"error": "..."}` when present. */
class ApiException(val code: Int, val serverMessage: String?) :
    Exception(serverMessage ?: "HTTP $code") {
    val kind: ErrorKind get() = ApiErrors.kindFor(code)
}

object ApiErrors {
    fun kindFor(code: Int): ErrorKind = when {
        code == 401 -> ErrorKind.UNAUTHORIZED
        code == 403 -> ErrorKind.FORBIDDEN
        code == 404 -> ErrorKind.NOT_FOUND
        code == 409 -> ErrorKind.CONFLICT
        code == 413 -> ErrorKind.TOO_LARGE
        code == 415 -> ErrorKind.UNSUPPORTED_TYPE
        code == 400 || code == 422 -> ErrorKind.VALIDATION
        code in 500..599 -> ErrorKind.SERVER
        else -> ErrorKind.UNKNOWN
    }

    fun retryPolicy(code: Int): RetryPolicy = when {
        code == 401 -> RetryPolicy.UNAUTHORIZED
        code == 408 || code == 429 || code in 500..599 -> RetryPolicy.RETRY
        else -> RetryPolicy.DROP
    }

    /** Extracts `error` from a JSON error body; null for empty / non-JSON bodies. */
    fun parseMessage(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            AppJson.decodeFromString(ErrorBody.serializer(), body).error?.takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
    }

    fun fromResponse(code: Int, body: String?): ApiException = ApiException(code, parseMessage(body))

    fun kindOf(t: Throwable): ErrorKind = when (t) {
        is ApiException -> t.kind
        is IOException -> ErrorKind.NETWORK
        else -> ErrorKind.UNKNOWN
    }
}
