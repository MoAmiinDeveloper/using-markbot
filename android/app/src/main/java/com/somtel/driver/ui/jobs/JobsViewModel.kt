package com.somtel.driver.ui.jobs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.somtel.driver.AppContainer
import com.somtel.driver.core.JobRules
import com.somtel.driver.core.model.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class JobsUiState(
    val active: List<Job> = emptyList(),
    val history: List<Job> = emptyList(),
    val pendingByJob: Map<Long, Int> = emptyMap(),
    val totalPending: Int = 0,
)

class JobsViewModel(private val container: AppContainer) : ViewModel() {
    private val repo = container.repository

    val uiState: StateFlow<JobsUiState> = combine(repo.jobs, repo.pendingActions) { jobs, actions ->
        val (active, history) = jobs.partition { JobRules.isActive(it.status) }
        JobsUiState(
            active = JobRules.sortActive(active),
            history = JobRules.sortHistory(history),
            pendingByJob = actions.groupingBy { it.jobId }.eachCount(),
            totalPending = actions.size,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), JobsUiState())

    private val refreshingState = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = refreshingState.asStateFlow()

    private val errorState = MutableStateFlow<Throwable?>(null)
    val error: StateFlow<Throwable?> = errorState.asStateFlow()

    val syncProblem: StateFlow<String?> = repo.syncProblem

    init {
        refresh()
    }

    fun refresh() {
        if (refreshingState.value) return
        refreshingState.value = true
        viewModelScope.launch {
            try {
                container.runSync()
                repo.refresh()
                errorState.value = null
            } catch (e: Exception) {
                errorState.value = e
            } finally {
                refreshingState.value = false
            }
        }
    }

    fun dismissError() {
        errorState.value = null
    }

    fun dismissSyncProblem() = repo.clearSyncProblem()
}
