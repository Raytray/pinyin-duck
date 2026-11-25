package dev.pinyinduck.android.ui

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridLayoutInfo
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.ViewConfiguration
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pinyinduck.android.engine.Candidate
import dev.pinyinduck.android.engine.ScriptType
import dev.pinyinduck.android.ime.KeyRouting
import dev.pinyinduck.android.ime.KeyboardUiState
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** Everything the keyboard needs to know, refreshed as one value after each keystroke. */
data class KeyboardCallbacks(
    val onKey: (KeyAction) -> Unit,
    val onSelectCandidate: (Int) -> Unit,
    val onToggleScript: () -> Unit,
    val onToggleExpanded: () -> Unit,
    val onClear: () -> Unit,
    /**
     * A long press on a strip candidate or a card in the Expanded candidate list: open the
     * Candidate detail bubble for it, or switch it there.
     */
    val onShowDetail: (Int) -> Unit = {},
    /**
     * A long press on one word's block in a Sentence candidate's card (#46): open the Candidate
     * detail for the candidate at the first index, scrolled to the word at the second.
     */
    val onShowWordDetail: (Int, Int) -> Unit = { index, _ -> onShowDetail(index) },
    /** Close the Candidate detail bubble, e.g. after a tap on the app area. */
    val onCloseDetail: () -> Unit = {},
    /**
     * A tap on one word's block in a Sentence candidate's card (#47): open the word menu for the
     * candidate at the first index and the word at the second, or close it if it is open there.
     */
    val onOpenWordMenu: (Int, Int) -> Unit = { _, _ -> },
    /** A chip in the word menu: fix this alternative in the sentence in place of the word. */
    val onSwapWord: (Candidate) -> Unit = {},
    /** The word menu's "Commit through" chip, for the candidate and word it is open on. */
    val onCommitThrough: (Int, Int) -> Unit = { _, _ -> },
)

/**
 * The keyboard: a composition bar and candidate area above the keys.
 *
 * Layout follows the roadmap's split between a primary candidate strip and an expanded
 * view, except that the strip pages rather than showing only the top three. Restricting it
 * to three would mean a page of arrow keys for a broad syllable like `ta`, which has 1,476
 * candidates; paging the strip keeps every candidate one tap away.
 *
 * The bottom inset is the keyboard's own navigation bar, not the device's: an IME window
 * draws the switch-keyboard globe and the hide-keyboard arrow over its content rather than
 * taking space for them, so the keys have to stop short themselves.
 *
 * The device navigation bar inset is not a reliable measure of those icons: on gesture
 * navigation it is far shorter than the icons' touch targets, which is what left them
 * overlapping the comma and period keys. A fixed buffer sized to the icons' touch target
 * clears them on every navigation mode.
 */
@Composable
fun PinyinDuckKeyboard(
    state: KeyboardUiState,
    callbacks: KeyboardCallbacks,
    modifier: Modifier = Modifier,
) {
    // The globe/hide icons are drawn over the keyboard rather than reserving space, and
    // their touch targets are taller than the gesture navigation bar inset reports, so
    // take the larger of the device navigation bar and a fixed 48 dp buffer.
    val density = LocalDensity.current
    val bottomBuffer =
        with(density) {
            maxOf(WindowInsets.navigationBars.getBottom(this), 48.dp.toPx().toInt()).toDp()
        }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                // The background is drawn before the padding, so the keyboard colour reaches
                // into the strip below the keys rather than leaving the window background there.
                .background(DuckColors.Background)
                .padding(bottom = bottomBuffer),
    ) {
        if (state.expanded) {
            ExpandedCandidates(state, callbacks)
        } else {
            CompositionBar(state, callbacks)
            CandidateStrip(state, callbacks)
        }

        // A landscape phone has no room for the keys and the Expanded candidate list together:
        // the keyboard would fill the window and the app would hide it. The keys come back
        // when the list closes.
        val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
        if (!(state.expanded && landscape)) KeyboardGrid(state, callbacks)
    }
}

