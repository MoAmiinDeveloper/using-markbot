package com.somtel.driver.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object SomtelColors {
    val Gold = Color(0xFFFFD700)
    val GoldLight = Color(0xFFFFF1A6)
    val GoldDark = Color(0xFFC9A800)
    val Navy = Color(0xFF222D5D)
    val NavyDark = Color(0xFF161D3D)
    val NavyDeep = Color(0xFF0E1330)
    val NavyLight = Color(0xFF3A4785)
    val Red = Color(0xFFC62828)
    val RedLight = Color(0xFFFF8A80)
    val Green = Color(0xFF2E7D32)
    val GreenLight = Color(0xFF81C784)
    val Orange = Color(0xFFEF6C00)
}

private val LightColors = lightColorScheme(
    primary = SomtelColors.Gold,
    onPrimary = SomtelColors.Navy,
    primaryContainer = SomtelColors.GoldLight,
    onPrimaryContainer = SomtelColors.Navy,
    secondary = SomtelColors.Navy,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDDE1F5),
    onSecondaryContainer = SomtelColors.Navy,
    tertiary = SomtelColors.NavyLight,
    onTertiary = Color.White,
    background = Color(0xFFF5F6FA),
    onBackground = Color(0xFF1A1C24),
    surface = Color.White,
    onSurface = Color(0xFF1A1C24),
    surfaceVariant = Color(0xFFE6E8F0),
    onSurfaceVariant = Color(0xFF454857),
    outline = Color(0xFF767988),
    error = SomtelColors.Red,
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = SomtelColors.Gold,
    onPrimary = SomtelColors.Navy,
    primaryContainer = Color(0xFF4D4100),
    onPrimaryContainer = SomtelColors.GoldLight,
    secondary = Color(0xFFB8C2F0),
    onSecondary = SomtelColors.NavyDeep,
    secondaryContainer = SomtelColors.NavyLight,
    onSecondaryContainer = Color.White,
    tertiary = Color(0xFF9FA9DA),
    onTertiary = SomtelColors.NavyDeep,
    background = SomtelColors.NavyDeep,
    onBackground = Color(0xFFE4E6F0),
    surface = Color(0xFF181F42),
    onSurface = Color(0xFFE4E6F0),
    surfaceVariant = Color(0xFF262E58),
    onSurfaceVariant = Color(0xFFC3C7DA),
    outline = Color(0xFF8D92AA),
    error = SomtelColors.RedLight,
    onError = Color(0xFF410002),
)

/** Navy app bar colour in both themes (slightly darker at night). */
@Composable
fun appBarColor(): Color = if (isSystemInDarkTheme()) SomtelColors.NavyDark else SomtelColors.Navy

@Composable
fun lateColor(): Color = if (isSystemInDarkTheme()) SomtelColors.RedLight else SomtelColors.Red

@Composable
fun SomtelTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
