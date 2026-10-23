package com.somtel.driver.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.somtel.driver.AppContainer
import com.somtel.driver.ui.detail.JobDetailScreen
import com.somtel.driver.ui.jobs.JobsScreen
import com.somtel.driver.ui.login.LoginScreen
import com.somtel.driver.ui.profile.ProfileScreen
import com.somtel.driver.ui.signature.SignatureScreen

private object Routes {
    const val JOBS = "jobs"
    const val JOB = "job/{jobId}"
    const val SIGNATURE = "job/{jobId}/signature"
    const val PROFILE = "profile"

    fun job(id: Long) = "job/$id"
    fun signature(id: Long) = "job/$id/signature"
}

/** Login when signed out; otherwise the jobs navigation graph. A 401 anywhere flips back to login. */
@Composable
fun AppRoot(container: AppContainer, pendingJobId: Long?, onPendingJobConsumed: () -> Unit) {
    val session by container.sessionStore.session.collectAsStateWithLifecycle()
    if (session == null) {
        LoginScreen(container)
        return
    }

    val navController = rememberNavController()

    LaunchedEffect(pendingJobId) {
        if (pendingJobId != null) {
            navController.navigate(Routes.job(pendingJobId)) { launchSingleTop = true }
            onPendingJobConsumed()
        }
    }

    NavHost(navController = navController, startDestination = Routes.JOBS) {
        composable(Routes.JOBS) {
            JobsScreen(
                container = container,
                onOpenJob = { id -> navController.navigate(Routes.job(id)) },
                onOpenProfile = { navController.navigate(Routes.PROFILE) },
            )
        }
        composable(
            route = Routes.JOB,
            arguments = listOf(navArgument("jobId") { type = NavType.LongType }),
        ) { entry ->
            val jobId = entry.arguments?.getLong("jobId") ?: 0L
            JobDetailScreen(
                container = container,
                jobId = jobId,
                onBack = { navController.popBackStack() },
                onSignature = { navController.navigate(Routes.signature(jobId)) },
            )
        }
        composable(
            route = Routes.SIGNATURE,
            arguments = listOf(navArgument("jobId") { type = NavType.LongType }),
        ) { entry ->
            val jobId = entry.arguments?.getLong("jobId") ?: 0L
            SignatureScreen(
                container = container,
                jobId = jobId,
                onDone = { navController.popBackStack() },
            )
        }
        composable(Routes.PROFILE) {
            ProfileScreen(container = container, onBack = { navController.popBackStack() })
        }
    }
}
