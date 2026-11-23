package dev.pinyinduck.android.ui

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.pinyinduck.android.ime.KeyboardUiState
import dev.pinyinduck.android.ime.OpenDetail
import kotlin.math.roundToInt

/** The keyboard itself, inside [KeyboardWindow]. */
const val KEYBOARD_TAG = "keyboard"

/** The empty, transparent space above the keyboard: the app shows through it. */
const val APP_AREA_TAG = "appArea"

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
 * than being sized to fit, and why the Expanded candidate list shrinks while the bubble is open
 * (#22): at full height it leaves no space at all. Horizontally it sits over whatever opened it, an element marked with
 * [detailAnchor], clamped to the window.
 *
 * @param onKeyboardTop where the keyboard's top edge landed, in window pixels. The service
 *   reports it to the window manager as the keyboard's insets. It is not called while the bubble
 *   is open: the Expanded candidate list shrinks then, and the host app must not resize or pan
 *   because the bubble opened (#16), so the insets keep the top from before it opened.
 */
@Composable
fun KeyboardWindow(
    state: KeyboardUiState,
    callbacks: KeyboardCallbacks,
    onKeyboardTop: (Int) -> Unit,
) {
    val anchors = remember { DetailAnchors() }
    ReturnFocusOnClose(state, anchors)
    val bubbleOpen by rememberUpdatedState(state.detailOpen)

    CompositionLocalProvider(LocalDetailAnchors provides anchors) {
        // Test tags double as accessibility resource ids, so a UI Automator test on a device
        // finds the keyboard's elements by tag (`By.res(SENTENCE_SLOT_TAG)`) the way a Compose
        // test does. Set once here and inherited by everything in the window.
        Column(modifier = Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
            var areaLeft by remember { mutableFloatStateOf(0f) }
            BoxWithConstraints(
                modifier =
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .onGloballyPositioned { areaLeft = it.boundsInRoot().left },
                contentAlignment = Alignment.BottomStart,
            ) {
                val detail = state.detail
                if (detail != null) {
                    Box(
                        modifier =
                            Modifier
                                .fillMaxSize()
                                .testTag(APP_AREA_TAG)
                                .pointerInput(Unit) { detectTapGestures { callbacks.onCloseDetail() } },
                    )
                    val width = minOf(maxWidth - BUBBLE_MARGIN * 2, BUBBLE_MAX_WIDTH)
                    val density = LocalDensity.current
                    val left =
                        with(density) {
                            bubbleLeft(
                                anchor = anchors.boundsOf(detail.index),
                                areaLeft = areaLeft,
                                areaWidth = maxWidth.toPx(),
                                bubbleWidth = width.toPx(),
                                margin = BUBBLE_MARGIN.toPx(),
                            )
                        }
                    CandidateDetailBubble(
                        detail = detail,
                        onUse = { callbacks.onSelectCandidate(detail.index) },
                        onClose = callbacks.onCloseDetail,
                        modifier =
                            Modifier
                                .offset { IntOffset(left.roundToInt(), 0) }
                                .padding(vertical = 6.dp)
                                .width(width),
                    )
                }
            }

            PinyinDuckKeyboard(
                state = state,
                callbacks = callbacks,
                modifier =
                    Modifier
                        .testTag(KEYBOARD_TAG)
                        .onGloballyPositioned {
                            if (!bubbleOpen) onKeyboardTop(it.boundsInWindow().top.roundToInt())
                        },
            )
        }
    }
}

/** The bubble's widest, so that on a phone it visibly belongs to one candidate. */
private val BUBBLE_MAX_WIDTH = 320.dp

/** The least space between the bubble and either edge of the window. */
private val BUBBLE_MARGIN = 10.dp

/**
 * Where the bubble's left edge goes, in pixels from the left of the space above the keyboard.
 *
 * Centred over the [anchor] and then clamped, so a bubble for the first or last candidate stays
 * inside the window. Without an anchor yet (the first frame), it is centred in the window.
 */
internal fun bubbleLeft(
    anchor: Rect?,
    areaLeft: Float,
    areaWidth: Float,
    bubbleWidth: Float,
    margin: Float,
): Float {
    val centre = anchor?.let { (it.left + it.right) / 2 - areaLeft } ?: (areaWidth / 2)
    val max = (areaWidth - margin - bubbleWidth).coerceAtLeast(margin)
    return (centre - bubbleWidth / 2).coerceIn(margin, max)
}

/**
 * Hands focus back to the candidate the bubble was opened from, once it closes (#11).
 *
 * Only when that candidate is still where it was: a bubble closed by committing it, or by a key
 * that re-ranked the strip, has nothing to return to, and focusing whatever now sits at the
 * same index would be a different candidate.
 */
@Composable
private fun ReturnFocusOnClose(
    state: KeyboardUiState,
    anchors: DetailAnchors,
) {
    val last = remember { arrayOfNulls<OpenDetail>(1) }
    LaunchedEffect(state.detail) {
        val closed = last[0]
        last[0] = state.detail
        if (state.detail == null && closed != null && state.candidates.getOrNull(closed.index) == closed.candidate) {
            anchors.focus(closed.index)
        }
    }
}
