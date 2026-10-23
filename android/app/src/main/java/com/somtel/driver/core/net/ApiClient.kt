package com.somtel.driver.core.net

import com.somtel.driver.core.ApiErrors
import com.somtel.driver.core.ApiException
import com.somtel.driver.core.ServerUrl
import com.somtel.driver.core.model.AppJson
import com.somtel.driver.core.model.Attachment
import com.somtel.driver.core.model.ChecklistRequest
import com.somtel.driver.core.model.DriverMe
import com.somtel.driver.core.model.Job
import com.somtel.driver.core.model.LocationRequest
import com.somtel.driver.core.model.LocationResponse
import com.somtel.driver.core.model.LoginRequest
import com.somtel.driver.core.model.LoginResponse
import com.somtel.driver.core.model.NoteRequest
import com.somtel.driver.core.model.StatusRequest
import com.somtel.driver.core.model.StopUpdateRequest
import com.somtel.driver.core.model.UpdatesResponse
import com.somtel.driver.core.model.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

/** A logged-in session: server origin (no /api/v1), JWT and the user it belongs to. */
@Serializable
data class Session(val serverUrl: String, val token: String, val user: User)

/**
 * Thin OkHttp + kotlinx.serialization client for the driver API.
 * [session] supplies the current credentials; [onUnauthorized] is invoked on any 401 from an
 * authenticated call (the app logs the user out).
 */
class ApiClient(
    private val session: () -> Session?,
    private val onUnauthorized: () -> Unit,
    baseClient: OkHttpClient? = null,
) {
    private val json = AppJson
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private val authInterceptor = Interceptor { chain ->
        val request = chain.request()
        val s = session()
        val out = if (s != null && request.header("Authorization") == null && sameServer(request.url, s.serverUrl)) {
            request.newBuilder().header("Authorization", "Bearer ${s.token}").build()
        } else {
            request
        }
        chain.proceed(out)
    }

    /** Shared client (also used by the image loader so attachment thumbnails carry the token). */
    val httpClient: OkHttpClient = (baseClient?.newBuilder() ?: OkHttpClient.Builder())
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .addInterceptor(authInterceptor)
        .build()

    private fun sameServer(url: HttpUrl, origin: String): Boolean {
        val base = origin.toHttpUrlOrNull() ?: return false
        return base.host.equals(url.host, ignoreCase = true) && base.port == url.port && base.scheme == url.scheme
    }

    private fun apiBase(): String {
        val s = session() ?: throw ApiException(401, "Not logged in")
        return ServerUrl.apiBase(s.serverUrl)
    }

    // ---- Auth ---------------------------------------------------------------------------------

    suspend fun login(origin: String, email: String, password: String): LoginResponse {
        val body = json.encodeToString(LoginRequest.serializer(), LoginRequest(email, password))
        val request = Request.Builder()
            .url(ServerUrl.apiBase(origin) + "/auth/login")
            .post(body.toRequestBody(jsonType))
            .build()
        return json.decodeFromString(LoginResponse.serializer(), execute(request, authenticated = false))
    }

    suspend fun me(): User = get("/me", User.serializer())

    // ---- Driver API ---------------------------------------------------------------------------

    suspend fun driverMe(): DriverMe = get("/driver/me", DriverMe.serializer())

    suspend fun jobs(status: String): List<Job> =
        get("/driver/jobs?status=$status", ListSerializer(Job.serializer()))

    suspend fun job(id: Long): Job = get("/driver/jobs/$id", Job.serializer())

    suspend fun updates(since: String): UpdatesResponse {
        val url = (apiBase() + "/driver/updates").toHttpUrl().newBuilder()
            .addQueryParameter("since", since)
            .build()
        val text = execute(Request.Builder().url(url).get().build())
        return json.decodeFromString(UpdatesResponse.serializer(), text)
    }

    suspend fun postStatus(jobId: Long, body: StatusRequest): Job? =
        postForJob("/driver/jobs/$jobId/status", StatusRequest.serializer(), body)

    suspend fun postStop(jobId: Long, stopId: Long, body: StopUpdateRequest): Job? =
        postForJob("/driver/jobs/$jobId/stops/$stopId", StopUpdateRequest.serializer(), body)

    suspend fun postChecklist(jobId: Long, itemId: Long, done: Boolean): Job? =
        postForJob("/driver/jobs/$jobId/checklist/$itemId", ChecklistRequest.serializer(), ChecklistRequest(done))

    suspend fun postNote(jobId: Long, text: String): Job? =
        postForJob("/driver/jobs/$jobId/notes", NoteRequest.serializer(), NoteRequest(text))

    suspend fun upload(jobId: Long, file: File, fileName: String, mimeType: String, kind: String, stopId: Long?): Attachment? {
        val builder = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("kind", kind)
        if (stopId != null) builder.addFormDataPart("stopId", stopId.toString())
        builder.addFormDataPart("file", fileName, file.asRequestBody(mimeType.toMediaType()))
        val request = Request.Builder()
            .url(apiBase() + "/driver/jobs/$jobId/attachments")
            .post(builder.build())
            .build()
        return decodeOrNull(Attachment.serializer(), execute(request))
    }

    suspend fun postLocation(body: LocationRequest): LocationResponse? =
        decodeOrNull(LocationResponse.serializer(), post("/driver/location", LocationRequest.serializer(), body))

    // ---- Plumbing -----------------------------------------------------------------------------

    private suspend fun <T> get(path: String, deserializer: DeserializationStrategy<T>): T {
        val text = execute(Request.Builder().url(apiBase() + path).get().build())
        return json.decodeFromString(deserializer, text)
    }

    private suspend fun <B> post(path: String, serializer: SerializationStrategy<B>, body: B): String {
        val requestBody: RequestBody = json.encodeToString(serializer, body).toRequestBody(jsonType)
        return execute(Request.Builder().url(apiBase() + path).post(requestBody).build())
    }

    private suspend fun <B> postForJob(path: String, serializer: SerializationStrategy<B>, body: B): Job? =
        decodeOrNull(Job.serializer(), post(path, serializer, body))

    private fun <T> decodeOrNull(deserializer: DeserializationStrategy<T>, text: String): T? {
        if (text.isBlank()) return null
        return try {
            json.decodeFromString(deserializer, text)
        } catch (_: Exception) {
            null
        }
    }

    private suspend fun execute(request: Request, authenticated: Boolean = true): String =
        withContext(Dispatchers.IO) {
            httpClient.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    if (response.code == 401 && authenticated) onUnauthorized()
                    throw ApiErrors.fromResponse(response.code, text)
                }
                text
            }
        }
}