@Composable
private fun CompositionBar(
    state: KeyboardUiState,
    callbacks: KeyboardCallbacks,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(DuckColors.Background)
                .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.weight(1f)) {
            when {
                state.dictionaryError != null -> HintText(state.dictionaryError)
                // Checked before `loading`, because the buffer is the more specific fact and
                // it is the one the user is looking for. The session accepts letters while
                // the dictionary is still mapping, so a composition can be in progress with
                // the load unfinished, and showing the loading hint then would hide the
                // pinyin the user just typed behind a message about the dictionary.
                state.buffer.isNotEmpty() ->
                    Text(
                        text = state.buffer,
                        color = DuckColors.PrimaryText,
                        fontSize = 18.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                state.loading -> HintText("Loading dictionary…")
                state.dictionaryEntries > 0 ->
                    HintText(
                        "${formatCount(state.dictionaryEntries)} entries ready · type pinyin · 123 for digits",
                    )
                else -> HintText("Type pinyin · 123 for digits · tap a candidate to pick")
            }
        }

        IconLabel(
            text = if (state.script == ScriptType.TRADITIONAL) "繁" else "简",
            onClick = callbacks.onToggleScript,
        )
        IconLabel(
            text = if (state.expanded) "▾" else "▴",
            onClick = callbacks.onToggleExpanded,
        )
        IconLabel(text = "✕", onClick = callbacks.onClear, enabled = state.buffer.isNotEmpty())
    }
}

/**
 * A hint in the composition bar. Its line height is set so that two lines fit within the bar's
 * 34 dp icons: with the theme's 24 sp a wrapped hint made the bar taller before typing than
 * while composing, and the keyboard shrank on the first key.
 */
