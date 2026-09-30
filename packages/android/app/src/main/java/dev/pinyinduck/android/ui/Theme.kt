package dev.pinyinduck.android.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * The keyboard palette.
 *
 * A dark scheme with one accent, borrowed from the web playground: the candidate strip
 * carries the only saturated colour on screen so the eye goes to the Chinese characters
 * rather than to the keys.
 */
object DuckColors {
    val Background = Color(0xFF16161B)
    val Key = Color(0xFF2A2A33)
    val KeyPressed = Color(0xFF3E3E4A)
    val SpecialKey = Color(0xFF3B3B47)
    val PrimaryText = Color(0xFFECEAE6)
    val SecondaryText = Color(0xFF9A9AA6)
    val Accent = Color(0xFFFFC107)
    val CandidateSelected = Color(0xFF3A3A46)
    val Divider = Color(0xFF2E2E38)
}

private val DuckColorScheme = darkColorScheme(
    primary = DuckColors.Accent,
    onPrimary = DuckColors.Background,
    background = DuckColors.Background,
    onBackground = DuckColors.PrimaryText,
    surface = DuckColors.Background,
    onSurface = DuckColors.PrimaryText,
    surfaceVariant = DuckColors.Key,
    onSurfaceVariant = DuckColors.SecondaryText,
)

/**
 * Wraps the keyboard in a Material theme.
 *
 * The key and candidate surfaces set their own colours, but Material's `Text` still reads
 * typography and colour defaults from the theme, so it still needs an ancestor.
 */
@Composable
fun PinyinDuckTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DuckColorScheme, content = content)
}
