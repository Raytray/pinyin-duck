package dev.pinyinduck.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pinyinduck.android.engine.DetailGroup
import dev.pinyinduck.android.ime.OpenDetail

/** The Candidate detail bubble. */
const val DETAIL_BUBBLE_TAG = "detailBubble"

/** The bubble's scrolling content. */
const val DETAIL_CONTENT_TAG = "detailContent"

/** The bubble's ✕. */
const val DETAIL_CLOSE_TAG = "detailClose"

/** The bubble's heading, the candidate's Hanzi, which takes focus when the bubble opens. */
const val DETAIL_HEADING_TAG = "detailHeading"

/**
 * Where the Candidate detail bubble can be anchored, by candidate index.
 *
 * Anything that can open the bubble marks itself with [detailAnchor]: today a strip candidate,
 * and (#22) a card in the Expanded candidate list. The bubble reads the anchor's bounds to sit
 * over it, and its focus requester to hand focus back when it closes. Only one of the strip or
 * the list is on screen at a time, so an index names one anchor.
 */
@Stable
class DetailAnchors {
    private val bounds = mutableStateMapOf<Int, Rect>()
    private val requesters = mutableMapOf<Int, FocusRequester>()

    /** The anchor's bounds in the window's root coordinates, or null when it is not on screen. */
    fun boundsOf(index: Int): Rect? = bounds[index]

    /** Moves focus to the anchor, if it is still on screen. */
    fun focus(index: Int) {
        requesters[index]?.let { runCatching { it.requestFocus() } }
    }

    internal fun place(
        index: Int,
        requester: FocusRequester,
        rect: Rect,
    ) {
        requesters[index] = requester
        if (bounds[index] != rect) bounds[index] = rect
    }

    internal fun remove(
        index: Int,
        requester: FocusRequester,
    ) {
        if (requesters[index] !== requester) return
        requesters.remove(index)
        bounds.remove(index)
    }
}

/** The anchors of the window being drawn; [KeyboardWindow] provides it. */
val LocalDetailAnchors = staticCompositionLocalOf { DetailAnchors() }

/**
 * Marks this element as the anchor of the Candidate detail for the candidate at [index].
 *
 * Put it before the element's clickable, so the focus requester reaches that clickable's
 * focus target and focus can return to it when the bubble closes.
 */
fun Modifier.detailAnchor(index: Int): Modifier =
    composed {
        val anchors = LocalDetailAnchors.current
        val requester = remember { FocusRequester() }
        DisposableEffect(anchors, index, requester) {
            onDispose { anchors.remove(index, requester) }
        }
        focusRequester(requester).onGloballyPositioned { anchors.place(index, requester, it.boundsInRoot()) }
    }

/**
 * The Candidate detail bubble: the candidate, its reading and counterpart, then every line the
 * detail view returns (#5 M2, #11).
 *
 * It draws the [OpenDetail.view] line for line and adds nothing of its own, so the bubble says
 * what the web accordion says. When the detail could not be read, the short gloss stands in
 * for the senses, as it does on web while the detail is loading.
 *
 * It is an accessibility pane titled for its candidate, focus moves to its heading when it
 * opens, and ✕ and "Use 猫" are ordinary buttons. The header stays put and the rest scrolls,
 * since the space above the keyboard can be very short in landscape.
 */
@Composable
fun CandidateDetailBubble(
    detail: OpenDetail,
    onUse: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val candidate = detail.candidate
    val headingFocus = remember { FocusRequester() }
    LaunchedEffect(detail.index, candidate) { runCatching { headingFocus.requestFocus() } }

    Column(
        modifier =
            modifier
                .testTag(DETAIL_BUBBLE_TAG)
                .semantics { paneTitle = "Details for ${candidate.hanzi} ${candidate.pinyinMarks}" }
                .clip(RoundedCornerShape(14.dp))
                .background(DuckColors.SpecialKey)
                .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = candidate.hanzi,
                color = DuckColors.PrimaryText,
                fontSize = 26.sp,
                modifier =
                    Modifier
                        .testTag(DETAIL_HEADING_TAG)
                        .semantics { heading() }
                        .focusRequester(headingFocus)
                        .focusable(),
            )
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(text = candidate.pinyinMarks, color = DuckColors.PrimaryText, fontSize = 14.sp)
                detail.view?.counterpart?.let { Text(text = it, color = DuckColors.SecondaryText, fontSize = 13.sp) }
            }
            Box(
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(DuckColors.Accent.copy(alpha = 0.85f))
                        .clickable(role = Role.Button, onClick = onUse)
                        .padding(horizontal = 10.dp, vertical = 7.dp),
            ) {
                Text(text = "Use ${candidate.hanzi}", color = DuckColors.Background, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(4.dp))
            Box(
                modifier =
                    Modifier
                        .testTag(DETAIL_CLOSE_TAG)
                        .size(34.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .clickable(role = Role.Button, onClick = onClose)
                        .semantics { contentDescription = "Close" },
                contentAlignment = Alignment.Center,
            ) {
                Text(text = "✕", color = DuckColors.PrimaryText, fontSize = 15.sp, modifier = Modifier.clearAndSetSemantics {})
            }
        }
        Column(
            modifier =
                Modifier
                    .testTag(DETAIL_CONTENT_TAG)
                    .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            val view = detail.view
            if (view == null) {
                if (candidate.shortGloss.isNotEmpty()) DetailLine(candidate.shortGloss)
                DetailLine("Couldn't load details", color = DuckColors.Accent)
            } else {
                view.groups.forEach { DetailGroupLines(it) }
            }
        }
    }
}

@Composable
private fun DetailGroupLines(group: DetailGroup) {
    group.heading?.let {
        Text(
            text = it,
            color = DuckColors.PrimaryText,
            fontSize = 17.sp,
            modifier = Modifier.padding(top = 4.dp).semantics { heading() },
        )
    }
    group.partOfSpeech?.let { DetailLine(it, italic = true) }
    group.tags.forEach { DetailLine(it, color = DuckColors.Accent) }
    group.senses.forEach { sense ->
        Row(modifier = Modifier.semantics(mergeDescendants = true) {}) {
            Text(
                text = sense.number.toString(),
                color = DuckColors.SecondaryText,
                fontSize = 13.sp,
                modifier = Modifier.width(18.dp),
            )
            Text(
                text = sense.text,
                // A proper noun sense (a name, a place) reads as secondary, as on web.
                color = if (sense.proper) DuckColors.SecondaryText else DuckColors.PrimaryText,
                fontStyle = if (sense.proper) FontStyle.Italic else FontStyle.Normal,
                fontSize = 13.sp,
            )
        }
    }
    if (group.measureWords.isNotEmpty()) {
        Row(modifier = Modifier.semantics(mergeDescendants = true) {}) {
            Text(text = "Measure words", color = DuckColors.SecondaryText, fontSize = 12.sp)
            Spacer(Modifier.width(6.dp))
            Text(text = group.measureWords.joinToString(" · "), color = DuckColors.PrimaryText, fontSize = 13.sp)
        }
    }
}

@Composable
private fun DetailLine(
    text: String,
    color: androidx.compose.ui.graphics.Color = DuckColors.SecondaryText,
    italic: Boolean = false,
) {
    Text(text = text, color = color, fontSize = 12.sp, fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal)
}