@Composable
private fun HintText(text: String) {
    Text(
        text = text,
        color = DuckColors.SecondaryText,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun IconLabel(
    text: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    Box(
        modifier =
            Modifier
                .padding(horizontal = 3.dp)
                .size(34.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(if (enabled) DuckColors.SpecialKey else DuckColors.Key)
                .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = if (enabled) DuckColors.PrimaryText else DuckColors.SecondaryText.copy(alpha = 0.4f),
            fontSize = 15.sp,
        )
    }
}

/**
 * How many candidates the strip shows at once.
 *
 * Shared with the hardware paging keys via [KeyRouting.PAGE_SIZE] so a physical arrow and the
 * on-screen pager can never disagree about how far a page is.
 */
private const val STRIP_PAGE_SIZE = KeyRouting.PAGE_SIZE

/**
 * The line height of a strip candidate's Hanzi: Material's body line height, which is what it
 * had before the strip's height was fixed.
 */
private val STRIP_LINE_HEIGHT = 24.sp

/** The vertical padding of a strip candidate, above and below its line. */
private val STRIP_CANDIDATE_PADDING = 8.dp

/**
 * The height of the strip's candidates: a word candidate's own height, one line and its
 * padding. Fixed rather than left to the content, so a Sentence candidate's three-line blocks
 * fit inside it and never make the keyboard taller (#36). In `sp` like the text, so it grows
 * with the system font size.
 */
@Composable
private fun stripCandidateHeight() = with(LocalDensity.current) { STRIP_LINE_HEIGHT.toDp() } + STRIP_CANDIDATE_PADDING * 2

@Composable
private fun CandidateStrip(
    state: KeyboardUiState,
    callbacks: KeyboardCallbacks,
) {
    val pages = pageCount(state.total, state.fetched, STRIP_PAGE_SIZE)
    var page by remember(state.buffer, state.total) { mutableStateOf(0) }
    val safePage = page.coerceIn(0, (pages - 1).coerceAtLeast(0))
    val start = safePage * STRIP_PAGE_SIZE

    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(DuckColors.CandidateSelected)
                .padding(horizontal = 4.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PagerArrow("‹", enabled = safePage > 0) {
            page = (safePage - 1).coerceAtLeast(0)
        }

        // As tall with no candidates as with them, so the keyboard keeps its height from the
        // first key typed to the last candidate picked.
        Box(modifier = Modifier.weight(1f).height(stripCandidateHeight()), contentAlignment = Alignment.Center) {
            if (state.candidates.isEmpty()) {
                Text(
                    text =
                        when {
                            state.buffer.isEmpty() -> ""
                            // Not "No match": nothing has been searched yet, and telling the
                            // user their pinyin does not exist when the dictionary simply has
                            // not finished mapping is both wrong and needlessly alarming.
                            state.loading -> "Loading…"
                            else -> "No match"
                        },
                    color = DuckColors.SecondaryText,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxSize(),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    state.candidates
                        .drop(start)
                        .take(STRIP_PAGE_SIZE)
                        .forEachIndexed { offset, candidate ->
                            val index = start + offset
                            if (candidate.isSentence) {
                                SentenceStripSlot(
                                    sentence = candidate,
                                    index = index,
                                    selected = index == state.selectedIndex,
                                    onClick = { callbacks.onSelectCandidate(index) },
                                    onShowAll = callbacks.onToggleExpanded,
                                    onShowDetail = { callbacks.onShowDetail(index) },
                                )
                                return@forEachIndexed
                            }
                            StripCandidate(
                                candidate = candidate,
                                index = index,
                                selected = index == state.selectedIndex,
                                onClick = { callbacks.onSelectCandidate(index) },
                                onLongClick = { callbacks.onShowDetail(index) },
                            )
                        }
                }
            }
        }

        PagerArrow("›", enabled = safePage < pages - 1) {
            page = (safePage + 1).coerceAtMost(pages - 1)
        }
    }
}

/**
 * One candidate in the collapsed strip: the characters and their definition on a single line.
 *
 * The tone-marked pinyin that used to sit here moved out rather than being kept alongside the
 * gloss, because at one line the width only fits one of them and the definition is the one
 * worth having: `你` and `泥` read alike and mean nothing alike, which is the whole point of the
 * app. The expanded panel still shows the pinyin next to every candidate for careful reading.
 *
 * The card takes `weight` rather than a fixed width, so it divides whatever the strip has and
 * no candidate is clipped off the right edge on a narrow screen. The gloss is weighted with
 * `fill = false` so a short one like `you` keeps its natural width instead of being stretched.
 */
@Composable
private fun RowScope.StripCandidate(
    candidate: Candidate,
    index: Int,
    selected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) = DetailLongPressTimeout {
    Row(
        modifier =
            Modifier
                .weight(1f)
                .clip(RoundedCornerShape(6.dp))
                .background(if (selected) DuckColors.Accent.copy(alpha = 0.18f) else Color.Transparent)
                .opensCandidateDetail(index, onClick = onClick, onLongClick = onLongClick)
                .padding(horizontal = 5.dp, vertical = STRIP_CANDIDATE_PADDING),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = candidate.hanzi,
            color = if (selected) DuckColors.Accent else DuckColors.PrimaryText,
            fontSize = if (candidate.hanzi.length > 2) 15.sp else 19.sp,
            lineHeight = STRIP_LINE_HEIGHT,
            maxLines = 1,
        )
        Spacer(modifier = Modifier.width(5.dp))
        Text(
            text = candidate.shortGloss,
            color = DuckColors.SecondaryText,
            fontSize = 10.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
    }
}

/**
 * A candidate that commits on tap and opens its Candidate detail on long press: a strip
 * candidate or a card in the Expanded candidate list.
 *
 * TalkBack users get the detail as a named custom action as well (#11), since a timed press is
 * not something they can discover; the long-click label names the same thing for the
 * double-tap-hold. It is also the bubble's [detailAnchor]. Call it inside
 * [DetailLongPressTimeout] for the long press to take [DETAIL_LONG_PRESS_MILLIS].
 */
private fun Modifier.opensCandidateDetail(
    index: Int,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
): Modifier =
    semantics {
        customActions =
            listOf(
                CustomAccessibilityAction("Show details") {
                    onLongClick()
                    true
                },
            )
    }.detailAnchor(index)
        .combinedClickable(onLongClickLabel = "Show details", onLongClick = onLongClick, onClick = onClick)

/** How long a press on a candidate takes to open its Candidate detail (#5): about half a second. */
internal const val DETAIL_LONG_PRESS_MILLIS = 450L

/**
 * Gives [content]'s long presses [DETAIL_LONG_PRESS_MILLIS] instead of the platform's timeout,
 * which is 400 or 500 ms depending on the Android version. Scoped to one candidate so the keys
 * keep the platform's.
 */
@Composable
internal fun DetailLongPressTimeout(content: @Composable () -> Unit) {
    val platform = LocalViewConfiguration.current
    val configuration =
        remember(platform) {
            object : ViewConfiguration by platform {
                override val longPressTimeoutMillis = DETAIL_LONG_PRESS_MILLIS
            }
        }
    CompositionLocalProvider(LocalViewConfiguration provides configuration, content = content)
}

/**
 * The full candidate list with the English definitions.
 *
 * This is the point of the app: `你` and `泥` both read `nǐ`/`ní` and mean nothing alike, so
 * the gloss next to each character is what stops a learner picking the wrong one.
 *
 * The list scrolls rather than pages, and the header carries the collapse control instead of
 * page arrows. Two things follow from that. This view used to *replace* the composition bar, so
 * the `▾` that closes it lived in a bar that was no longer on screen and the list could not be
 * closed by touch at all; and paging through a scrollable viewport meant scrolling within a
 * page as well as between pages. The session fetches up to [PinyinDuckSession.FETCH_LIMIT]
 * candidates, so scrolling them is what keeps all of them reachable.
 *
 * While a Candidate detail bubble is open the list shrinks to about a row, scrolled to the card
 * the bubble is for, so the keyboard is shorter and the bubble has room above it (#22); it comes
 * back to full height when the bubble closes. The insets stay at the full-height top
 * meanwhile (see [KeyboardWindow]), so the host app does not move.
 */
@Composable
private fun ExpandedCandidates(
    state: KeyboardUiState,
    callbacks: KeyboardCallbacks,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(DuckColors.CandidateSelected)
                .padding(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "${state.total} matches",
                color = DuckColors.SecondaryText,
                fontSize = 11.sp,
                modifier = Modifier.weight(1f),
            )
            IconLabel(text = "▾", onClick = callbacks.onToggleExpanded)
        }

        Spacer(modifier = Modifier.height(4.dp))

        val gridState = rememberLazyGridState()
        val detailIndex = state.detailIndex
        LaunchedEffect(detailIndex) {
            // The list has just shrunk under the bubble; keep the card it is for in view.
            if (detailIndex != null) {
                withFrameNanos {}
                if (!gridState.layoutInfo.showsWhole(detailIndex)) gridState.scrollToItem(detailIndex)
            }
        }
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            state = gridState,
            modifier = Modifier.height(if (state.detailOpen) EXPANDED_LIST_HEIGHT_UNDER_DETAIL else EXPANDED_LIST_HEIGHT),
        ) {
            // No explicit key: `Candidate.id` is `"$simplified-$pinyinNumbers"` and the
            // dictionary is keyed by traditional headword, so 幹/乾/干 all produce the same id.
            // A lazy grid throws on a duplicate key, and slicing the list to a page was what
            // kept those apart. Position-based default keys cannot collide.
            itemsIndexed(
                items = state.candidates,
                // A Sentence candidate is a full-width card spanning both columns (#36).
                span = { _, candidate -> GridItemSpan(if (candidate.isSentence) maxLineSpan else 1) },
            ) { index, candidate ->
                if (candidate.isSentence) {
                    SentenceCard(
                        sentence = candidate,
                        index = index,
                        selected = index == state.selectedIndex,
                        onClick = { callbacks.onSelectCandidate(index) },
                        onShowDetail = { callbacks.onShowDetail(index) },
                        onShowWordDetail = { word -> callbacks.onShowWordDetail(index, word) },
                        menu = state.wordMenu?.takeIf { it.index == index },
                        fixedWords = state.fixedWords,
                        onOpenWordMenu = { word -> callbacks.onOpenWordMenu(index, word) },
                        onSwapWord = callbacks.onSwapWord,
                        onCommitThrough = { word -> callbacks.onCommitThrough(index, word) },
                    )
                    return@itemsIndexed
                }
                CandidateCard(
                    candidate = candidate,
                    index = index,
                    selected = index == state.selectedIndex,
                    onClick = { callbacks.onSelectCandidate(index) },
                    onLongClick = { callbacks.onShowDetail(index) },
                )
            }
        }
    }
}

