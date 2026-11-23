package dev.pinyinduck.android.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pinyinduck.android.engine.Candidate
import dev.pinyinduck.android.engine.DetailGroup
import dev.pinyinduck.android.engine.DetailViewSense
import dev.pinyinduck.android.ime.OpenDetail

/** The Candidate detail bubble. */
const val DETAIL_BUBBLE_TAG = "detailBubble"

/** The bubble's scrolling content. */
const val DETAIL_CONTENT_TAG = "detailContent"

/** The bubble's ✕. */
const val DETAIL_CLOSE_TAG = "detailClose"

/** The bubble's heading, the candidate's Hanzi, which takes focus when the bubble opens. */
const val DETAIL_HEADING_TAG = "detailHeading"

/** One word's section in a Sentence candidate's detail. */
const val DETAIL_WORD_TAG = "detailWord"

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
        if (candidate.isSentence) {
            SentenceHeader(candidate, headingFocus, onUse, onClose)
        } else {
            WordHeader(detail, headingFocus, onUse, onClose)
        }
        // From the top for each candidate or word it is opened for, not where the last one was.
        val scroll = remember(detail.index, candidate, detail.focusWord) { ScrollState(0) }
        Column(
            modifier =
                Modifier
                    .testTag(DETAIL_CONTENT_TAG)
                    .verticalScroll(scroll),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            val view = detail.view
            when {
                candidate.isSentence -> SentenceSections(detail, scroll)
                view == null -> {
                    if (candidate.shortGloss.isNotEmpty()) DetailLine(candidate.shortGloss)
                    DetailLine("Couldn't load details", color = DuckColors.Accent)
                }
                else -> view.groups.forEach { DetailGroupLines(it) }
            }
        }
    }
}

/** A word candidate's header: its Hanzi, reading and counterpart, "Use 猫" and ✕ on one row. */
@Composable
private fun WordHeader(
    detail: OpenDetail,
    headingFocus: FocusRequester,
    onUse: () -> Unit,
    onClose: () -> Unit,
) {
    val candidate = detail.candidate
    Row(verticalAlignment = Alignment.CenterVertically) {
        Heading(candidate.hanzi, headingFocus)
        Spacer(Modifier.width(8.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = candidate.pinyinMarks, color = DuckColors.PrimaryText, fontSize = 14.sp)
            detail.view?.counterpart?.let { Text(text = it, color = DuckColors.SecondaryText, fontSize = 13.sp) }
        }
        UseButton(candidate.hanzi, onUse)
        Spacer(Modifier.width(4.dp))
        CloseButton(onClose)
    }
}

/**
 * A Sentence candidate's header (#46): the sentence, "Use" and ✕ on the top row, then the
 * reading on a line of its own with "then compose ‘fe’" after it when partial. The prototype
 * laid it out as [WordHeader] does, and a sentence's reading, many times longer than a word's,
 * was crushed into a narrow column between the Hanzi and the button. The button says only
 * "Use" (TalkBack: "Use 我想喝咖啡"), since the sentence is right beside it; and the header
 * stays two rows, because in landscape the bubble may have barely more than that.
 */
@Composable
private fun SentenceHeader(
    sentence: Candidate,
    headingFocus: FocusRequester,
    onUse: () -> Unit,
    onClose: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Heading(sentence.hanzi, headingFocus, modifier = Modifier.weight(1f), fontSize = 22.sp)
        Spacer(Modifier.width(8.dp))
        UseButton(sentence.hanzi, onUse, label = "Use")
        Spacer(Modifier.width(4.dp))
        CloseButton(onClose)
    }
    Text(
        text =
            buildAnnotatedString {
                append(sentence.pinyinMarks)
                if (sentence.remainingPinyin.isNotEmpty()) {
                    withStyle(SpanStyle(color = DuckColors.SecondaryText, fontStyle = FontStyle.Italic, fontSize = 12.sp)) {
                        append("  then compose ‘${sentence.remainingPinyin}’")
                    }
                }
            },
        color = DuckColors.PrimaryText,
        fontSize = 14.sp,
        modifier = Modifier.padding(bottom = 4.dp),
    )
}

@Composable
private fun Heading(
    hanzi: String,
    focus: FocusRequester,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = 26.sp,
) {
    Text(
        text = hanzi,
        color = DuckColors.PrimaryText,
        fontSize = fontSize,
        modifier =
            modifier
                .testTag(DETAIL_HEADING_TAG)
                .semantics { heading() }
                .focusRequester(focus)
                .focusable(),
    )
}

