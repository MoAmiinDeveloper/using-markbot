package com.somtel.driver.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.somtel.driver.AppContainer
import com.somtel.driver.core.ServerUrl
import com.somtel.driver.core.model.Roles
import com.somtel.driver.core.net.Session
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val serverUrl: String = "",
    val email: String = "",
    val password: String = "",
    val loading: Boolean = false,
    val invalidUrl: Boolean = false,
    val roleNotAllowed: Boolean = false,
    val error: Throwable? = null,
) {
    val canSubmit: Boolean get() = !loading && serverUrl.isNotBlank() && email.isNotBlank() && password.isNotEmpty()
    val isCleartext: Boolean get() = serverUrl.trim().startsWith("http://", ignoreCase = true)
}

class LoginViewModel(private val container: AppContainer) : ViewModel() {
    private val state = MutableStateFlow(
        LoginUiState(serverUrl = container.settings.lastServerUrl, email = container.settings.lastEmail),
    )
    val uiState: StateFlow<LoginUiState> = state.asStateFlow()

    fun onServerUrl(v: String) = state.update { it.copy(serverUrl = v, invalidUrl = false, error = null, roleNotAllowed = false) }
    fun onEmail(v: String) = state.update { it.copy(email = v, error = null, roleNotAllowed = false) }
    fun onPassword(v: String) = state.update { it.copy(password = v, error = null, roleNotAllowed = false) }

    fun login() {
        val s = state.value
        if (!s.canSubmit) return
        val origin = ServerUrl.normalize(s.serverUrl)
        if (origin == null) {
            state.update { it.copy(invalidUrl = true) }
            return
        }
        state.update { it.copy(loading = true, error = null, invalidUrl = false, roleNotAllowed = false) }
        viewModelScope.launch {
            try {
                val email = s.email.trim()
                val response = container.api.login(origin, email, s.password)
                if (response.user.role !in Roles.ALLOWED) {
                    state.update { it.copy(loading = false, roleNotAllowed = true) }
                    return@launch
                }
                container.onLoggedIn(Session(origin, response.token, response.user), email)
                state.update { it.copy(loading = false, password = "") }
            } catch (e: Exception) {
                state.update { it.copy(loading = false, error = e) }
            }
        }
    }
}