/** The Expanded candidate list's height: three rows of cards, give or take. */
private val EXPANDED_LIST_HEIGHT = 196.dp

/**
 * Its height while the Candidate detail bubble is open: about one row, so the bubble gets the
 * rest (#22). At full height a landscape phone has no room above the keyboard at all.
 */
private val EXPANDED_LIST_HEIGHT_UNDER_DETAIL = 80.dp

/** Whether the item at [index] is laid out with no part of it scrolled off. */
private fun LazyGridLayoutInfo.showsWhole(index: Int): Boolean {
    val item = visibleItemsInfo.firstOrNull { it.index == index } ?: return false
    return item.offset.y >= viewportStartOffset && item.offset.y + item.size.height <= viewportEndOffset
}

@Composable
private fun CandidateCard(
    candidate: Candidate,
    index: Int,
    selected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) = DetailLongPressTimeout {
    Column(
        modifier =
            Modifier
                .padding(3.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (selected) DuckColors.Accent.copy(alpha = 0.16f) else DuckColors.Key)
                .opensCandidateDetail(index, onClick = onClick, onLongClick = onLongClick)
                .padding(horizontal = 10.dp, vertical = 7.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = candidate.hanzi,
                color = if (selected) DuckColors.Accent else DuckColors.PrimaryText,
                fontSize = 21.sp,
                maxLines = 1,
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = candidate.pinyinMarks,
                color = DuckColors.SecondaryText,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            text = candidate.shortGloss,
            color = if (selected) DuckColors.PrimaryText else DuckColors.SecondaryText,
            fontSize = 11.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun PagerArrow(
    text: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .size(width = 30.dp, height = 34.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(DuckColors.SpecialKey)
                .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = if (enabled) DuckColors.PrimaryText else DuckColors.SecondaryText.copy(alpha = 0.3f),
            fontSize = 18.sp,
        )
    }
}

@Composable
private fun KeyboardGrid(
    state: KeyboardUiState,
    callbacks: KeyboardCallbacks,
) {
    val rows = keyRows(state.layout, state.shift)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(DuckColors.Background)
                .padding(3.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        rows.forEachIndexed { index, row ->
            // The middle letter row has nine keys against ten, so inset it to sit under the
            // row above rather than stretching its keys out of alignment.
            val inset = if (state.layout == KeyLayout.LETTERS && index == 1) 6.dp else 0.dp
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = inset),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                row.forEach { key ->
                    KeyboardKey(
                        key = key,
                        onPress = { callbacks.onKey(key.action) },
                        onRepeat =
                            if (key.action is KeyAction.Backspace) {
                                { callbacks.onKey(KeyAction.Backspace) }
                            } else {
                                null
                            },
                    )
                }
            }
        }
    }
}

