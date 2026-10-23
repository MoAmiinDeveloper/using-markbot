package com.somtel.driver.ui.login

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.somtel.driver.AppContainer
import com.somtel.driver.R
import com.somtel.driver.ui.common.errorMessage
import com.somtel.driver.ui.theme.SomtelColors
import com.somtel.driver.ui.theme.appBarColor

@Composable
fun LoginScreen(container: AppContainer) {
    val vm: LoginViewModel = viewModel(factory = viewModelFactory { initializer { LoginViewModel(container) } })
    val state by vm.uiState.collectAsStateWithLifecycle()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(appBarColor())
            .systemBarsPadding()
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 480.dp)
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painter = painterResource(R.drawable.ic_somtel_mark),
                contentDescription = null,
                modifier = Modifier.size(72.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.headlineMedium,
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = stringResource(R.string.login_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = SomtelColors.GoldLight,
            )
            Spacer(Modifier.height(24.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = state.serverUrl,
                        onValueChange = vm::onServerUrl,
                        label = { Text(stringResource(R.string.login_server_url)) },
                        placeholder = { Text(stringResource(R.string.login_server_url_hint)) },
                        singleLine = true,
                        isError = state.invalidUrl,
                        supportingText = {
                            when {
                                state.invalidUrl -> Text(stringResource(R.string.login_invalid_url))
                                state.isCleartext -> Text(stringResource(R.string.login_cleartext_warning))
                                else -> {}
                            }
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = state.email,
                        onValueChange = vm::onEmail,
                        label = { Text(stringResource(R.string.login_email)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = state.password,
                        onValueChange = vm::onPassword,
                        label = { Text(stringResource(R.string.login_password)) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { vm.login() }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    val error = state.error
                    if (state.roleNotAllowed) {
                        Text(stringResource(R.string.error_role_not_allowed), color = MaterialTheme.colorScheme.error)
                    } else if (error != null) {
                        Text(errorMessage(error), color = MaterialTheme.colorScheme.error)
                    }
                    Button(
                        onClick = vm::login,
                        enabled = state.canSubmit,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SomtelColors.Gold,
                            contentColor = SomtelColors.Navy,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                    ) {
                        if (state.loading) {
                            CircularProgressIndicator(
                                color = SomtelColors.Navy,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(22.dp),
                            )
                        } else {
                            Text(stringResource(R.string.login_button), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
