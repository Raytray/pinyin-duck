package dev.pinyinduck.android.ime

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pinyinduck.android.R
import dev.pinyinduck.android.data.DictionaryLoader
import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.ui.DuckColors
import dev.pinyinduck.android.ui.PinyinDuckTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A small settings screen, reachable from the launcher and from the "Keyboard settings"
 * button in the system IME picker.
 */
class SettingsActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val settings = KeyboardSettings(this)
        setContent {
            PinyinDuckTheme {
                SettingsScreen(
                    settings = settings,
                    onOpenImeSettings = {
                        startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
                    },
                )
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    settings: KeyboardSettings,
    onOpenImeSettings: () -> Unit,
) {
    val context = LocalContext.current
    var script by remember { mutableStateOf(settings.defaultScript) }
    var dictionaryStatus by remember { mutableStateOf<DictionaryStatus>(DictionaryStatus.Loading) }

    // The dictionary ships in the APK, so this reads it the same way the keyboard does:
    // by mapping the asset. It doubles as a check that the asset is present and mmap-able.
    LaunchedEffect(Unit) {
        dictionaryStatus =
            withContext(Dispatchers.IO) {
                runCatching { DictionaryLoader.openFromAssets(context.assets) }
                    .fold(
                        onSuccess = { opened ->
                            val entries = opened.entryCount
                            opened.close()
                            DictionaryStatus.Ready(entries)
                        },
                        onFailure = { DictionaryStatus.Failed(it.message ?: it.javaClass.simpleName) },
                    )
            }
    }

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(DuckColors.Background)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
    ) {
        Text(
            text = stringResource(R.string.app_name),
            color = DuckColors.PrimaryText,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
        )

        Text(
            text = stringResource(R.string.settings_enable_hint),
            color = DuckColors.SecondaryText,
            fontSize = 12.sp,
            modifier = Modifier.padding(top = 6.dp, bottom = 18.dp),
        )

        Button(onClick = onOpenImeSettings) {
            Text("Open keyboard settings")
        }

        SectionTitle(stringResource(R.string.settings_script_heading))
        Text(
            text = stringResource(R.string.settings_script_summary),
            color = DuckColors.SecondaryText,
            fontSize = 11.sp,
            modifier = Modifier.padding(bottom = 8.dp),
        )

        ScriptOption(
            label = stringResource(R.string.settings_script_simplified),
            selected = script == ScriptType.SIMPLIFIED,
            onSelect = {
                script = ScriptType.SIMPLIFIED
                settings.defaultScript = ScriptType.SIMPLIFIED
            },
        )
        ScriptOption(
            label = stringResource(R.string.settings_script_traditional),
            selected = script == ScriptType.TRADITIONAL,
            onSelect = {
                script = ScriptType.TRADITIONAL
                settings.defaultScript = ScriptType.TRADITIONAL
            },
        )

        SectionTitle(stringResource(R.string.settings_dictionary_heading))
        Text(
            text =
                when (val status = dictionaryStatus) {
                    DictionaryStatus.Loading -> stringResource(R.string.settings_dictionary_loading)
                    is DictionaryStatus.Ready -> "CC-CEDICT: ${status.entries} entries"
                    is DictionaryStatus.Failed -> stringResource(R.string.settings_dictionary_missing)
                },
            color = if (dictionaryStatus is DictionaryStatus.Failed) DuckColors.Accent else DuckColors.PrimaryText,
            fontSize = 13.sp,
        )
    }
}

private sealed interface DictionaryStatus {
    data object Loading : DictionaryStatus

    data class Ready(
        val entries: Int,
    ) : DictionaryStatus

    data class Failed(
        val reason: String,
    ) : DictionaryStatus
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        color = DuckColors.PrimaryText,
        fontSize = 15.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(top = 22.dp, bottom = 8.dp),
    )
}

@Composable
private fun ScriptOption(
    label: String,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 3.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (selected) DuckColors.Accent.copy(alpha = 0.16f) else DuckColors.Key)
                .clickable(onClick = onSelect)
                .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = DuckColors.PrimaryText, fontSize = 14.sp)
        if (selected) {
            Text("✓", color = DuckColors.Accent, fontSize = 16.sp, modifier = Modifier.size(18.dp))
        }
    }
}