@Composable
private fun UseButton(
    hanzi: String,
    onUse: () -> Unit,
    label: String = "Use $hanzi",
) {
    Box(
        modifier =
            Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(DuckColors.Accent.copy(alpha = 0.85f))
                .clickable(role = Role.Button, onClick = onUse)
                .then(if (label != "Use $hanzi") Modifier.semantics { contentDescription = "Use $hanzi" } else Modifier)
                .padding(horizontal = 10.dp, vertical = 7.dp),
    ) {
        Text(
            text = label,
            color = DuckColors.Background,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun CloseButton(onClose: () -> Unit) {
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

/** Senses shown per sense group of each word of a sentence; the rest are counted ("+3 more"). */
private const val SENSES_PER_GROUP = 2

/**
 * The stacked per-word sections of a Sentence candidate's detail, as on web: each word's
 * Hanzi, reading and counterpart, then every sense group capped at [SENSES_PER_GROUP] senses.
 * Tags and measure words are left to the word's own detail, as on web. Opened from one word's
 * block, the column scrolls to that word's section and highlights it.
 */
@Composable
private fun SentenceSections(
    detail: OpenDetail,
    scroll: ScrollState,
) {
    val words = detail.candidate.words.orEmpty()
    val focus = detail.focusWord
    val tops = remember(detail.candidate) { mutableStateMapOf<Int, Int>() }
    val focusTop = focus?.let { tops[it] }
    LaunchedEffect(focus, focusTop) { focusTop?.let { scroll.scrollTo(it) } }

    if (detail.wordViews.size < words.size || detail.wordViews.any { it == null }) {
        DetailLine("Couldn't load details", color = DuckColors.Accent)
    }
    words.forEachIndexed { i, word ->
        val view = detail.wordViews.getOrNull(i)
        val focused = i == focus
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .onGloballyPositioned { tops[i] = it.positionInParent().y.toInt() }
                    .testTag(DETAIL_WORD_TAG)
                    .semantics { selected = focused }
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (focused) DuckColors.Accent.copy(alpha = 0.16f) else DuckColors.Key.copy(alpha = 0.5f))
                    .padding(horizontal = 8.dp, vertical = 6.dp),
        ) {
            Row(
                verticalAlignment = Alignment.Bottom,
                modifier = Modifier.semantics(mergeDescendants = true) { heading() },
            ) {
                Text(text = word.hanzi, color = DuckColors.PrimaryText, fontSize = 20.sp)
                Spacer(Modifier.width(8.dp))
                Text(text = word.pinyinMarks, color = DuckColors.PrimaryText, fontSize = 13.sp)
                view?.counterpart?.let {
                    Spacer(Modifier.width(6.dp))
                    Text(text = it, color = DuckColors.SecondaryText, fontSize = 12.sp)
                }
            }
            if (view == null) {
                DetailLine(word.shortGloss)
            } else {
                view.groups.forEach { group ->
                    group.heading?.let {
                        Text(
                            text = it,
                            color = DuckColors.PrimaryText,
                            fontSize = 15.sp,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                    group.partOfSpeech?.let { DetailLine(it, italic = true) }
                    group.senses.take(SENSES_PER_GROUP).forEach { SenseLine(it) }
                    val hidden = group.senses.size - SENSES_PER_GROUP
                    if (hidden > 0) DetailLine("+$hidden more", color = DuckColors.Accent.copy(alpha = 0.8f))
                }
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
    group.senses.forEach { SenseLine(it) }
    if (group.measureWords.isNotEmpty()) {
        Row(modifier = Modifier.semantics(mergeDescendants = true) {}) {
            Text(text = "Measure words", color = DuckColors.SecondaryText, fontSize = 12.sp)
            Spacer(Modifier.width(6.dp))
            Text(text = group.measureWords.joinToString(" · "), color = DuckColors.PrimaryText, fontSize = 13.sp)
        }
    }
}

@Composable
private fun SenseLine(sense: DetailViewSense) {
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

@Composable
private fun DetailLine(
    text: String,
    color: androidx.compose.ui.graphics.Color = DuckColors.SecondaryText,
    italic: Boolean = false,
) {
    Text(text = text, color = color, fontSize = 12.sp, fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal)
}