@Composable
private fun RowScope.KeyboardKey(
    key: KeySpec,
    onPress: () -> Unit,
    onRepeat: (() -> Unit)?,
) {
    var pressed by remember { mutableStateOf(false) }
    // Tracks whether the current gesture became a long press, so the release does not
    // also fire the single-tap action on top of the repeat sequence.
    var longPressed by remember { mutableStateOf(false) }

    val background =
        when (key.style) {
            KeyStyle.NORMAL -> DuckColors.Key
            KeyStyle.SPECIAL -> DuckColors.SpecialKey
            KeyStyle.ACCENT -> DuckColors.Accent.copy(alpha = 0.85f)
        }
    val contentColor =
        when (key.style) {
            KeyStyle.ACCENT -> DuckColors.Background
            else -> DuckColors.PrimaryText
        }

    val modifier =
        Modifier
            .weight(key.width)
            .height(46.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (pressed) DuckColors.KeyPressed else background)

    Box(
        modifier =
            modifier.then(
                if (onRepeat != null) {
                    Modifier.pointerInput(Unit) {
                        detectTapGestures(
                            onPress = {
                                longPressed = false
                                tryAwaitRelease()
                                // Stop the repeat loop the long press may have started.
                                pressed = false
                                // A long press already fired its own (repeated) backspaces,
                                // so the release must not add one more.
                                if (!longPressed) onPress()
                            },
                            onLongPress = {
                                longPressed = true
                                onRepeat()
                                pressed = true
                            },
                        )
                    }
                } else {
                    Modifier.clickable {
                        onPress()
                    }
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = key.label,
            color = contentColor,
            fontSize =
                when {
                    key.label.length > 3 -> 12.sp
                    key.label == "space" -> 12.sp
                    else -> 18.sp
                },
            fontWeight = if (key.style == KeyStyle.ACCENT) FontWeight.Bold else FontWeight.Normal,
            textAlign = TextAlign.Center,
            maxLines = 1,
        )
    }

    // Auto-repeat while a backspace is held, so deleting a word is one gesture.
    LaunchedEffect(pressed) {
        if (pressed && onRepeat != null) {
            while (isActive) {
                delay(90)
                onRepeat()
            }
        }
    }
}

/** Groups a count with thin separators, e.g. `122,746`. */
private fun formatCount(value: Int): String =
    value
        .toString()
        .reversed()
        .chunked(3)
        .joinToString(",")
        .reversed()

/**
 * How many pages of candidates there are.
 *
 * [fetched] is capped by the session's scan budget while [total] is the true count, so the
 * page count is derived from whichever is smaller: an arrow must never lead to an empty
 * page.
 */
private fun pageCount(
    total: Int,
    fetched: Int,
    pageSize: Int,
): Int {
    val available = minOf(total, fetched).coerceAtLeast(1)
    return (available + pageSize - 1) / pageSize
}
