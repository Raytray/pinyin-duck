package dev.pinyinduck.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pinyinduck.android.engine.Candidate
import dev.pinyinduck.android.engine.ScriptType
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
 */
@Composable
fun PinyinDuckKeyboard(
    state: KeyboardUiState,
    callbacks: KeyboardCallbacks,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                // The background is drawn before the padding, so the keyboard colour reaches
                // into the strip below the keys rather than leaving the window background there.
                .background(DuckColors.Background)
                .windowInsetsPadding(WindowInsets.navigationBars.only(WindowInsetsSides.Bottom)),
    ) {
        if (state.expanded) {
            ExpandedCandidates(state, callbacks)
        } else {
            CompositionBar(state, callbacks)
            CandidateStrip(state, callbacks)
        }

        KeyboardGrid(state, callbacks)
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
                state.loading -> HintText("Loading dictionary…")
                state.buffer.isNotEmpty() ->
                    Text(
                        text = state.buffer,
                        color = DuckColors.PrimaryText,
                        fontSize = 18.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
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

@Composable
private fun HintText(text: String) {
    Text(
        text = text,
        color = DuckColors.SecondaryText,
        fontSize = 12.sp,
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

/** How many candidates the strip shows at once. */
private const val STRIP_PAGE_SIZE = 9

/** How many cards the expanded grid holds per page. */
private const val EXPANDED_PAGE_SIZE = 12

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

        Box(modifier = Modifier.weight(1f)) {
            if (state.candidates.isEmpty()) {
                Text(
                    text = if (state.buffer.isEmpty()) "" else "No match",
                    color = DuckColors.SecondaryText,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    state.candidates
                        .drop(start)
                        .take(STRIP_PAGE_SIZE)
                        .forEachIndexed { offset, candidate ->
                            val index = start + offset
                            StripCandidate(
                                candidate = candidate,
                                selected = index == state.selectedIndex,
                                onClick = { callbacks.onSelectCandidate(index) },
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

@Composable
private fun StripCandidate(
    candidate: Candidate,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .width(44.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(if (selected) DuckColors.Accent.copy(alpha = 0.18f) else Color.Transparent)
                .clickable(onClick = onClick)
                .padding(vertical = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = candidate.hanzi,
            color = if (selected) DuckColors.Accent else DuckColors.PrimaryText,
            fontSize = if (candidate.hanzi.length > 2) 17.sp else 22.sp,
            maxLines = 1,
        )
        Text(
            text = candidate.pinyinMarks,
            color = DuckColors.SecondaryText,
            fontSize = 9.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The full candidate list with the English definitions.
 *
 * This is the point of the app: `你` and `泥` both read `nǐ`/`ní` and mean nothing alike, so
 * the gloss next to each character is what stops a learner picking the wrong one.
 */
@Composable
private fun ExpandedCandidates(
    state: KeyboardUiState,
    callbacks: KeyboardCallbacks,
) {
    val pages = pageCount(state.total, state.fetched, EXPANDED_PAGE_SIZE)
    var page by remember(state.buffer, state.total) { mutableStateOf(0) }
    val safePage = page.coerceIn(0, (pages - 1).coerceAtLeast(0))
    val start = safePage * EXPANDED_PAGE_SIZE

    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(DuckColors.CandidateSelected)
                .padding(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text =
                    if (state.total > state.candidates.size) {
                        "${state.total} matches · ${safePage + 1}/$pages"
                    } else {
                        "${state.total} matches"
                    },
                color = DuckColors.SecondaryText,
                fontSize = 11.sp,
                modifier = Modifier.weight(1f),
            )
            PagerArrow("‹", enabled = safePage > 0) { page = (safePage - 1).coerceAtLeast(0) }
            PagerArrow("›", enabled = safePage < pages - 1) { page = (safePage + 1).coerceAtMost(pages - 1) }
        }

        Spacer(modifier = Modifier.height(4.dp))

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.height(196.dp),
        ) {
            itemsIndexed(
                items = state.candidates.drop(start).take(EXPANDED_PAGE_SIZE),
                key = { _, candidate -> candidate.id },
            ) { offset, candidate ->
                val index = start + offset
                CandidateCard(
                    candidate = candidate,
                    selected = index == state.selectedIndex,
                    onClick = { callbacks.onSelectCandidate(index) },
                )
            }
        }
    }
}

@Composable
private fun CandidateCard(
    candidate: Candidate,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .padding(3.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (selected) DuckColors.Accent.copy(alpha = 0.16f) else DuckColors.Key)
                .clickable(onClick = onClick)
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
            candidate.hskLevel?.let { level ->
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "HSK$level",
                    color = DuckColors.Accent.copy(alpha = 0.75f),
                    fontSize = 9.sp,
                )
            }
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
                                tryAwaitRelease()
                                onPress()
                            },
                            onLongPress = {
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
