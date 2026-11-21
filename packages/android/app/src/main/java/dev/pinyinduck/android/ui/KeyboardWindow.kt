package dev.pinyinduck.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pinyinduck.android.ime.KeyboardUiState
import kotlin.math.roundToInt

/** The keyboard itself, inside [KeyboardWindow]. */
const val KEYBOARD_TAG = "keyboard"

/** The empty, transparent space above the keyboard: the app shows through it. */
const val APP_AREA_TAG = "appArea"

/** The Candidate detail bubble. */
const val DETAIL_BUBBLE_TAG = "detailBubble"

/** The bubble's scrolling content. */
const val DETAIL_CONTENT_TAG = "detailContent"

/** The bubble's ✕. */
const val DETAIL_CLOSE_TAG = "detailClose"

/**
 * Everything drawn in the full-height IME window.
 *
 * The window fills the screen so the Candidate detail bubble can float over the app (#10), but
 * to the user it is still a keyboard on the bottom edge: the keyboard takes its own height at
 * the bottom and everything above it is transparent. That space is the app, and while the
 * bubble is closed the window's touchable region leaves it to the app.
 *
 * While the bubble is open the whole window is touchable (see `ImeInsets`), and a tap on the
 * app area lands here, closes the bubble, and goes no further: the app never sees it (#11,
 * option A). The keys and strip are untouched by that, because they are drawn on top of the
 * app area rather than under it.
 *
 * The bubble lives in the space above the keyboard and nowhere else, so its height is capped
 * at that space and it can never cover a key; its content scrolls when it is taller. On a
 * landscape phone that space may be only ~100–150 dp, which is why the content scrolls rather
 * than being sized to fit.
 *
 * @param onKeyboardTop where the keyboard's top edge landed, in window pixels. The service
 *   reports it to the window manager as the keyboard's insets.
 */
@Composable
fun KeyboardWindow(
    state: KeyboardUiState,
    callbacks: KeyboardCallbacks,
    onKeyboardTop: (Int) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier =
                Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            contentAlignment = Alignment.BottomCenter,
        ) {
            if (state.detailOpen) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .testTag(APP_AREA_TAG)
                            .pointerInput(Unit) { detectTapGestures { callbacks.onCloseDetail() } },
                )
                StubDetailBubble(onClose = callbacks.onCloseDetail)
            }
        }

        PinyinDuckKeyboard(
            state = state,
            callbacks = callbacks,
            modifier =
                Modifier
                    .testTag(KEYBOARD_TAG)
                    .onGloballyPositioned { onKeyboardTop(it.boundsInWindow().top.roundToInt()) },
        )
    }
}

/**
 * The placeholder Candidate detail bubble.
 *
 * Fixed content, deliberately taller than the space a landscape phone has above the keyboard,
 * so the spike shows the bubble clamping and scrolling on device. The real detail replaces the
 * placeholder lines in the bubble slice (#21); the placement and the close paths stay.
 */
@Composable
private fun StubDetailBubble(onClose: () -> Unit) {
    Column(
        modifier =
            Modifier
                .testTag(DETAIL_BUBBLE_TAG)
                .semantics { paneTitle = "Candidate detail" }
                .padding(horizontal = 10.dp, vertical = 6.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(DuckColors.SpecialKey)
                .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "Candidate detail",
                color = DuckColors.PrimaryText,
                fontSize = 15.sp,
                modifier = Modifier.weight(1f),
            )
            Box(
                modifier =
                    Modifier
                        .testTag(DETAIL_CLOSE_TAG)
                        .size(34.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .clickable(onClickLabel = "Close", onClick = onClose),
                contentAlignment = Alignment.Center,
            ) {
                Text(text = "✕", color = DuckColors.PrimaryText, fontSize = 15.sp)
            }
        }
        Column(
            modifier =
                Modifier
                    .testTag(DETAIL_CONTENT_TAG)
                    .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            repeat(PLACEHOLDER_LINES) { line ->
                Text(
                    text = "Placeholder line ${line + 1}",
                    color = DuckColors.SecondaryText,
                    fontSize = 13.sp,
                )
            }
        }
    }
}

/** Enough placeholder lines to overflow the bubble on any phone, so scrolling is visible. */
private const val PLACEHOLDER_LINES = 20
